import type { GameState, Merc, MercClass, Environment, Offer } from './types'
import type { Rng } from './rng'
import {
  HP_BASE, HP_PER_RANK, HIRE_COST_PER_RANK_SQ, PAYOUT_PER_RATING_SQ,
  WORK_PER_RATING, OFFER_TTL_MIN, OFFER_TTL_MAX, CANDIDATE_CHANCE, REP_PER_TIER,
} from './balance'

const FIRST = ['Vera', 'Dax', 'Imani', 'Rook', 'Sana', 'Bruno', 'Kestrel', 'Ozzy', 'Mara', 'Tunde', 'Lena', 'Cassius', 'Piotr', 'Yuki', 'Salome', 'Grif', 'Nadia', 'Emeka', 'Wren', 'Halvor']
const LAST = ['Okafor', 'Vasquez', 'Crane', 'Ferro', 'Adeyemi', 'Strand', 'Kovac', 'Bellamy', 'Ash', 'Duran', 'Mbeki', 'Voss', 'Iwu', 'Reyes', 'Okonkwo', 'Lindqvist', 'Baptiste', 'Ngata', 'Sorel', 'Krupin']
const CLASSES: MercClass[] = ['Breacher', 'Scout', 'Medic', 'Gunner', 'Fixer', 'Sniper']
const ENVIRONMENTS: Environment[] = ['urban', 'rural', 'forest']

export function maxTier(reputation: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor(reputation / REP_PER_TIER)))
}

export function generateMerc(state: GameState, rng: Rng): Merc {
  const rank = rng.int(1, maxTier(state.reputation))
  const maxHp = HP_BASE + HP_PER_RANK * rank
  return {
    id: state.nextId++,
    name: `${FIRST[rng.int(0, FIRST.length - 1)]} ${LAST[rng.int(0, LAST.length - 1)]}`,
    klass: CLASSES[rng.int(0, CLASSES.length - 1)],
    rank,
    hp: maxHp,
    maxHp,
    affinity: ENVIRONMENTS[rng.int(0, ENVIRONMENTS.length - 1)],
    hirePrice: rank * rank * HIRE_COST_PER_RANK_SQ,
  }
}

export function generateOffer(state: GameState, rng: Rng): Offer {
  const expiresAt = state.tick + rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
  if (rng.next() < CANDIDATE_CHANCE) {
    return { id: state.nextId++, kind: 'candidate', postedAt: state.tick, expiresAt, candidate: generateMerc(state, rng) }
  }
  const rating = rng.int(1, maxTier(state.reputation))
  return {
    id: state.nextId++,
    kind: 'job',
    postedAt: state.tick,
    expiresAt,
    job: {
      rating,
      environment: ENVIRONMENTS[rng.int(0, ENVIRONMENTS.length - 1)],
      payout: rating * rating * PAYOUT_PER_RATING_SQ,
      work: rating * WORK_PER_RATING,
    },
  }
}
