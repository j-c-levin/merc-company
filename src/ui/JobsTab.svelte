<script lang="ts">
  import { game, act } from './store.svelte'
  import { seatOffer, rejectOffer, hire, buySeat, idleMercIds } from '../sim/actions'
  import { project } from '../sim/projection'
  import { SEAT_PRICE, MAX_SEATS } from '../sim/balance'
  import type { Offer } from '../sim/types'
  import DispatchSheet from './DispatchSheet.svelte'

  let dispatching: Offer | null = $state(null)

  function ttl(offer: Offer): number {
    return Math.max(0, offer.expiresAt - game.state.tick)
  }

  function ttlPct(offer: Offer): number {
    const total = offer.expiresAt - offer.postedAt
    if (total <= 0) return 0
    const pct = ((offer.expiresAt - game.state.tick) / total) * 100
    return Math.max(0, Math.min(100, pct))
  }

  function estimatedDuration(offer: Offer): string {
    const idle = idleMercIds(game.state)
    if (idle.length === 0) return '—'
    const proj = project(game.state, idle, offer.job!.rating, offer.job!.environment)
    if (!Number.isFinite(proj.durationTicks)) return '—'
    return `~${proj.durationTicks}s with your idle crew`
  }
</script>

<section>
  <h3 class="dim">waiting room ({game.state.seated.length}/{game.state.waitingSeats})</h3>
  {#each game.state.seated as offer (offer.id)}
    {@render offerCard(offer, true)}
  {/each}
  {#if game.state.seated.length === 0}
    <p class="dim">empty seats</p>
  {/if}
  {#if game.state.waitingSeats < MAX_SEATS}
    <button class="ghost" disabled={game.state.cash < SEAT_PRICE} onclick={() => act(() => buySeat(game.state))}>
      add a seat — {SEAT_PRICE}cr
    </button>
  {/if}
</section>

<section>
  <h3 class="dim">at the door</h3>
  {#each game.state.offers as offer (offer.id)}
    {@render offerCard(offer, false)}
  {/each}
  {#if game.state.offers.length === 0}
    <p class="dim">nobody at the door — they'll come</p>
  {/if}
</section>

{#if dispatching}
  <DispatchSheet offer={dispatching} onclose={() => (dispatching = null)} />
{/if}

{#snippet offerCard(offer: Offer, seated: boolean)}
  <div class="card">
    {#if offer.kind === 'job'}
      <div class="row">
        <strong>{'★'.repeat(offer.job!.rating)} job · {offer.job!.environment}</strong>
        <span class="payout">{offer.job!.payout}cr</span>
      </div>
      <div class="dim">{estimatedDuration(offer)}</div>
    {:else}
      <div class="row">
        <strong>{offer.candidate!.name}</strong>
        <span class="dim">{offer.candidate!.klass} · {'★'.repeat(offer.candidate!.rank)} · {offer.candidate!.affinity}</span>
      </div>
      <div class="row dim"><span>hire for {offer.candidate!.hirePrice}cr</span></div>
    {/if}
    {#if !seated}
      <div class="bar"><div style="width:{ttlPct(offer)}%; background:var(--danger)"></div></div>
      <div class="dim">{ttl(offer)}s before they walk</div>
    {/if}
    <div class="row">
      {#if offer.kind === 'job'}
        <button class="action" onclick={() => (dispatching = offer)}>accept</button>
      {:else}
        <button
          class="action"
          disabled={game.state.mercs.length >= game.state.rosterSlots || game.state.cash < offer.candidate!.hirePrice}
          onclick={() => act(() => hire(game.state, offer.id))}
        >hire</button>
      {/if}
      {#if !seated}
        <button class="ghost" disabled={game.state.seated.length >= game.state.waitingSeats} onclick={() => act(() => seatOffer(game.state, offer.id))}>
          take a seat
        </button>
      {/if}
      <button class="ghost" onclick={() => act(() => rejectOffer(game.state, offer.id))}>reject</button>
    </div>
  </div>
{/snippet}

<style>
  .row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .payout { color: var(--accent); font-weight: 700; }
  section { margin-bottom: 1.2rem; }
  h3 { margin: 0 0 0.5rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
</style>
