import type { GameState, Mission } from './types'
import { createRng, type Rng } from './rng'
import { squadPower, recordMissionTogether } from './bonds'
import { generateMerc, generateOffer } from './content'
import {
  SCHEMA_VERSION, CYCLE_LENGTH, LOAN, STARTING_CASH, STARTING_ROSTER_SLOTS,
  STARTING_SEATS, OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX, THREAT_BASE_PER_RATING,
  THREAT_CAP, CONSEQUENCE_SPREAD, REINFORCE_TRAVEL, HEAL_INTERVAL, STIM,
  MEDKIT, SUPPRESSOR,
} from './balance'

export function newRun(seed: number): GameState {
  const rng = createRng(seed)
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    seed,
    rngState: 0,
    tick: 0,
    status: 'running',
    cash: STARTING_CASH,
    loan: LOAN,
    reputation: 0,
    rosterSlots: STARTING_ROSTER_SLOTS,
    waitingSeats: STARTING_SEATS,
    mercs: [],
    offers: [],
    seated: [],
    door: null,
    queue: [],
    timers: {},
    missions: [],
    homebound: [],
    bonds: {},
    nextOfferAt: 0,
    nextId: 1,
    stats: { jobsDone: 0, jobsFailed: 0, mercsLost: 0 },
  }
  state.mercs.push(generateMerc(state, rng), generateMerc(state, rng))
  state.nextOfferAt = rng.int(OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX)
  state.rngState = rng.getState()
  return state
}

export function tick(state: GameState): void {
  if (state.status !== 'running') return
  const rng = createRng(state.rngState)
  state.tick++

  for (const mission of [...state.missions]) updateMission(state, mission, rng)

  state.homebound = state.homebound.filter(h => h.arriveAt > state.tick)

  if (state.tick % HEAL_INTERVAL === 0) {
    const away = new Set<number>([
      ...state.missions.flatMap(m => [...m.squad, ...m.inbound.map(i => i.mercId)]),
      ...state.homebound.map(h => h.mercId),
    ])
    for (const merc of state.mercs) {
      if (!away.has(merc.id) && merc.hp < merc.maxHp) merc.hp++
    }
  }

  if (state.tick >= state.nextOfferAt) {
    state.offers.push(generateOffer(state, rng))
    state.nextOfferAt = state.tick + rng.int(OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX)
  }
  state.offers = state.offers.filter(o => o.expiresAt > state.tick)
  if (state.tick >= CYCLE_LENGTH) {
    state.status = state.cash >= state.loan ? 'won' : 'lost'
  }
  state.rngState = rng.getState()
}

function updateMission(state: GameState, mission: Mission, rng: Rng): void {
  // arrivals first: reinforcements join, supplies land
  const arrived = mission.inbound.filter(i => i.arriveAt <= state.tick)
  mission.inbound = mission.inbound.filter(i => i.arriveAt > state.tick)
  mission.squad.push(...arrived.map(i => i.mercId))

  const landed = mission.supplies.filter(su => su.arriveAt <= state.tick)
  mission.supplies = mission.supplies.filter(su => su.arriveAt > state.tick)
  for (const supply of landed) {
    if (supply.type === 'medkit') {
      const squadMercs = state.mercs.filter(m => mission.squad.includes(m.id))
      const target = squadMercs.sort((a, b) => a.hp - b.hp)[0]
      if (target) target.hp = Math.min(target.maxHp, target.hp + MEDKIT.heal)
    } else if (supply.type === 'suppressor') {
      mission.threatBar = Math.max(0, mission.threatBar - SUPPRESSOR.reduce)
    } else {
      mission.stimUntil = state.tick + STIM.duration
    }
  }

  let power = squadPower(state, mission.squad, mission.environment)
  if (state.tick <= mission.stimUntil) power = Math.floor(power * STIM.multiplier)

  mission.workDone += power
  if (mission.workDone >= mission.workRequired) {
    state.cash += mission.payout
    state.reputation += mission.rating
    state.stats.jobsDone++
    recordMissionTogether(state, mission.squad)
    for (const id of mission.squad) {
      state.homebound.push({ mercId: id, arriveAt: state.tick + REINFORCE_TRAVEL })
    }
    state.missions = state.missions.filter(m => m.id !== mission.id)
    return // no threat on the completing tick
  }

  const shortfall = mission.rating * THREAT_BASE_PER_RATING - power
  mission.threatBar += mission.rating + rng.int(0, 2 * Math.max(0, shortfall))

  while (mission.threatBar >= THREAT_CAP && mission.squad.length > 0) {
    mission.threatBar -= THREAT_CAP
    mission.threatLevel++
    const victimId = mission.squad[rng.int(0, mission.squad.length - 1)]
    const victim = state.mercs.find(m => m.id === victimId)!
    const dmg = Math.max(1, mission.rating * mission.threatLevel + rng.int(-CONSEQUENCE_SPREAD, CONSEQUENCE_SPREAD))
    victim.hp -= dmg
    if (victim.hp <= 0) {
      state.mercs = state.mercs.filter(m => m.id !== victimId)
      mission.squad = mission.squad.filter(id => id !== victimId)
      state.stats.mercsLost++
    }
  }

  if (mission.squad.length === 0 && mission.inbound.length === 0) {
    state.missions = state.missions.filter(m => m.id !== mission.id)
    state.reputation = Math.max(0, state.reputation - mission.rating)
    state.stats.jobsFailed++
  }
}
