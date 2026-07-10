import { pathToFileURL } from 'node:url'
import type { GameState } from '../src/sim/types'
import { newRun, tick } from '../src/sim/tick'
import { hire, dispatch, seatOffer, sendSupply, buySlot, medbayHeal, idleMercIds } from '../src/sim/actions'
import { project } from '../src/sim/projection'
import { SUPPRESSOR, SLOT_PRICES, MAX_ROSTER_SLOTS, STARTING_ROSTER_SLOTS } from '../src/sim/balance'

const RESERVE = 200
// A bigger squad only has to buy slots when it can comfortably keep spending on
// hires/supplies afterward; this reserve stops slot-buying from starving the war chest.
const GROWTH_RESERVE = 500

export function botAct(state: GameState): void {
  // 1. hire affordable candidates when a slot is free
  for (const offer of [...state.offers, ...state.seated]) {
    if (offer.kind !== 'candidate') continue
    if (state.mercs.length >= state.rosterSlots) break
    if (state.cash - offer.candidate!.hirePrice >= RESERVE) hire(state, offer.id)
  }

  // 2. grow the company: buy a roster slot once the roster is full and cash is
  //    comfortable. A larger roster is the only way to field squads strong enough
  //    for the higher-rating jobs that actually pay off (loosening the dispatch
  //    guard instead just gets under-staffed mercs killed — measured, see report).
  if (state.rosterSlots < MAX_ROSTER_SLOTS && state.mercs.length >= state.rosterSlots) {
    const price = SLOT_PRICES[state.rosterSlots - STARTING_ROSTER_SLOTS]
    if (state.cash - price >= GROWTH_RESERVE) buySlot(state)
  }

  // 3. patch up wounded idle mercs at the medbay before they get redeployed —
  //    a wounded merc redispatched is the main way the roster spirals to zero.
  //    Heal mercs below half HP while cash stays comfortable.
  for (const merc of state.mercs) {
    if (!idleMercIds(state).includes(merc.id)) continue
    if (merc.hp >= merc.maxHp) continue
    if (merc.hp * 2 > merc.maxHp) continue
    const price = (merc.maxHp - merc.hp) * 10
    if (state.cash - price >= RESERVE) medbayHeal(state, merc.id)
  }

  // 4. dispatch all idle mercs to the best job they can nearly fully staff.
  //    Guard: shortfall <= 1 (squad power within 1 of the job's full threat,
  //    rating x 5). A FIXED small allowance — not the old `shortfall <= rating`,
  //    which scaled the allowance up with rating and so under-staffed exactly the
  //    high-rating jobs whose per-consequence damage is largest. Any positive
  //    shortfall feeds the rng(0, 2*shortfall) threat term, and once one merc
  //    falls the squad's power drops, shortfall climbs, and the mission cascades
  //    into a total wipe; keeping the allowance at 1 lets weak early squads take
  //    low-rating jobs to bootstrap while never under-staffing dangerous ones.
  const idle = idleMercIds(state)
  if (idle.length > 0) {
    const jobs = [...state.offers, ...state.seated]
      .filter(o => o.kind === 'job')
      .sort((a, b) => b.job!.rating - a.job!.rating)
    for (const offer of jobs) {
      const p = project(state, idle, offer.job!.rating, offer.job!.environment)
      if (p.shortfall <= 1) {
        dispatch(state, offer.id, idle)
        break
      }
    }
  }

  // 4. seat the best unstaffable job if there's room
  if (state.seated.length < state.waitingSeats) {
    const best = state.offers
      .filter(o => o.kind === 'job')
      .sort((a, b) => b.job!.rating - a.job!.rating)[0]
    if (best) seatOffer(state, best.id)
  }

  // 5. suppress missions about to tick over — but only if no suppressor is already
  //    inbound, otherwise the bot re-buys every tick during the 3-tick travel (finding 2).
  for (const mission of state.missions) {
    const pending = mission.supplies.some(su => su.type === 'suppressor')
    if (mission.threatBar >= 14 && !pending && state.cash >= SUPPRESSOR.price + RESERVE) {
      sendSupply(state, mission.id, 'suppressor')
    }
  }
}

export function runOne(seed: number): GameState {
  const state = newRun(seed)
  while (state.status === 'running') {
    botAct(state)
    tick(state)
  }
  return state
}

function main(): void {
  const n = Number(process.argv[2] ?? 500)
  let wins = 0, cash = 0, lost = 0, done = 0, failed = 0
  const worst: { seed: number; cash: number }[] = []
  for (let seed = 1; seed <= n; seed++) {
    const s = runOne(seed)
    if (s.status === 'won') wins++
    cash += s.cash
    lost += s.stats.mercsLost
    done += s.stats.jobsDone
    failed += s.stats.jobsFailed
    worst.push({ seed, cash: s.cash })
  }
  worst.sort((a, b) => a.cash - b.cash)
  console.log(`runs: ${n}`)
  console.log(`win rate: ${((wins / n) * 100).toFixed(1)}%`)
  console.log(`mean final cash: ${(cash / n).toFixed(0)}cr (loan is the bar)`)
  console.log(`mean jobs done/failed: ${(done / n).toFixed(1)} / ${(failed / n).toFixed(1)}`)
  console.log(`mean mercs lost: ${(lost / n).toFixed(2)}`)
  console.log(`worst seeds: ${worst.slice(0, 5).map(w => `${w.seed} (${w.cash}cr)`).join(', ')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
