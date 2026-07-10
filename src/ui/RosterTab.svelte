<script lang="ts">
  import { game, act } from './store.svelte'
  import { dismiss, medbayHeal, buySlot, idleMercIds } from '../sim/actions'
  import { pairKey, bondLevel } from '../sim/bonds'
  import { SLOT_PRICES, STARTING_ROSTER_SLOTS, MAX_ROSTER_SLOTS, MEDBAY_PER_HP } from '../sim/balance'

  let confirmingDismiss: number | null = $state(null)
  let highlighted: number | null = $state(null)

  const idle = $derived(new Set(idleMercIds(game.state)))
  const traveling = $derived(new Set(game.state.homebound.map(h => h.mercId)))

  function status(id: number): string {
    if (idle.has(id)) return 'idle'
    if (traveling.has(id)) return 'traveling'
    return 'on mission'
  }

  function bondsFor(id: number): { partnerId: number; name: string; level: number }[] {
    return game.state.mercs
      .filter(other => other.id !== id)
      .map(other => ({ partnerId: other.id, name: other.name, level: bondLevel(game.state.bonds[pairKey(id, other.id)] ?? 0) }))
      .filter(b => b.level > 0)
  }

  const nextSlotPrice = $derived(
    game.state.rosterSlots < MAX_ROSTER_SLOTS
      ? SLOT_PRICES[game.state.rosterSlots - STARTING_ROSTER_SLOTS]
      : null,
  )
</script>

{#each game.state.mercs as merc (merc.id)}
  <div class="card" class:highlight={highlighted === merc.id}>
    <div class="row">
      <strong>{merc.name}</strong>
      <span class="dim">{merc.klass} · {'★'.repeat(merc.rank)} · {merc.affinity}</span>
    </div>
    <div class="bar"><div style="width:{(merc.hp / merc.maxHp) * 100}%; background:var(--ok)"></div></div>
    <div class="row dim">
      <span>{merc.hp}/{merc.maxHp} hp · {status(merc.id)}</span>
    </div>
    {#each bondsFor(merc.id) as bond (bond.partnerId)}
      <button class="bond" onclick={() => (highlighted = highlighted === bond.partnerId ? null : bond.partnerId)}>
        🔗 {bond.name} {'★'.repeat(bond.level)}
      </button>
    {/each}
    <div class="row">
      {#if merc.hp < merc.maxHp && idle.has(merc.id)}
        <button
          class="ghost"
          disabled={game.state.cash < (merc.maxHp - merc.hp) * MEDBAY_PER_HP}
          onclick={() => act(() => medbayHeal(game.state, merc.id))}
        >
          heal {(merc.maxHp - merc.hp) * MEDBAY_PER_HP}cr
        </button>
      {/if}
      {#if confirmingDismiss === merc.id}
        <button class="ghost danger" disabled={!idle.has(merc.id)} onclick={() => act(() => dismiss(game.state, merc.id))}>confirm dismissal</button>
        <button class="ghost" onclick={() => (confirmingDismiss = null)}>keep</button>
      {:else}
        <button class="ghost" disabled={!idle.has(merc.id)} onclick={() => (confirmingDismiss = merc.id)}>dismiss</button>
      {/if}
    </div>
  </div>
{/each}

{#each Array(Math.max(0, game.state.rosterSlots - game.state.mercs.length)) as _, i (i)}
  <div class="card empty dim">empty slot</div>
{/each}

{#if nextSlotPrice !== null}
  <button class="card locked dim" disabled={game.state.cash < nextSlotPrice} onclick={() => act(() => buySlot(game.state))}>
    🔒 unlock slot — {nextSlotPrice}cr
  </button>
{/if}

<style>
  .row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .card.highlight { border-color: var(--accent); }
  .card.empty, .card.locked { text-align: center; width: 100%; }
  .bond { background: none; border: none; color: var(--accent); padding: 0.15rem 0; display: block; font-size: 0.85rem; }
</style>
