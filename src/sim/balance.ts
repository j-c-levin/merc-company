export const SCHEMA_VERSION = 2
export const CYCLE_LENGTH = 1500
export const LOAN = 5000
export const STARTING_CASH = 500
export const WORK_PER_RATING = 100      // design anchor
export const THREAT_BASE_PER_RATING = 5 // design anchor
export const THREAT_CAP = 18            // design anchor
export const CONSEQUENCE_SPREAD = 2
export const HP_BASE = 15
export const HP_PER_RANK = 5
export const HIRE_COST_PER_RANK_SQ = 100
export const PAYOUT_PER_RATING_SQ = 150
export const STARTING_ROSTER_SLOTS = 3
export const MAX_ROSTER_SLOTS = 6
export const SLOT_PRICES = [300, 600, 1000] // 4th, 5th, 6th
export const STARTING_SEATS = 2
export const MAX_SEATS = 3
export const SEAT_PRICE = 250
export const OFFER_ARRIVAL_MIN = 40
export const OFFER_ARRIVAL_MAX = 60
export const OFFER_TTL_MIN = 60
export const OFFER_TTL_MAX = 90
export const CANDIDATE_CHANCE = 0.3     // else the offer is a job
export const MEDKIT = { price: 100, heal: 10 }
export const SUPPRESSOR = { price: 150, reduce: 9 }
export const STIM = { price: 150, multiplier: 1.5, duration: 10 }
export const REINFORCE_TRAVEL = 5
export const SUPPLY_TRAVEL = 3
export const BOND_THRESHOLDS = [2, 5, 9] // missions together for levels 1/2/3
export const HEAL_INTERVAL = 5          // idle mercs heal 1 hp every N ticks
export const MEDBAY_PER_HP = 10         // instant heal price per missing hp
export const REP_PER_TIER = 4           // rep needed per extra offer/candidate tier
export const DANGER_THREAT = 12         // threatBar at/above this counts as a "hot" mission in the UI

// ── offer pump ────────────────────────────────────────────────────────────
// Per-tier arrival timers. `slow` is the interval (ticks) at unlockRep;
// it ramps linearly to `fast` over REP_RAMP reputation and clamps there.
export const JOB_TIERS: { rating: number; unlockRep: number; slow: number; fast: number }[] = [
  { rating: 1, unlockRep: 0,  slow: 40,  fast: 26  },
  { rating: 2, unlockRep: 4,  slow: 65,  fast: 40  },
  { rating: 3, unlockRep: 8,  slow: 95,  fast: 58  },
  { rating: 4, unlockRep: 12, slow: 130, fast: 80  },
  { rating: 5, unlockRep: 16, slow: 170, fast: 105 },
]
export const CANDIDATE_ARRIVAL = { slow: 60, fast: 45 }
export const REP_RAMP = 16
export const ARRIVAL_JITTER = 0.15
