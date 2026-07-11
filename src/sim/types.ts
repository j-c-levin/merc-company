export type Environment = 'urban' | 'rural' | 'forest'
export type MercClass = 'Breacher' | 'Scout' | 'Medic' | 'Gunner' | 'Fixer' | 'Sniper'
export type SupplyType = 'medkit' | 'suppressor' | 'stim'

export interface Merc {
  id: number
  name: string
  klass: MercClass
  rank: number // 1-5
  hp: number
  maxHp: number
  affinity: Environment
  hirePrice: number
}

export interface JobDetails {
  rating: number // 1-5
  environment: Environment
  payout: number
  work: number // rating × WORK_PER_RATING
}

export type TimerKey = 'job1' | 'job2' | 'job3' | 'job4' | 'job5' | 'candidate'

export interface Offer {
  id: number
  kind: 'job' | 'candidate'
  source: TimerKey // which timer/tier this offer represents; used for the offer-mix harness
  postedAt: number // tick the offer took its seat
  expiresAt: number // tick at which it auto-rejects (times out) and frees the seat
  locked?: boolean // pinned via "take a seat": never expires, holds its seat until hired/accepted/rejected
  job?: JobDetails
  candidate?: Merc
}

export interface Inbound { mercId: number; arriveAt: number }
export interface SupplyInbound { type: SupplyType; arriveAt: number }
export interface Homebound { mercId: number; arriveAt: number }

export interface Mission {
  id: number
  rating: number
  environment: Environment
  payout: number
  workRequired: number
  workDone: number
  threatBar: number
  threatLevel: number
  squad: number[] // merc ids on site
  inbound: Inbound[]
  supplies: SupplyInbound[]
  stimUntil: number // tick until which stim is active; 0 = none
}

export interface GameState {
  schemaVersion: number
  seed: number
  rngState: number
  tick: number
  status: 'running' | 'won' | 'lost'
  cash: number
  loan: number
  reputation: number
  rosterSlots: number
  waitingSeats: number
  mercs: Merc[]
  seated: Offer[] // the waiting room: one offer per seat, capped at waitingSeats
  nextOfferAt: number // tick the next offer is scheduled to arrive; 0 = reschedule me
  missions: Mission[]
  homebound: Homebound[] // mercs traveling back (withdrawal / mission end)
  bonds: Record<string, number> // pairKey -> missions completed together
  nextId: number
  stats: { jobsDone: number; jobsFailed: number; mercsLost: number }
}
