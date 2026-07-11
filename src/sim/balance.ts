export const SCHEMA_VERSION = 4
export const CYCLE_LENGTH = 1500
export const LOAN = 5000
export const STARTING_CASH = 500
export const WORK_PER_RATING = 39       // design anchor: 30% longer missions
export const THREAT_BASE_PER_RATING = 3 // design anchor
export const THREAT_CAP = 23            // design anchor: scaled ~×1.3 with work so per-mission consequence count holds
export const CONSEQUENCE_SPREAD = 2
export const HP_BASE = 15
export const HP_PER_RANK = 5
export const HIRE_COST_PER_RANK_SQ = 100
export const PAYOUT_PER_RATING_SQ = 150
export const STARTING_ROSTER_SLOTS = 3
export const MAX_ROSTER_SLOTS = 6
export const SLOT_PRICES = [300, 600, 1000] // 4th, 5th, 6th
export const STARTING_SEATS = 1
export const MAX_SEATS = 5
export const SEAT_PRICES = [250, 400, 600, 900] // seats 2..5, escalating like SLOT_PRICES
export const OFFER_TTL_MIN = 18
export const OFFER_TTL_MAX = 24
export const MEDKIT = { price: 100, heal: 10 }
export const SUPPRESSOR = { price: 150, reduce: 9 }
export const STIM = { price: 150, multiplier: 1.5, duration: 10 }
export const REINFORCE_TRAVEL = 5
export const SUPPLY_TRAVEL = 3
export const BOND_THRESHOLDS = [2, 5, 9] // missions together for levels 1/2/3
export const HEAL_INTERVAL = 5          // idle mercs heal 1 hp every N ticks
export const MEDBAY_PER_HP = 10         // instant heal price per missing hp
export const REP_PER_TIER = 4           // rep needed per extra offer/candidate tier
export const DANGER_THREAT = 15         // threatBar at/above this counts as a "hot" mission in the UI

// ── offer pump ────────────────────────────────────────────────────────────
// Per-tier arrival timers. `atUnlock` is the interval (ticks) at unlockRep;
// it ramps linearly to `ramped` over REP_RAMP reputation and clamps there.
// Low tiers ramp SLOWER with reputation (interval grows) and high tiers ramp
// FASTER, shifting the offer mix toward high-star jobs as the company ranks up.
export const JOB_TIERS: { rating: number; unlockRep: number; atUnlock: number; ramped: number }[] = [
  { rating: 1, unlockRep: 0,  atUnlock: 14,  ramped: 130 },
  { rating: 2, unlockRep: 4,  atUnlock: 32,  ramped: 38  },
  { rating: 3, unlockRep: 8,  atUnlock: 55,  ramped: 34  },
  { rating: 4, unlockRep: 12, atUnlock: 80,  ramped: 44  },
  { rating: 5, unlockRep: 16, atUnlock: 110, ramped: 55  },
]
export const CANDIDATE_ARRIVAL = { atUnlock: 60, ramped: 45 }
export const REP_RAMP = 16
export const ARRIVAL_JITTER = 0.15
