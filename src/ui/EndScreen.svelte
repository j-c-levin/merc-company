<script lang="ts">
  import { game, restart } from './store.svelte'
  const won = $derived(game.state.status === 'won')
</script>

<div class="overlay">
  <div class="panel">
    <h2>{won ? 'Paid in full.' : 'They broke your legs.'}</h2>
    <p class="dim">
      {won
        ? `You cleared the ${game.state.loan}cr loan with ${game.state.cash - game.state.loan}cr to spare.`
        : `You were ${game.state.loan - game.state.cash}cr short.`}
    </p>
    <ul class="dim">
      <li>jobs completed: {game.state.stats.jobsDone}</li>
      <li>jobs failed: {game.state.stats.jobsFailed}</li>
      <li>mercs lost: {game.state.stats.mercsLost}</li>
      <li>mercs standing: {game.state.mercs.length}</li>
      <li>reputation: {game.state.reputation}</li>
    </ul>
    <button class="action" onclick={restart}>{won ? 'run it back' : 'new company, new name'}</button>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); display: flex; align-items: center; justify-content: center; z-index: 20; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 1.5rem; width: min(90vw, 380px); }
  ul { list-style: none; padding: 0; }
</style>
