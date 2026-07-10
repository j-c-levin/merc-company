import type { GameState, Environment } from './types'
import { squadPower } from './bonds'
import { WORK_PER_RATING, THREAT_BASE_PER_RATING, THREAT_CAP } from './balance'

export interface Projection {
  power: number
  shortfall: number
  durationTicks: number
  minConsequences: number
  expectedConsequences: number
  maxConsequences: number
}

export function project(
  state: GameState, mercIds: number[], rating: number, environment: Environment,
): Projection {
  const power = squadPower(state, mercIds, environment)
  const durationTicks = power > 0 ? Math.ceil((rating * WORK_PER_RATING) / power) : Infinity
  const shortfall = rating * THREAT_BASE_PER_RATING - power
  const over = Math.max(0, shortfall)
  const consequencesAt = (perTick: number) =>
    Number.isFinite(durationTicks) ? Math.floor((durationTicks * perTick) / THREAT_CAP) : Infinity
  return {
    power,
    shortfall,
    durationTicks,
    minConsequences: consequencesAt(rating),
    expectedConsequences: consequencesAt(rating + over),
    maxConsequences: consequencesAt(rating + 2 * over),
  }
}
