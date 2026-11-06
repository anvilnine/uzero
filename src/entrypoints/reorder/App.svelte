<script lang="ts">
  import { onMount } from 'svelte';
  import { getApi, type Api } from '../../lib/api';
  import { inProgress } from '../../lib/wizard';
  import type { AppState, Request, WizardState } from '../../lib/types';
  import Avatar from '../../ui/Avatar.svelte';
  import Icon from '../../ui/Icon.svelte';
  import { lineup, toneOf, type Row } from '../../ui/model';
  import { closePanel, closeView, errorText } from '../../ui/nav';

  /** Narrow layout for the browser's side panel, next to Google's sign-in page. */
  let { panel = false }: { panel?: boolean } = $props();

  let api: Api | null = null;
  let app = $state<AppState | null>(null);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let pending = $state<Request['type'] | null>(null);
  /** The user cancelled a reorder that had already signed accounts out. */
  let cancelled = $state(false);
  /** Sign-out has taken a while: offer to go on without it. */
  let slowSignOut = $state(false);
  let heading = $state<HTMLElement | null>(null);
  let copied = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const w = $derived(app?.wizard ?? null);
  const rowsByEmail = $derived(new Map((app ? lineup(app) : []).map((r) => [r.email, r])));
  const queueRows = $derived<Row[]>(
    (w?.queue ?? []).map(
      (email, i) =>
        rowsByEmail.get(email) ?? {
          email,
          slot: i + 1,
          account: null,
          meta: {},
          name: email.split('@')[0] ?? email,
          inactive: true,
        },
    ),
  );
  const currentRow = $derived(w ? queueRows[w.current] : undefined);
  const live = $derived(w?.phase === 'signing-out' || w?.phase === 'signing-in');
  const signingOut = $derived(w?.phase === 'signing-out');

  // Google's order now: signed-in accounts by index.
  const googleNow = $derived(
    (app?.accounts ?? []).filter((a) => !a.signedOut && a.index >= 0).sort((a, b) => a.index - b.index),
  );
  // Accounts that were signed back in (not skipped), in your order. Only these can match Google's.
  const targets = $derived(w ? w.queue.filter((e) => w.completed.includes(e)) : []);
  const firstOff = $derived(targets.findIndex((e, i) => googleNow[i]?.email !== e));
  const matches = $derived(targets.length > 0 && firstOff < 0);

  onMount(() => {
    if (panel) document.body.classList.add('panel');
    let unsub = () => {};
    (async () => {
      try {
        api = await getApi();
        unsub = api.subscribe((s) => (app = s));
        app = await api.send({ type: 'getState' });
      } catch (e) {
        loadError = errorText(e);
      }
    })();
    return () => unsub();
  });

  // While Google is changing under us, nudge the background to look again.
  $effect(() => {
    if (!live) return;
    const t = setInterval(() => {
      api?.send({ type: 'refresh' }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  });

  // Chrome sync can keep its own account signed in, so sign-out never finishes. After a while, offer a way on.
  $effect(() => {
    slowSignOut = false;
    if (!signingOut) return;
    const t = setTimeout(() => (slowSignOut = true), 15_000);
    return () => clearTimeout(t);
  });

  // Move focus to the new step's heading so screen readers hear it.
  let lastKey = '';
  $effect(() => {
    const key = `${w?.phase}:${w?.current}:${cancelled}`;
    if (key !== lastKey && heading) {
      if (lastKey) heading.focus();
      lastKey = key;
    }
  });

  async function act<
    T extends 'wizardBegin' | 'wizardSkip' | 'wizardRetry' | 'wizardContinue' | 'wizardReopen' | 'wizardCancel',
  >(type: T) {
    if (!api || !app) return;
    const began = inProgress(app.wizard);
    pending = type;
    actionError = null;
    try {
      const next = (await api.send({ type } as Extract<Request, { type: T }>)) as WizardState | null;
      app = { ...app, wizard: next };
      if (type === 'wizardCancel') cancelled = began;
    } catch (e) {
      actionError = errorText(e);
    } finally {
      pending = null;
    }
  }

  const close = () => (panel ? closePanel() : closeView());

  // Nothing was signed out yet: drop the reorder and put the panel away (a tab shows neutral copy).
  function notNow() {
    void act('wizardCancel');
    if (panel) close();
  }

  async function goToGoogleTab() {
    if (!api) return;
    pending = 'wizardFocusTab';
    actionError = null;
    try {
      await api.send({ type: 'wizardFocusTab' });
    } catch (e) {
      actionError = errorText(e);
    } finally {
      pending = null;
    }
  }

  // Older saved states have no kind; they could only come from a wrong account.
  const errorKind = $derived(w?.errorKind ?? 'wrong-account');
  const errorCopy = $derived.by(() => {
    const email = currentRow?.email ?? '';
    const n = (w?.current ?? 0) + 1;
    switch (errorKind) {
      case 'tab-closed':
        return {
          heading: 'The Google tab was closed',
          detail: `Account ${n} still needs to sign in.`,
          lede: 'Reopen the sign-in page, or skip this account for now.',
          retry: 'Reopen sign-in',
          tone: 'info',
        };
      case 'expired':
        return {
          heading: 'Reorder paused',
          detail: app?.prefs.pinEnabled
            ? 'Nothing happened for 30 minutes, so Pin is back on.'
            : 'Nothing happened for 30 minutes, so Uzero paused the reorder.',
          lede: 'Continue with this account, or skip it for now.',
          retry: 'Continue',
          tone: 'info',
        };
      case 'out-of-order':
        return {
          heading: 'That account is out of order',
          detail: `${w?.error ?? ''} Account ${n} should be ${email}.`,
          lede: 'Try again to sign out and start over, or skip this account.',
          retry: 'Try again',
          tone: 'warn',
        };
      default:
        return {
          heading: 'That’s a different account',
          detail: `${w?.error ?? 'Google shows a different account.'} Account ${n} should be ${email}.`,
          lede: 'A password manager can fill in a different email. Try again signs out and starts over, so check the email on Google’s page before you type a password.',
          retry: 'Try again',
          tone: 'warn',
        };
    }
  });

  async function startFresh() {
    if (!api || !app) return;
    const queue = lineup(app)
      .filter((r) => !r.inactive)
      .map((r) => r.email);
    pending = 'wizardOpen';
    try {
      const next = await api.send(panel ? { type: 'wizardOpen', queue, panel } : { type: 'wizardOpen', queue });
      app = { ...app, wizard: next };
      cancelled = false;
    } catch (e) {
      actionError = errorText(e);
    } finally {
      pending = null;
    }
  }

  // Password managers often fill a different email on Google's page; pasting the right one is quickest.
  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      copied = email;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = null), 2000);
    } catch {
      actionError = 'Couldn’t copy. Select the email and copy it by hand.';
    }
  }

  /** One row per step, for the step list: sign out, then each account. */
  const steps = $derived.by(() => {
    if (!w || w.phase === 'confirm' || w.phase === 'done') return [];
    const out: { key: string; label: string; state: 'done' | 'now' | 'todo' | 'skipped' }[] = [
      { key: 'out', label: 'Sign out of all accounts', state: w.phase === 'signing-out' ? 'now' : 'done' },
    ];
    queueRows.forEach((r, i) => {
      let state: 'done' | 'now' | 'todo' | 'skipped' = 'todo';
      if (w.phase !== 'signing-out') {
        if (i === w.current) state = 'now';
        else if (i < w.current) state = w.completed.includes(r.email) ? 'done' : 'skipped';
      }
      out.push({ key: r.email, label: r.email, state });
    });
    return out;
  });

  async function turnOnPin() {
    if (!api || !app) return;
    app = { ...app, prefs: { ...app.prefs, pinEnabled: true } };
    await api.send({ type: 'savePrefs', patch: { pinEnabled: true } }).catch(() => {});
  }

  // One step to sign out, one per account, then done.
  const progress = $derived.by(() => {
    if (!w) return 0;
    const total = w.queue.length + 1;
    if (w.phase === 'confirm') return 0;
    if (w.phase === 'signing-out') return 0.5 / total;
    if (w.phase === 'done') return 1;
    return (1 + w.current) / total;
  });

  // Announced without moving focus (step changes move focus to the heading instead).
  const liveStatus = $derived.by(() => {
    if (copied) return `Copied ${copied}.`;
    if (signingOut && slowSignOut) return 'Still waiting for Google. You can continue anyway.';
    return '';
  });

  const prep = [
    'Every Google account signs out, in every tab. Save any open work in Google first.',
    'Have each password and 2-Step Verification code ready.',
    'Password managers (like LastPass) can fill in a different email. Check the email on Google’s page before you type a password.',
    'If Chrome itself is signed in with sync, Chrome may put that account back first. Pin still works.',
  ];
