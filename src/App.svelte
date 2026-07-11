<script lang="ts">
  import { game, startLoop, togglePause, restart } from './ui/store.svelte'
  import { CYCLE_LENGTH } from './sim/balance'
  import RosterTab from './ui/RosterTab.svelte'
  import JobsTab from './ui/JobsTab.svelte'
  import MissionsTab from './ui/MissionsTab.svelte'
  import EndScreen from './ui/EndScreen.svelte'

  let confirmingRestart = $state(false)
  let restartTimeout: ReturnType<typeof setTimeout> | undefined
  startLoop()

  function onRestartClick(): void {
    if (confirmingRestart) {
      clearTimeout(restartTimeout)
      confirmingRestart = false
      restart()
    } else {
      confirmingRestart = true
      restartTimeout = setTimeout(() => (confirmingRestart = false), 4000)
    }
  }

  const ticksLeft = $derived(Math.max(0, CYCLE_LENGTH - game.state.tick))
  const clock = $derived(
    `${Math.floor(ticksLeft / 60)}:${String(ticksLeft % 60).padStart(2, '0')}`,
  )
</script>

<header>
  <span class="cash">{game.state.cash}cr</span>
  <span class="loan">loan {game.state.loan}cr · {clock}</span>
  <span class="rep">rep {game.state.reputation}</span>
  <button
    class="ghost restart"
    class:danger={confirmingRestart}
    onclick={onRestartClick}
    title="quit and restart"
  >
    {confirmingRestart ? 'confirm wipe' : '⟲'}
  </button>
  <button class="pause" onclick={togglePause}>{game.paused ? '▶' : '⏸'}</button>
</header>

<main>
  <section>
    <h2>ACTIVE MISSIONS ({game.state.missions.length})</h2>
    <MissionsTab />
  </section>

  <section>
    <h2>INCOMING</h2>
    <JobsTab />
  </section>

  <section>
    <h2>AT BASE ({game.state.mercs.length}/{game.state.rosterSlots})</h2>
    <RosterTab />
  </section>
</main>

{#if game.state.status !== 'running'}
  <EndScreen />
{/if}
