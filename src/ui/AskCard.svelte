<script lang="ts">
  import { onMount } from 'svelte';
  import {
    FEEDBACK_URL,
    REVIEW_URLS,
    SITE_URL,
    STORE_NAMES,
    detectStore,
    dismiss,
    loadAsk,
    rate,
    route,
    saveAsk,
    shareLinks,
    shouldAsk,
    type AskState,
  } from '../lib/ask';
  import { formLink, pageContext } from '../lib/feedback';
  import Stars from './Stars.svelte';
  import { EMPTY_STATS, loadStats, shareText } from '../lib/stats';

  /** Shown on the reorder "done" screen when Google's order matches. */
  let ask = $state<AskState | null>(null);
  let asking = $state(false);
  let rating = $state(0);
  let copied = $state(false);

  const store = detectStore(import.meta.env.BROWSER, typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const reviewUrl = store ? REVIEW_URLS[store] : '';
  const feedbackUrl = formLink(FEEDBACK_URL, pageContext('reorder-done'));
  const locale = typeof navigator === 'undefined' ? undefined : navigator.language;
  let text = $state(shareText(EMPTY_STATS));
  const shares = $derived(shareLinks(SITE_URL, text));
  const path = $derived(rating ? route(rating) : null);

  onMount(async () => {
    text = shareText(await loadStats(), locale);
    ask = await loadAsk();
    asking = shouldAsk(ask, Date.now());
  });

  async function pick(n: number) {
    if (!ask) return;
    rating = n;
    ask = rate(ask, n);
    await saveAsk(ask);
  }

  async function notNow() {
    if (!ask) return;
    ask = dismiss(ask, Date.now());
    asking = false;
    await saveAsk(ask);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${text} ${SITE_URL}`);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Clipboard blocked: the share buttons still work.
    }
  }
</script>

{#snippet shareRow()}
  <div class="share" role="group" aria-label="Share Uzero">
    {#each shares as s (s.id)}
      <a class="btn btn-outlined small" href={s.href} target="_blank" rel="noreferrer">{s.label}</a>
    {/each}
    <button type="button" class="btn btn-outlined small" onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
  </div>
{/snippet}

{#if asking && !rating}
  <section class="ask" aria-labelledby="ask-title">
    <h2 id="ask-title">How did the reorder go?</h2>
    <div class="center"><Stars onpick={pick} /></div>
    <button type="button" class="btn btn-text small" onclick={notNow}>Not now</button>
  </section>
{:else if path === 'review'}
  <section class="ask" aria-live="polite">
    <h2>Glad it worked.</h2>
    {#if reviewUrl && store}
      <p>A short review on the {STORE_NAMES[store]} helps other people find Uzero.</p>
      <div class="row">
        <a class="btn btn-filled" href={reviewUrl} target="_blank" rel="noreferrer">Write a review</a>
      </div>
    {/if}
    <p>Know someone with too many Google accounts?</p>
    {@render shareRow()}
    {#if feedbackUrl}
      <a class="quiet" href={feedbackUrl} target="_blank" rel="noreferrer">Send feedback instead</a>
    {/if}
  </section>
{:else if path === 'feedback'}
  <section class="ask" aria-live="polite">
    <h2>Sorry about that.</h2>
    <p>Tell me what went wrong. Leave an email if you want a reply.</p>
    <div class="row">
      <a class="btn btn-filled" href={feedbackUrl || 'https://uzero.app/support/'} target="_blank" rel="noreferrer">Send feedback</a>
    </div>
  </section>
{:else if ask && ask.rating && ask.rating >= 4}
  <!-- Already rated happy on an earlier reorder: share only, no question. -->
  <section class="ask plain">
    <p>Know someone with too many Google accounts?</p>
    {@render shareRow()}
  </section>
{/if}

<style>
  .ask {
    margin: 0 0 24px;
    padding: 16px;
    border: 1px solid var(--outline-variant);
    border-radius: var(--r-md);
    text-align: center;
  }
  .ask.plain {
    border: 0;
    padding: 0;
  }
  h2 {
    margin: 0 0 8px;
    font-size: var(--t-lg);
    font-weight: 500;
    line-height: 24px;
    text-align: center;
  }
  p {
    margin: 0 0 12px;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 20px;
    text-wrap: pretty;
  }
  .center {
    display: flex;
    justify-content: center;
    margin: 0 0 4px;
  }
  .row {
    display: flex;
    justify-content: center;
    margin: 0 0 12px;
  }
  .share {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin: 0 0 12px;
  }
  .small {
    min-height: 32px;
    padding: 0 12px;
    font-size: var(--t-sm);
  }
  .quiet {
    font-size: var(--t-sm);
    color: var(--on-surface-variant);
  }
</style>