</script>

{#snippet chip(r: Row)}
  <div class="chip">
    <Avatar name={r.name} email={r.email} photo={r.account?.photo} tone={toneOf(r)} size={20} />
    <span>{r.email}</span>
  </div>
{/snippet}

<div class="page" class:panel>
  <main class="card">
    {#if w && w.phase !== 'confirm'}
      <div
        class="progress"
        role="progressbar"
        aria-label="Reorder progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span style:width="{progress * 100}%"></span>
      </div>
    {/if}

    <img class="logo" src="/icon/32.png" alt="" width="32" height="32" />

    {#if loadError}
      <h1>Couldn’t load the reorder</h1>
      <p class="lede">{loadError}</p>
      <div class="actions">
        <span></span>
        <button type="button" class="btn btn-filled" onclick={() => location.reload()}>Try again</button>
      </div>
    {:else if !app}
      <p class="lede" aria-busy="true">Loading…</p>
    {:else if !w}
      <h1 tabindex="-1" bind:this={heading}>
        {cancelled ? 'Reorder cancelled' : 'No reorder running'}
      </h1>
      <p class="lede">
        {cancelled
          ? 'Accounts you already signed back in to stay signed in. Sign in to the rest at accounts.google.com.'
          : 'Put Google’s account order in your order by signing out and back in.'}
      </p>
      <div class="actions">
        <button type="button" class="btn btn-text" onclick={close}>Close</button>
        <button type="button" class="btn btn-filled" onclick={startFresh} disabled={!!pending}>
          Start with my order
        </button>
      </div>
    {:else if w.phase === 'confirm'}
      <h1 tabindex="-1" bind:this={heading}>Reorder your Google accounts</h1>
      <p class="lede">
        Google numbers accounts in the order you sign in. You’ll sign out of all {w.queue.length}, then
        sign back in one at a time, in this order.
      </p>
      <ol class="order">
        {#each queueRows as r, i (r.email)}
          <li>
            <span class="n">{i + 1}</span>
            <Avatar name={r.name} email={r.email} photo={r.account?.photo} tone={toneOf(r)} size={24} />
            <span class="who">
              <span class="who-name">{r.meta.label ?? r.name}</span>
              <span class="who-email">{r.email}</span>
            </span>
          </li>
        {/each}
      </ol>
      <h2>Before you start</h2>
      <ul class="prep">
        {#each prep as p (p)}
          <li>{p}</li>
        {/each}
      </ul>
      <div class="actions">
        <button type="button" class="btn btn-text" onclick={notNow} disabled={!!pending}>Not now</button>
        <button type="button" class="btn btn-filled" onclick={() => act('wizardBegin')} disabled={!!pending}>
          Sign out and start
        </button>
      </div>
    {:else if w.phase === 'signing-out'}
      <h1 tabindex="-1" bind:this={heading}>Signing out</h1>
      <p class="lede">
        A Google tab is signing you out of every account. This page continues when Google is done.
      </p>
      <div class="status">
        <span class="spinner" aria-hidden="true"></span>
        <span>Waiting for Google</span>
      </div>
      {#if slowSignOut}
        <p class="tip">
          <Icon name="alert" size={18} />
          <span>Still signed in? Chrome sync can keep its own account. Continue, and it stays where Google puts it.</span>
        </p>
      {/if}
      <div class="actions">
        {#if slowSignOut}
          <button type="button" class="btn btn-text" onclick={() => act('wizardContinue')} disabled={!!pending}>
            Continue anyway
          </button>
        {:else}
          <span></span>
        {/if}
        <button type="button" class="btn btn-filled" onclick={goToGoogleTab} disabled={!!pending}>
          Go to the Google tab
        </button>
      </div>
    {:else if (w.phase === 'signing-in' || w.phase === 'error') && currentRow}
      <p class="step">Account {w.current + 1} of {w.queue.length}</p>
      {#if w.phase === 'error'}
        <h1 tabindex="-1" bind:this={heading}>{errorCopy.heading}</h1>
        {@render chip(currentRow)}
        <p class="detail" role="alert">{errorCopy.detail}</p>
        <p class="lede left">{errorCopy.lede}</p>
        <div class="actions">
          <button type="button" class="btn btn-text" onclick={() => act('wizardSkip')} disabled={!!pending}>
            Skip this account
          </button>
          <button type="button" class="btn btn-filled" onclick={() => act('wizardRetry')} disabled={!!pending}>
            {errorCopy.retry}
          </button>
        </div>
      {:else}
        <h1 tabindex="-1" bind:this={heading}>Sign in as</h1>
        <div class="target">
          <Avatar
            name={currentRow.name}
            email={currentRow.email}
            photo={currentRow.account?.photo}
            tone={toneOf(currentRow)}
            size={32}
          />
          <span class="who">
            <span class="target-email">{currentRow.email}</span>
            {#if currentRow.meta.label}
              <span class="who-email">{currentRow.meta.label}</span>
            {/if}
          </span>
          <button
            type="button"
            class="btn btn-text copy"
            onclick={() => copyEmail(currentRow.email)}
            aria-label="Copy {currentRow.email}"
          >
            <Icon name={copied === currentRow.email ? 'check' : 'copy'} size={18} />
            {copied === currentRow.email ? 'Copied' : 'Copy'}
          </button>
        </div>
        <ol class="howto">
          <li>In the Google tab, check that the email is <strong>{currentRow.email}</strong>.</li>
          <li>Type its password. Do 2-Step Verification if Google asks.</li>
          <li>Uzero goes to the next account by itself.</li>
        </ol>
        <p class="tip">
          <Icon name="key" size={18} />
          <span>Did a password manager fill in a different email? Clear the email field, then paste this one.</span>
        </p>
        <div class="status">
          <span class="spinner" aria-hidden="true"></span>
          <span class="status-text">Waiting for you to sign in</span>
          <button type="button" class="btn btn-text" onclick={() => act('wizardReopen')} disabled={!!pending}>
            Reopen sign-in
          </button>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-text" onclick={() => act('wizardSkip')} disabled={!!pending}>
            Skip this account
          </button>
          <button type="button" class="btn btn-filled" onclick={goToGoogleTab} disabled={!!pending}>
            Go to the Google tab
          </button>
        </div>
      {/if}
    {:else if w.phase === 'done'}
      <h1 tabindex="-1" bind:this={heading}>
        {targets.length === 0 ? 'No accounts signed back in' : matches ? 'Google now uses your order' : 'Almost in order'}
      </h1>
      <p class="lede">
        {#if targets.length === 0}
          You skipped every account. Sign in to them again at accounts.google.com.
        {:else if matches}
          Your first account is now Google’s default.
        {:else}
          {firstOff === 0
            ? `Google put ${googleNow[0]?.email ?? 'another account'} first. Chrome sync can do this.`
            : 'Some accounts aren’t where you put them.'}
          {app.prefs.pinEnabled
            ? 'Pin is on, so links still open as your default.'
            : 'Turn on Pin so links open as your default anyway.'}
        {/if}
      </p>

      <ol class="order" aria-label="Your order compared with Google’s order now">
        {#each w.queue as email, i (email)}
          {@const j = targets.indexOf(email)}
          {@const g = j < 0 ? undefined : googleNow[j]}
          {@const ok = g?.email === email}
          <li>
            <span class="n">{i + 1}</span>
            <span class="who">
              <span class="who-name">{email}</span>
              {#if j < 0}
                <span class="who-email">Skipped</span>
              {:else if !ok}
                <span class="who-email">Google now: {g ? g.email : 'not signed in'}</span>
              {/if}
            </span>
            {#if j < 0}
              <span class="mark"></span>
            {:else if ok}
              <span class="mark ok"><Icon name="check" size={18} /><span class="sr-only">Matches</span></span>
            {:else}
              <span class="mark no"><Icon name="alert" size={18} /><span class="sr-only">Different</span></span>
            {/if}
          </li>
        {/each}
      </ol>

      <div class="actions">
        {#if targets.length > 0 && !matches && !app.prefs.pinEnabled}
          <button type="button" class="btn btn-text" onclick={close}>Close</button>
          <button type="button" class="btn btn-filled" onclick={turnOnPin}>Turn on Pin</button>
        {:else}
          <span></span>
          <button type="button" class="btn btn-filled" onclick={close}>Close</button>
        {/if}
      </div>
    {/if}

    {#if steps.length > 0}
      <ol class="steps" aria-label="Steps">
        {#each steps as st (st.key)}
          <li class={st.state} aria-current={st.state === 'now' ? 'step' : undefined}>
            <span class="dot" aria-hidden="true">
              {#if st.state === 'done'}<Icon name="check" size={14} />{/if}
            </span>
            <span class="step-label">{st.label}</span>
            {#if st.state === 'skipped'}<span class="who-email">Skipped</span>{/if}
          </li>
        {/each}
      </ol>
    {/if}

    {#if actionError}
      <p class="action-error" role="alert">{actionError}</p>
    {/if}
  </main>
  <p class="sr-only" aria-live="polite">{liveStatus}</p>

  {#if w && w.phase !== 'done' && w.phase !== 'confirm'}
    <div class="below">
      <button type="button" class="btn btn-text" onclick={() => act('wizardCancel')} disabled={!!pending}>
        Cancel reorder
      </button>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    background: var(--surface-container);
  }
  .page {
    min-height: 100vh;
    padding: 64px 16px;
  }
  .card {
    position: relative;
    max-width: 450px;
    margin: 0 auto;
    padding: 40px 40px 32px;
    border-radius: var(--r-xl);
    background: var(--surface);
    overflow: hidden;
    text-align: center;
  }

  .progress {
    position: absolute;
    inset: 0 0 auto;
    height: 4px;
    background: var(--surface-container-highest);
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--primary);
    transition: width 200ms var(--ease);
  }

  .logo {
    display: block;
    margin: 0 auto 16px;
    border-radius: 6px;
  }
  .step {
    margin: 0 0 8px;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
  }
  h1 {
    margin: 0 0 8px;
    font-size: var(--t-xl);
    font-weight: 400;
    line-height: 32px;
    text-wrap: balance;
  }
  h1:focus {
    outline: none;
  }
  .lede {
    margin: 0 0 24px;
    font-size: var(--t-lg);
    line-height: 24px;
    text-wrap: pretty;
  }
  .lede.left,
  .detail,
  .order,
  .prep,
  h2,
  .status,
  .action-error {
    text-align: left;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    margin: 0 0 24px;
    padding: 4px 12px 4px 4px;
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
    font-weight: 500;
  }
  .chip span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  h1 + .chip {
    margin-top: 8px;
  }
  .detail {
    margin: 0 0 8px;
    font-size: var(--t-lg);
    line-height: 24px;
  }

  .order {
    list-style: none;
    margin: 0 0 24px;
    padding: 0;
    border: 1px solid var(--outline-variant);
    border-radius: var(--r-md);
  }
  .order li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    padding: 8px 16px;
  }
  .order li + li {
    border-top: 1px solid var(--outline-variant);
  }
  .n {
    flex: none;
    width: 12px;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .who {
    flex: 1;
    display: grid;
    min-width: 0;
  }
  .who-name,
  .who-email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who-email {
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
  }
  .mark {
    flex: none;
    display: inline-flex;
  }
  .mark.ok {
    color: var(--primary);
  }
  .mark.no {
    color: var(--on-surface-variant);
  }

  h2 {
    margin: 0 0 8px;
    font-size: var(--t-md);
    font-weight: 500;
  }
  .prep {
    margin: 0 0 24px;
    padding-left: 20px;
    color: var(--on-surface-variant);
  }
  .prep li + li {
    margin-top: 8px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    margin: 0 0 24px;
    color: var(--on-surface-variant);
  }
  .status-text {
    flex: 1;
  }
  .status .btn {
    margin-right: -12px;
  }
  .spinner {
    flex: none;
    width: 16px;
    height: 16px;
    border: 2px solid var(--surface-container-highest);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 8px;
  }
  .actions .btn-text {
    margin-left: -12px;
  }
  .action-error {
    margin: 16px 0 0;
    color: var(--error);
    font-size: var(--t-sm);
  }

  .below {
    max-width: 450px;
    margin: 8px auto 0;
    display: flex;
    justify-content: flex-end;
    padding: 0 16px;
  }

  /* Sign-in target: the one email that matters right now. */
  .target {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 8px 0 16px;
    padding: 12px 8px 12px 12px;
    border: 1px solid var(--outline-variant);
    border-radius: var(--r-md);
    text-align: left;
  }
  .target-email {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-lg);
    font-weight: 500;
    line-height: 24px;
  }
  .copy {
    flex: none;
    gap: 6px;
  }
  .howto {
    margin: 0 0 16px;
    padding-left: 20px;
    text-align: left;
  }
  .howto li + li {
    margin-top: 6px;
  }
  .howto strong {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .tip {
    display: flex;
    gap: 8px;
    margin: 0 0 16px;
    padding: 12px;
    border-radius: var(--r-md);
    background: var(--surface-container);
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 20px;
    text-align: left;
  }
  .tip :global(svg) {
    flex: none;
    margin-top: 1px;
  }

  /* Step list: where you are in the whole reorder. */
  .steps {
    list-style: none;
    margin: 24px 0 0;
    padding: 16px 0 0;
    border-top: 1px solid var(--outline-variant);
    text-align: left;
  }
  .steps li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 32px;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
  }
  .steps li.now {
    color: var(--on-surface);
    font-weight: 500;
  }
  .step-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 2px solid var(--outline-variant);
    border-radius: 50%;
  }
  .done .dot {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--on-primary);
  }
  .now .dot {
    border-color: var(--primary);
    box-shadow: inset 0 0 0 4px var(--surface), inset 0 0 0 10px var(--primary);
  }

  @media (max-width: 520px) {
    :global(body) {
      background: var(--surface);
    }
    .page {
      padding: 0;
    }
    .card {
      max-width: none;
      border-radius: 0;
      padding: 32px 24px;
    }
  }

  /* Side panel: narrow column next to Google's page. Left-aligned, no outer card. */
  :global(body.panel) {
    background: var(--surface);
  }
  .page.panel {
    min-height: 0;
    padding: 0;
  }
  .panel .card {
    max-width: none;
    padding: 24px 16px 16px;
    border-radius: 0;
    text-align: left;
  }
  .panel .logo {
    margin: 0 0 12px;
  }
  .panel h1 {
    font-size: var(--t-lg);
    line-height: 28px;
  }
  .panel .lede {
    margin-bottom: 16px;
    font-size: var(--t-md);
    line-height: 20px;
  }
  .panel .actions {
    flex-direction: column-reverse;
    align-items: stretch;
  }
  .panel .actions > span:empty {
    display: none;
  }
  .panel .actions .btn-text {
    margin-left: 0;
  }
  .panel .below {
    max-width: none;
    justify-content: flex-start;
    padding: 0 4px 16px;
  }
</style>
