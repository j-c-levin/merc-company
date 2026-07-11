import { pathToFileURL } from 'node:url'
import type { GameState } from '../src/sim/types'
import { newRun, tick } from '../src/sim/tick'
import { hire, dispatch, sendSupply, buySlot, medbayHeal, idleMercIds, withdraw, rejectOffer } from '../src/sim/actions'
import { project } from '../src/sim/projection'
import { generateJob } from '../src/sim/content'
import { createRng } from '../src/sim/rng'
import { SUPPRESSOR, SLOT_PRICES, MAX_ROSTER_SLOTS, STARTING_ROSTER_SLOTS, MEDBAY_PER_HP, CYCLE_LENGTH } from '../src/sim/balance'

const RESERVE = 200
// A bigger squad only has to buy slots when it can comfortably keep spending on
// hires/supplies afterward; this reserve stops slot-buying from starving the war chest.
const GROWTH_RESERVE = 500

export function botAct(state: GameState): void {
  // 1. hire affordable candidates when a slot is free
  for (const offer of state.seated) {
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
    const price = (merc.maxHp - merc.hp) * MEDBAY_PER_HP
    if (state.cash - price >= RESERVE) medbayHeal(state, merc.id)
  }

  // 4. dispatch all idle mercs to the best job they can nearly fully staff.
  //    Guard: shortfall <= 1 (squad power within 1 of the job's threat-neutral
  //    power, rating × THREAT_BASE_PER_RATING). A FIXED small allowance — not
  //    the old `shortfall <= rating`,
  //    which scaled the allowance up with rating and so under-staffed exactly the
  //    high-rating jobs whose per-consequence damage is largest. Any positive
  //    shortfall feeds the rng(0, 2*shortfall) threat term, and once one merc
  //    falls the squad's power drops, shortfall climbs, and the mission cascades
  //    into a total wipe; keeping the allowance at 1 lets weak early squads take
  //    low-rating jobs to bootstrap while never under-staffing dangerous ones.
  const idle = idleMercIds(state)
  if (idle.length > 0) {
    const jobs = state.seated
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

  // 5. (deleted — offers seat themselves; no manual seating)

  // 6. suppress missions about to tick over — but only if no suppressor is already
  //    inbound, otherwise the bot re-buys every tick during the 3-tick travel (finding 2).
  for (const mission of state.missions) {
    const pending = mission.supplies.some(su => su.type === 'suppressor')
    if (mission.threatBar >= 14 && !pending && state.cash >= SUPPRESSOR.price + RESERVE) {
      sendSupply(state, mission.id, 'suppressor')
    }
  }
}

export function runOne(seed: number, onTick?: (state: GameState) => void): GameState {
  const state = newRun(seed)
  while (state.status === 'running') {
    botAct(state)
    tick(state)
    onTick?.(state)
  }
  return state
}

// ── scenario harness: fresh 1★ mercs on a 1★ job ─────────────────────────
// Models a sensible player: a squad member is pulled out when their hp drops
// to 30% of max or below. Failure = the squad withdrew/died before finishing.
const WITHDRAW_FRAC = 0.3

export interface ScenarioStats {
  runs: number
  success: number   // mission completed
  fail: number      // mission abandoned (withdrawals) or squad wiped
  deaths: number    // total mercs lost across all runs
  anyDeath: number  // runs in which at least one merc died
}

/** Send `squadSize` fresh rank-1 mercs on a 1★ job (random environment and
 *  affinities per seed), with the withdraw-at-30%-hp policy, and tally outcomes. */
export function runMissionScenario(squadSize: 1 | 2, runs: number): ScenarioStats {
  const out: ScenarioStats = { runs, success: 0, fail: 0, deaths: 0, anyDeath: 0 }
  for (let seed = 1; seed <= runs; seed++) {
    const s = newRun(seed) // two fresh rank-1 mercs, random affinities
    s.seated = []
    s.nextOfferAt = CYCLE_LENGTH * 10 // the pump never arrives during the mission
    const rng = createRng(seed * 7919)
    const offer = generateJob(s, rng, 1)
    offer.expiresAt = CYCLE_LENGTH
    s.seated.push(offer)
    const squad = s.mercs.slice(0, squadSize).map(m => m.id)
    const missionId = dispatch(s, offer.id, squad)
    while (s.missions.some(m => m.id === missionId) && s.status === 'running') {
      const mission = s.missions.find(m => m.id === missionId)!
      for (const id of [...mission.squad]) {
        const merc = s.mercs.find(m => m.id === id)!
        if (merc.hp <= Math.ceil(merc.maxHp * WITHDRAW_FRAC)) withdraw(s, missionId, id)
      }
      tick(s)
    }
    out.success += s.stats.jobsDone
    out.fail += s.stats.jobsFailed
    out.deaths += s.stats.mercsLost
    if (s.stats.mercsLost > 0) out.anyDeath++
  }
  return out
}

// ── offer-mix harness: arrival mix by reputation ──────────────────────────
export interface OfferMix {
  rep: number
  ticks: number
  bySource: Record<string, number>
  jobsTotal: number
  jobShare: Record<string, number> // per job tier, fraction of all job offers
  jobsPer100: number               // job offers reaching a seat per 100 ticks
}

/** Freeze reputation at `rep`, reject every seated offer the tick it appears,
 *  and count what the pump delivers. Multiple seeds, `ticks` ticks each. */
export function measureOfferMix(rep: number, ticks = 1400, seeds = 10): OfferMix {
  const bySource: Record<string, number> = {}
  for (let seed = 1; seed <= seeds; seed++) {
    const s = newRun(seed)
    s.reputation = rep
    s.mercs = []
    s.seated = []      // drop the opening offer; count from a clean pump
    s.nextOfferAt = 0
    for (let i = 0; i < ticks && s.status === 'running'; i++) {
      tick(s)
      for (const o of [...s.seated]) {
        bySource[o.source] = (bySource[o.source] ?? 0) + 1
        rejectOffer(s, o.id) // free the seat so the next offer can arrive
      }
    }
  }
  const jobKeys = Object.keys(bySource).filter(k => k !== 'candidate').sort()
  const jobsTotal = jobKeys.reduce((a, k) => a + bySource[k], 0)
  const jobShare: Record<string, number> = {}
  for (const k of jobKeys) jobShare[k] = bySource[k] / jobsTotal
  const total = ticks * seeds
  return { rep, ticks: total, bySource, jobsTotal, jobShare, jobsPer100: (jobsTotal / total) * 100 }
}

function scenarioMain(runs: number): void {
  for (const size of [1, 2] as const) {
    const r = runMissionScenario(size, runs)
    const pct = (x: number) => ((x / r.runs) * 100).toFixed(1) + '%'
    console.log(
      `${size} fresh 1★ merc(s) on a 1★ job (${r.runs} runs): ` +
      `success ${pct(r.success)}, fail ${pct(r.fail)}, any-death ${pct(r.anyDeath)}, ` +
      `mercs lost/run ${(r.deaths / r.runs).toFixed(3)}`,
    )
  }
}

function offersMain(): void {
  for (const rep of [0, 4, 8, 12, 16, 20, 24, 32]) {
    const m = measureOfferMix(rep)
    const shares = Object.entries(m.jobShare)
      .map(([k, v]) => `${k.replace('job', '')}★ ${(v * 100).toFixed(0)}%`)
      .join('  ')
    console.log(
      `rep ${String(rep).padStart(2)}: ${m.jobsPer100.toFixed(1)} job offers/100 ticks — ${shares}` +
      ` (candidates: ${m.bySource.candidate ?? 0})`,
    )
  }
}

const DECILES = 10
const SAMPLE_INTERVAL = 150 // CYCLE_LENGTH / DECILES

function main(): void {
  if (process.argv[2] === 'scenario') return scenarioMain(Number(process.argv[3] ?? 2000))
  if (process.argv[2] === 'offers') return offersMain()
  const n = Number(process.argv[2] ?? 500)
  let wins = 0, cash = 0, lost = 0, done = 0, failed = 0
  let lostRuns = 0, wipedRuns = 0
  const worst: { seed: number; cash: number }[] = []
  const cashByDecile: number[][] = Array.from({ length: DECILES }, () => [])
  for (let seed = 1; seed <= n; seed++) {
    const s = runOne(seed, state => {
      if (state.tick % SAMPLE_INTERVAL === 0) {
        const idx = state.tick / SAMPLE_INTERVAL - 1
        if (idx >= 0 && idx < DECILES) cashByDecile[idx].push(state.cash)
      }
    })
    if (s.status === 'won') wins++
    if (s.status === 'lost') {
      lostRuns++
      if (s.mercs.length === 0) wipedRuns++
    }
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

  if (lostRuns > 0) {
    const wipedPct = (wipedRuns / lostRuns) * 100
    console.log(
      `loss breakdown (of ${lostRuns} losses): ${wipedPct.toFixed(1)}% total roster wipe, ${(100 - wipedPct).toFixed(1)}% short on cash`,
    )
  } else {
    console.log('loss breakdown: no losses')
  }

  const curve = cashByDecile
    .map((samples, i) => {
      const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : NaN
      return `${(i + 1) * 10}%:${Number.isFinite(mean) ? mean.toFixed(0) : 'n/a'}cr`
    })
    .join('  ')
  console.log(`cash over time (decile means): ${curve}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
