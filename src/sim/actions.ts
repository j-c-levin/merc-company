import type { GameState, Offer } from './types'

export function idleMercIds(state: GameState): number[] {
  const away = new Set<number>([
    ...state.missions.flatMap(m => [...m.squad, ...m.inbound.map(i => i.mercId)]),
    ...state.homebound.map(h => h.mercId),
  ])
  return state.mercs.filter(m => !away.has(m.id)).map(m => m.id)
}

function takeOffer(state: GameState, offerId: number): Offer {
  const fromOffers = state.offers.find(o => o.id === offerId)
  const fromSeated = state.seated.find(o => o.id === offerId)
  const offer = fromOffers ?? fromSeated
  if (!offer) throw new Error(`no offer ${offerId}`)
  state.offers = state.offers.filter(o => o.id !== offerId)
  state.seated = state.seated.filter(o => o.id !== offerId)
  return offer
}

export function seatOffer(state: GameState, offerId: number): void {
  if (state.seated.length >= state.waitingSeats) throw new Error('no free seat')
  const offer = state.offers.find(o => o.id === offerId)
  if (!offer) throw new Error(`no unseated offer ${offerId}`)
  state.offers = state.offers.filter(o => o.id !== offerId)
  state.seated.push(offer)
}

export function rejectOffer(state: GameState, offerId: number): void {
  takeOffer(state, offerId)
}

export function hire(state: GameState, offerId: number): void {
  const offer = state.offers.find(o => o.id === offerId) ?? state.seated.find(o => o.id === offerId)
  if (!offer || offer.kind !== 'candidate') throw new Error(`no candidate offer ${offerId}`)
  const merc = offer.candidate!
  if (state.mercs.length >= state.rosterSlots) throw new Error('roster is full')
  if (state.cash < merc.hirePrice) throw new Error('cannot afford hire')
  takeOffer(state, offerId)
  state.cash -= merc.hirePrice
  state.mercs.push(merc)
}

export function dispatch(state: GameState, offerId: number, mercIds: number[]): number {
  const offer = state.offers.find(o => o.id === offerId) ?? state.seated.find(o => o.id === offerId)
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
