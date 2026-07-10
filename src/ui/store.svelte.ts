import { newRun, tick } from '../sim/tick'
import type { GameState } from '../sim/types'
import { SCHEMA_VERSION } from '../sim/balance'

const SAVE_KEY = 'merc-company-save-v1'

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const state = JSON.parse(raw) as GameState
    if (state.schemaVersion !== SCHEMA_VERSION) return null
    return state
  } catch {
    return null
  }
}

function freshState(): GameState {
  const seedParam = params().get('seed')
  const parsed = seedParam ? Number(seedParam) : NaN
  return newRun(Number.isFinite(parsed) ? parsed : Date.now() % 0xffffffff)
}

export const game = $state({
  state: load() ?? freshState(),
  paused: false,
})

export function saveNow(): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(game.state))
}

export function act(fn: () => void): void {
  fn()
  saveNow()
}

export function togglePause(): void {
  game.paused = !game.paused
}

export function restart(): void {
  localStorage.removeItem(SAVE_KEY)
  game.state = freshState()
  game.paused = false
}

let started = false
export function startLoop(): void {
  if (started) return
  started = true
  const speedParam = Number(params().get('speed') ?? 1)
  const speed = Number.isFinite(speedParam) && speedParam > 0 ? speedParam : 1
  setInterval(() => {
    if (!game.paused && game.state.status === 'running') {
      tick(game.state)
      saveNow()
    }
  }, 1000 / Math.max(speed, 0.001))
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.paused = true
      saveNow()
    }
  })
  // e2e hook: lets Playwright assert on raw state
  ;(window as any).__game = game
}
