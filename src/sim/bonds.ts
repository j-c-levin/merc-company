import type { GameState, Environment } from './types'
import { BOND_THRESHOLDS } from './balance'

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function bondLevel(points: number): number {
  let level = 0
  for (const t of BOND_THRESHOLDS) if (points >= t) level++
  return level
}

export function recordMissionTogether(state: GameState, mercIds: number[]): void {
  for (let i = 0; i < mercIds.length; i++) {
    for (let j = i + 1; j < mercIds.length; j++) {
      const key = pairKey(mercIds[i], mercIds[j])
      state.bonds[key] = (state.bonds[key] ?? 0) + 1
    }
  }
}

export function squadPower(state: GameState, mercIds: number[], environment: Environment): number {
  let power = 0
  for (const id of mercIds) {
    const m = state.mercs.find(x => x.id === id)
    if (!m) continue
    power += m.rank * (m.affinity === environment ? 2 : 1)
  }
  for (let i = 0; i < mercIds.length; i++) {
    for (let j = i + 1; j < mercIds.length; j++) {
      power += bondLevel(state.bonds[pairKey(mercIds[i], mercIds[j])] ?? 0)
    }
  }
  return power
}
