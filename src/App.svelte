<script lang="ts">
  import { game, startLoop, togglePause } from './ui/store.svelte'
  import { CYCLE_LENGTH, DANGER_THREAT } from './sim/balance'
  import RosterTab from './ui/RosterTab.svelte'
  import JobsTab from './ui/JobsTab.svelte'
  import MissionsTab from './ui/MissionsTab.svelte'
  import EndScreen from './ui/EndScreen.svelte'

  let tab: 'roster' | 'jobs' | 'missions' = $state('jobs')
  startLoop()

  const ticksLeft = $derived(Math.max(0, CYCLE_LENGTH - game.state.tick))
  const clock = $derived(
    `${Math.floor(ticksLeft / 60)}:${String(ticksLeft % 60).padStart(2, '0')}`,
  )
  const dangerCount = $derived(game.state.missions.filter(m => m.threatBar >= DANGER_THREAT).length)
</script>

<header>
  <span class="cash">{game.state.cash}cr</span>
  <span class="loan">loan {game.state.loan}cr · {clock}</span>
  <span class="rep">rep {game.state.reputation}</span>
  <button class="pause" onclick={togglePause}>{game.paused ? '▶' : '⏸'}</button>
</header>

<main>
  {#if tab === 'roster'}<RosterTab />{/if}
  {#if tab === 'jobs'}<JobsTab />{/if}
  {#if tab === 'missions'}<MissionsTab />{/if}
</main>

<nav>
  <button class:active={tab === 'roster'} onclick={() => (tab = 'roster')}>
    Roster ({game.state.mercs.length}/{game.state.rosterSlots})
  </button>
  <button class:active={tab === 'jobs'} onclick={() => (tab = 'jobs')}>
    Jobs ({game.state.offers.length + game.state.seated.length})
  </button>
  <button class:active={tab === 'missions'} onclick={() => (tab = 'missions')}>
    Missions ({game.state.missions.length}){#if dangerCount > 0}<span class="danger-badge">{dangerCount}</span>{/if}
  </button>
</nav>

{#if game.state.status !== 'running'}
  <EndScreen />
{/if}
