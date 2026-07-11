import type { GameState, Offer, SupplyType } from './types'
import {
  SLOT_PRICES, SEAT_PRICES, MAX_ROSTER_SLOTS, MAX_SEATS,
  MEDBAY_PER_HP, STARTING_ROSTER_SLOTS, STARTING_SEATS,
  MEDKIT, SUPPRESSOR, STIM, REINFORCE_TRAVEL, SUPPLY_TRAVEL,
} from './balance'

export function idleMercIds(state: GameState): number[] {
  const away = new Set<number>([
    ...state.missions.flatMap(m => [...m.squad, ...m.inbound.map(i => i.mercId)]),
    ...state.homebound.map(h => h.mercId),
  ])
  return state.mercs.filter(m => !away.has(m.id)).map(m => m.id)
}

function takeOffer(state: GameState, offerId: number): Offer {
  const offer = state.seated.find(o => o.id === offerId)
  if (!offer) throw new Error(`no offer ${offerId}`)
  state.seated = state.seated.filter(o => o.id !== offerId)
  return offer
}

export function rejectOffer(state: GameState, offerId: number): void {
  takeOffer(state, offerId)
}

/** Pin a seated offer so it never times out. The seat it holds never frees, so
 *  incoming offers throttle by one — that lost throughput is the whole cost.
 *  Permanent: the only exit is hiring, accepting, or rejecting the offer. */
export function takeSeat(state: GameState, offerId: number): void {
  const offer = state.seated.find(o => o.id === offerId)
  if (!offer) throw new Error(`no offer ${offerId}`)
  offer.locked = true // idempotent: no-op if already locked
}

export function hire(state: GameState, offerId: number): void {
  const offer = state.seated.find(o => o.id === offerId)
  if (!offer || offer.kind !== 'candidate') throw new Error(`no candidate offer ${offerId}`)
  const merc = offer.candidate!
  if (state.mercs.length >= state.rosterSlots) throw new Error('roster is full')
  if (state.cash < merc.hirePrice) throw new Error('cannot afford hire')
  takeOffer(state, offerId)
  state.cash -= merc.hirePrice
  state.mercs.push(merc)
}

export function dispatch(state: GameState, offerId: number, mercIds: number[]): number {
  const offer = state.seated.find(o => o.id === offerId)
  if (!offer || offer.kind !== 'job') throw new Error(`no job offer ${offerId}`)
  if (mercIds.length === 0) throw new Error('squad is empty')
  const idle = new Set(idleMercIds(state))
  for (const id of mercIds) {
    if (!idle.has(id)) throw new Error(`merc ${id} is not idle`)
  }
  takeOffer(state, offerId)
  const job = offer.job!
  const mission = {
    id: state.nextId++,
    rating: job.rating,
    environment: job.environment,
    payout: job.payout,
    workRequired: job.work,
    workDone: 0,
    threatBar: 0,
    threatLevel: 0,
    squad: [...mercIds],
    inbound: [],
    supplies: [],
    stimUntil: 0,
  }
  state.missions.push(mission)
  return mission.id
}

export function dismiss(state: GameState, mercId: number): void {
  if (!idleMercIds(state).includes(mercId)) throw new Error('merc is not idle')
  state.mercs = state.mercs.filter(m => m.id !== mercId)
}

export function buySlot(state: GameState): void {
  if (state.rosterSlots >= MAX_ROSTER_SLOTS) throw new Error('roster slots at max')
  const price = SLOT_PRICES[state.rosterSlots - STARTING_ROSTER_SLOTS]
  if (state.cash < price) throw new Error('cannot afford slot')
  state.cash -= price
  state.rosterSlots++
}

export function buySeat(state: GameState): void {
  if (state.waitingSeats >= MAX_SEATS) throw new Error('seats at max')
  const price = SEAT_PRICES[state.waitingSeats - STARTING_SEATS]
  if (state.cash < price) throw new Error('cannot afford seat')
  state.cash -= price
  state.waitingSeats++
}

export function medbayHeal(state: GameState, mercId: number): number {
  if (!idleMercIds(state).includes(mercId)) throw new Error('merc is not idle')
  const merc = state.mercs.find(m => m.id === mercId)!
  const missing = merc.maxHp - merc.hp
  if (missing <= 0) throw new Error('already at full hp')
  const price = missing * MEDBAY_PER_HP
  if (state.cash < price) throw new Error('cannot afford heal')
  state.cash -= price
  merc.hp = merc.maxHp
  return price
}

const SUPPLY_PRICES: Record<SupplyType, number> = {
  medkit: MEDKIT.price,
  suppressor: SUPPRESSOR.price,
  stim: STIM.price,
}

function findMission(state: GameState, missionId: number) {
  const mission = state.missions.find(m => m.id === missionId)
  if (!mission) throw new Error(`no mission ${missionId}`)
  return mission
}

export function reinforce(state: GameState, missionId: number, mercId: number): void {
  const mission = findMission(state, missionId)
  if (!idleMercIds(state).includes(mercId)) throw new Error('merc is not idle')
  mission.inbound.push({ mercId, arriveAt: state.tick + REINFORCE_TRAVEL })
}

export function withdraw(state: GameState, missionId: number, mercId: number): void {
  const mission = findMission(state, missionId)
  if (!mission.squad.includes(mercId)) throw new Error('merc is not on this mission')
  mission.squad = mission.squad.filter(id => id !== mercId)
  state.homebound.push({ mercId, arriveAt: state.tick + REINFORCE_TRAVEL })
}

export function sendSupply(state: GameState, missionId: number, type: SupplyType): void {
  const mission = findMission(state, missionId)
  const price = SUPPLY_PRICES[type]
  if (state.cash < price) throw new Error('cannot afford supply')
  state.cash -= price
  mission.supplies.push({ type, arriveAt: state.tick + SUPPLY_TRAVEL })
}
