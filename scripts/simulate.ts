import { pathToFileURL } from 'node:url'
import type { GameState } from '../src/sim/types'
import { newRun, tick } from '../src/sim/tick'
import { hire, dispatch, seatOffer, sendSupply, idleMercIds } from '../src/sim/actions'
import { project } from '../src/sim/projection'
import { SUPPRESSOR } from '../src/sim/balance'

const RESERVE = 200

export function botAct(state: GameState): void {
  // 1. hire affordable candidates when a slot is free
  for (const offer of [...state.offers, ...state.seated]) {
    if (offer.kind !== 'candidate') continue
    if (state.mercs.length >= state.rosterSlots) break
    if (state.cash - offer.candidate!.hirePrice >= RESERVE) hire(state, offer.id)
  }

  // 2. dispatch all idle mercs to the best job they can nearly fully staff
  const idle = idleMercIds(state)
  if (idle.length > 0) {
    const jobs = [...state.offers, ...state.seated]
      .filter(o => o.kind === 'job')
      .sort((a, b) => b.job!.rating - a.job!.rating)
    for (const offer of jobs) {
      const p = project(state, idle, offer.job!.rating, offer.job!.environment)
      if (p.shortfall <= offer.job!.rating) {
        dispatch(state, offer.id, idle)
        break
      }
    }
  }

  // 3. seat the best unstaffable job if there's room
  if (state.seated.length < state.waitingSeats) {
    const best = state.offers
      .filter(o => o.kind === 'job')
      .sort((a, b) => b.job!.rating - a.job!.rating)[0]
    if (best) seatOffer(state, best.id)
  }

  // 4. suppress missions about to tick over
  for (const mission of state.missions) {
    if (mission.threatBar >= 14 && state.cash >= SUPPRESSOR.price + RESERVE) {
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
