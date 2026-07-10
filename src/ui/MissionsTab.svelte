<script lang="ts">
  import { game, act } from './store.svelte'
  import { reinforce, withdraw, sendSupply, idleMercIds } from '../sim/actions'
  import { MEDKIT, SUPPRESSOR, STIM, THREAT_CAP, DANGER_THREAT } from '../sim/balance'
  import type { Mission } from '../sim/types'

  let pickingFor: number | null = $state(null) // mission id whose reinforce picker is open

  const idle = $derived(idleMercIds(game.state))
  const idleMercs = $derived(game.state.mercs.filter(m => idle.includes(m.id)))

  function squadMercs(mission: Mission) {
    return game.state.mercs.filter(m => mission.squad.includes(m.id))
  }

  const supplies = [
    { type: 'medkit', price: MEDKIT.price, label: `medkit ${MEDKIT.price}cr` },
    { type: 'suppressor', price: SUPPRESSOR.price, label: `suppressor ${SUPPRESSOR.price}cr` },
    { type: 'stim', price: STIM.price, label: `stim ${STIM.price}cr` },
  ] as const
</script>

{#each game.state.missions as mission (mission.id)}
  <div class="card" class:hot={mission.threatBar >= DANGER_THREAT}>
    <div class="row">
      <strong>{'★'.repeat(mission.rating)} {mission.environment}</strong>
      <span class="dim">{mission.payout}cr · threat lv {mission.threatLevel}</span>
    </div>

    <div class="dim">completion {Math.floor((mission.workDone / mission.workRequired) * 100)}%</div>
    <div class="bar"><div style="width:{(mission.workDone / mission.workRequired) * 100}%; background:var(--accent)"></div></div>

    <div class="dim">threat {mission.threatBar}/{THREAT_CAP}</div>
    <div class="bar"><div style="width:{(mission.threatBar / THREAT_CAP) * 100}%; background:var(--danger)"></div></div>

    {#each squadMercs(mission) as merc (merc.id)}
      <div class="row chip">
        <span>{merc.name} {merc.hp}/{merc.maxHp}hp</span>
        <button class="ghost small" onclick={() => act(() => withdraw(game.state, mission.id, merc.id))}>pull out</button>
      </div>
    {/each}
    {#each mission.inbound as inb (inb.mercId)}
      <div class="chip dim">↳ reinforcement arrives in {inb.arriveAt - game.state.tick}s</div>
    {/each}
    {#each mission.supplies as sup, i (i)}
      <div class="chip dim">📦 {sup.type} lands in {sup.arriveAt - game.state.tick}s</div>
    {/each}
    {#if game.state.tick <= mission.stimUntil}
      <div class="chip" style="color:var(--ok)">stim active ({mission.stimUntil - game.state.tick}s)</div>
    {/if}

    <div class="row">
      <button class="ghost" disabled={idleMercs.length === 0} onclick={() => (pickingFor = pickingFor === mission.id ? null : mission.id)}>
        reinforce
      </button>
      {#each supplies as s (s.type)}
        <button class="ghost small" disabled={game.state.cash < s.price}
          onclick={() => act(() => sendSupply(game.state, mission.id, s.type))}>
          {s.label}
        </button>
      {/each}
    </div>
    {#if pickingFor === mission.id}
      {#each idleMercs as merc (merc.id)}
        <button class="ghost small" onclick={() => { act(() => reinforce(game.state, mission.id, merc.id)); pickingFor = null }}>
          send {merc.name}
        </button>
      {/each}
    {/if}
  </div>
{/each}

{#if game.state.missions.length === 0}
  <p class="dim">no missions running — the loan clock doesn't care</p>
{/if}

<style>
  .row { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .card.hot { border-color: var(--danger); }
  .chip { font-size: 0.85rem; margin: 0.2rem 0; }
  .small { font-size: 0.75rem; padding: 0.25rem 0.5rem; }
</style>
