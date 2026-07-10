<script lang="ts">
  import { game, act } from './store.svelte'
  import { dispatch, idleMercIds } from '../sim/actions'
  import { project } from '../sim/projection'
  import { pairKey, bondLevel } from '../sim/bonds'
  import type { Offer } from '../sim/types'

  let { offer, onclose }: { offer: Offer; onclose: () => void } = $props()

  let selected: number[] = $state([])
  const idle = $derived(idleMercIds(game.state))
  const idleMercs = $derived(game.state.mercs.filter(m => idle.includes(m.id)))
  const forecast = $derived(project(game.state, selected, offer.job!.rating, offer.job!.environment))
  const offerAlive = $derived(
    game.state.offers.some(o => o.id === offer.id) || game.state.seated.some(o => o.id === offer.id)
  )
  const activeBonds = $derived.by(() => {
    const bonds: { nameA: string; nameB: string; level: number }[] = []
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        const level = bondLevel(game.state.bonds[pairKey(selected[i], selected[j])] ?? 0)
        if (level <= 0) continue
        const a = game.state.mercs.find(m => m.id === selected[i])
        const b = game.state.mercs.find(m => m.id === selected[j])
        if (a && b) bonds.push({ nameA: a.name, nameB: b.name, level })
      }
    }
    return bonds
  })

  function toggle(id: number): void {
    selected = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
  }

  function launch(): void {
    act(() => dispatch(game.state, offer.id, selected))
    onclose()
  }
</script>

<div class="overlay">
  <div class="sheet">
    <h3>{'★'.repeat(offer.job!.rating)} {offer.job!.environment} job · {offer.job!.payout}cr</h3>

    {#each idleMercs as merc (merc.id)}
      <button class="pick" class:on={selected.includes(merc.id)} onclick={() => toggle(merc.id)}>
        {merc.name} · {'★'.repeat(merc.rank)}
        {#if merc.affinity === offer.job!.environment}<span class="match">home turf ×2</span>{/if}
        <span class="dim">{merc.hp}/{merc.maxHp} hp</span>
      </button>
    {/each}
    {#if idleMercs.length === 0}
      <p class="dim">nobody is idle</p>
    {/if}

    {#if activeBonds.length > 0}
      <div class="bonds dim">
        {#each activeBonds as b (b.nameA + b.nameB)}
          <div>🔗 {b.nameA} + {b.nameB} ★×{b.level}</div>
        {/each}
      </div>
    {/if}

    <div class="forecast">
      {#if !offerAlive}
        <span class="dim">they got tired of waiting — offer gone</span>
      {:else if selected.length === 0}
        <span class="dim">pick a squad</span>
      {:else}
        <div>duration: ~{forecast.durationTicks}s</div>
        <div class:hot={forecast.maxConsequences > forecast.minConsequences + 2}>
          risk: {forecast.minConsequences === forecast.maxConsequences
            ? `${forecast.minConsequences} consequences`
            : `${forecast.minConsequences}–${forecast.maxConsequences} consequences (likely ${forecast.expectedConsequences})`}
        </div>
      {/if}
    </div>

    <div class="row">
      <button class="action" disabled={selected.length === 0 || !offerAlive} onclick={launch}>send them</button>
      <button class="ghost" onclick={onclose}>back</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: flex-end; z-index: 10; }
  .sheet { background: var(--panel); width: 100%; max-width: 480px; margin: 0 auto; border-radius: 14px 14px 0 0; padding: 1rem; max-height: 80dvh; overflow-y: auto; }
  .pick { display: flex; gap: 0.5rem; justify-content: space-between; width: 100%; text-align: left; background: var(--bg); border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 0.6rem; margin-bottom: 0.4rem; }
  .pick.on { border-color: var(--accent); }
  .match { color: var(--ok); font-size: 0.8rem; }
  .forecast { margin: 0.8rem 0; font-variant-numeric: tabular-nums; }
  .hot { color: var(--danger); }
  .row { display: flex; gap: 0.5rem; }
</style>
