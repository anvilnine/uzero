<script lang="ts">
  import { onMount } from 'svelte';
  import { getApi, type Api } from '../../lib/api';
  import type { AppState, Request, WizardState } from '../../lib/types';
  import Avatar from '../../ui/Avatar.svelte';
  import Icon, { type IconName } from '../../ui/Icon.svelte';
  import Mark from '../../ui/Mark.svelte';
  import { lineup, toneOf, type Row } from '../../ui/model';
  import { closeView, errorText } from '../../ui/nav';

  let api: Api | null = null;
  let app = $state<AppState | null>(null);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let pending = $state<Request['type'] | null>(null);
  let cancelled = $state(false);
  let heading = $state<HTMLElement | null>(null);

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

  // Google's order now: signed-in accounts by index.
  const googleNow = $derived(
    (app?.accounts ?? []).filter((a) => !a.signedOut && a.index >= 0).sort((a, b) => a.index - b.index),
  );
  const matches = $derived(
    w ? w.queue.filter((e) => w.completed.includes(e)).every((e, i) => googleNow[i]?.email === e) : false,
  );

  onMount(() => {
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
    T extends 'wizardBegin' | 'wizardSkip' | 'wizardRetry' | 'wizardReopen' | 'wizardCancel',
  >(type: T) {
    if (!api || !app) return;
    pending = type;
    actionError = null;
    try {
      const next = (await api.send({ type } as Extract<Request, { type: T }>)) as WizardState | null;
      app = { ...app, wizard: next };
      if (type === 'wizardCancel') cancelled = true;
    } catch (e) {
      actionError = errorText(e);
    } finally {
      pending = null;
    }
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
          detail: `Number ${n} still needs to sign in as ${email}.`,
          lede: `Reopen it to sign in as ${email}, or skip it for now.`,
          retry: 'Reopen sign-in',
          tone: 'info',
        };
      case 'expired':
        return {
          heading: 'Reorder paused',
          detail: 'Nothing happened for 30 minutes, so Pin is back on.',
          lede: `Pick up where you left off with ${email}, or skip it for now.`,
          retry: 'Keep going',
          tone: 'info',
        };
      case 'out-of-order':
        return {
          heading: 'That account is out of order',
          detail: `${w?.error ?? ''} Number ${n} should be ${email}.`,
          lede: 'Try again to sign out and start over, or skip it for now.',
          retry: 'Try again',
          tone: 'warn',
        };
      default:
        return {
          heading: 'That’s a different account',
          detail: `${w?.error ?? 'Google shows a different account than expected.'} Number ${n} should be ${email}.`,
          lede: `Try again to sign in as ${email}, or skip it for now.`,
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
      const next = await api.send({ type: 'wizardOpen', queue });
      app = { ...app, wizard: next };
      cancelled = false;
    } catch (e) {
      actionError = errorText(e);
    } finally {
      pending = null;
    }
  }

  async function turnOnPin() {
    if (!api || !app) return;
    app = { ...app, prefs: { ...app.prefs, pinEnabled: true } };
    await api.send({ type: 'savePrefs', patch: { pinEnabled: true } }).catch(() => {});
  }

  type StepState = 'done' | 'current' | 'next' | 'skipped' | 'problem';

  function stepOf(i: number, wz: WizardState): StepState {
    const email = wz.queue[i]!;
    if (wz.phase === 'done' || i < wz.current) return wz.completed.includes(email) ? 'done' : 'skipped';
    if (i === wz.current && wz.phase === 'signing-in') return 'current';
    if (i === wz.current && wz.phase === 'error') return 'problem';
    return 'next';
  }

  const signOutStep = $derived<StepState>(
    !w || w.phase === 'confirm' ? 'next' : w.phase === 'signing-out' ? 'current' : 'done',
  );


  const prep: { icon: IconName; text: string }[] = [
    { icon: 'signout', text: 'Every Google account signs out, in every tab. Save any work open in Google first.' },
    { icon: 'key', text: 'Have each password and 2-Step Verification code ready.' },
    {
      icon: 'sync',
      text: 'If Chrome itself is signed in with sync, Chrome may put that account back at #1. Pin still covers it.',
    },
  ];
</script>

<div class="page">
  <header class="masthead">
    <div class="brand">
      <Mark size={26} />
      <span>Lineup</span>
    </div>
    {#if w && w.phase !== 'done' && w.phase !== 'confirm'}
      <button type="button" class="btn btn-quiet" onclick={() => act('wizardCancel')} disabled={!!pending}>
        Cancel
      </button>
    {/if}
  </header>

  {#if loadError}
    <main class="solo">
      <h1>Couldn’t load the reorder</h1>
      <p class="lede">{loadError}</p>
      <button type="button" class="btn btn-primary" onclick={() => location.reload()}>Try again</button>
    </main>
  {:else if !app}
    <main class="solo" aria-busy="true"><p class="lede">Loading…</p></main>
  {:else if !w}
    <main class="solo">
      <h1 tabindex="-1" bind:this={heading}>
        {cancelled ? 'Reorder cancelled' : 'No reorder running'}
      </h1>
      <p class="lede">
        {cancelled
          ? 'Any account you signed back in to stays signed in. Sign in to the rest at accounts.google.com.'
          : 'Put Google’s account order in your order by signing out and back in.'}
      </p>
      <div class="actions">
        <button type="button" class="btn btn-primary" onclick={startFresh} disabled={!!pending}>
          Start with my order
        </button>
        <button type="button" class="btn btn-quiet" onclick={closeView}>Close</button>
      </div>
    </main>
  {:else}
    <div class="layout">
      <nav class="rail" aria-label="Steps">
        <ol>
          <li class="step {w.phase === 'confirm' ? 'current' : 'done'}" aria-current={w.phase === 'confirm' ? 'step' : undefined}>
            <span class="marker">{#if w.phase !== 'confirm'}<Icon name="check" size={14} />{/if}</span>
            <span class="step-text">Before you start</span>
          </li>
          <li class="step {signOutStep}" aria-current={signOutStep === 'current' ? 'step' : undefined}>
            <span class="marker">{#if signOutStep === 'done'}<Icon name="check" size={14} />{/if}</span>
            <span class="step-text">Sign out of everything</span>
          </li>
          {#each queueRows as r, i (r.email)}
            {@const s = stepOf(i, w)}
            <li class="step acct {s}" aria-current={s === 'current' || s === 'problem' ? 'step' : undefined}>
              <span class="marker figure">
                {#if s === 'done'}<Icon name="check" size={14} />{:else}{i + 1}{/if}
              </span>
              <span class="step-text">
                <span class="step-name">{r.meta.label ?? r.name}</span>
                <span class="step-sub">{r.email}</span>
              </span>
              {#if s === 'skipped'}<span class="step-flag">Skipped</span>{/if}
              <span class="sr-only">
                {s === 'done' ? 'Signed in' : s === 'skipped' ? 'Skipped' : s === 'current' ? 'Now' : ''}
              </span>
            </li>
          {/each}
          <li class="step {w.phase === 'done' ? 'current' : 'next'}" aria-current={w.phase === 'done' ? 'step' : undefined}>
            <span class="marker"></span>
            <span class="step-text">Done</span>
          </li>
        </ol>
      </nav>

      <main class="panel" aria-live="polite">
        {#if w.phase === 'confirm'}
          <h1 tabindex="-1" bind:this={heading}>Put Google in your order</h1>
          <p class="lede">
            Google numbers your accounts in the order you sign in. To change that, you’ll sign out of
            all {w.queue.length} and sign back in, one at a time, in this order.
          </p>
          <ul class="prep">
            {#each prep as p (p.icon)}
              <li><span class="prep-icon"><Icon name={p.icon} /></span><span>{p.text}</span></li>
            {/each}
          </ul>
          <div class="actions">
            <button type="button" class="btn btn-primary big" onclick={() => act('wizardBegin')} disabled={!!pending}>
              <Icon name="signout" size={18} /> Sign out and start
            </button>
            <button type="button" class="btn btn-quiet" onclick={() => act('wizardCancel')} disabled={!!pending}>
              Not now
            </button>
          </div>
        {:else if w.phase === 'signing-out'}
          <h1 tabindex="-1" bind:this={heading}>Signing you out</h1>
          <p class="lede">
            A Google tab is signing out of every account. This page moves on as soon as Google
            confirms.
          </p>
          <p class="wait"><span class="pulse"></span>Waiting for Google</p>
          <div class="actions">
            <button type="button" class="btn" onclick={goToGoogleTab} disabled={!!pending}>
              <Icon name="tab" size={18} /> Go to the Google tab
            </button>
          </div>
        {:else if (w.phase === 'signing-in' || w.phase === 'error') && currentRow}
          <div class="who">
            <div class="who-av">
              <Avatar
                name={currentRow.name}
                email={currentRow.email}
                photo={currentRow.account?.photo}
                tone={toneOf(currentRow)}
                size={72}
              />
              <span class="bib figure" class:lead={w.current === 0}>{w.current + 1}</span>
            </div>
            <span class="count">Account {w.current + 1} of {w.queue.length}</span>
          </div>
          {#if w.phase === 'error'}
            <h1 tabindex="-1" bind:this={heading}>{errorCopy.heading}</h1>
            <div class="callout {errorCopy.tone}" role="alert">
              <Icon name={errorCopy.tone === 'warn' ? 'alert' : 'tab'} />
              <p>{errorCopy.detail}</p>
            </div>
            <p class="lede">{errorCopy.lede}</p>
            <div class="actions">
              <button type="button" class="btn btn-primary big" onclick={() => act('wizardRetry')} disabled={!!pending}>
                {errorCopy.retry}
              </button>
              <button type="button" class="btn big" onclick={() => act('wizardSkip')} disabled={!!pending}>
                <Icon name="skip" size={18} /> Skip this account
              </button>
            </div>
          {:else}
            <h1 tabindex="-1" bind:this={heading} class="email-h">
              Sign in as <span class="addr">{currentRow.email}</span>
            </h1>
            <p class="lede">
              In the Google tab, choose this account or type its email, then its password.
              {#if w.current > 0}It joins as number {w.current + 1}.{/if}
            </p>
            <p class="wait"><span class="pulse"></span>Waiting for you to sign in</p>
            <div class="actions">
              <button type="button" class="btn btn-primary" onclick={goToGoogleTab} disabled={!!pending}>
                <Icon name="tab" size={18} /> Go to the Google tab
              </button>
              <button type="button" class="btn" onclick={() => act('wizardReopen')} disabled={!!pending}>
                <Icon name="refresh" size={18} /> Reopen sign-in
              </button>
              <button type="button" class="btn btn-quiet" onclick={() => act('wizardSkip')} disabled={!!pending}>
                <Icon name="skip" size={18} /> Skip this account
              </button>
            </div>
          {/if}
        {:else if w.phase === 'done'}
          <h1 tabindex="-1" bind:this={heading}>
            {matches ? 'Google now follows your order' : 'Almost in order'}
          </h1>
          <p class="lede">
            {#if matches}
              Your #1 is now Google’s default everywhere.
            {:else}
              Google put {googleNow[0]?.email ?? 'another account'} first. Chrome sync can do this.
              {app.prefs.pinEnabled ? 'Pin is on, so links still open as your #1.' : 'Turn on Pin so links open as your #1 anyway.'}
            {/if}
          </p>

          <table class="compare">
            <caption class="sr-only">Your order compared with Google’s order now</caption>
            <thead>
              <tr>
                <th scope="col"><span class="sr-only">Number</span></th>
                <th scope="col">Your order</th>
                <th scope="col">Google now</th>
                <th scope="col"><span class="sr-only">Match</span></th>
              </tr>
            </thead>
            <tbody>
              {#each w.queue as email, i (email)}
                {@const g = googleNow[i]}
                {@const ok = g?.email === email}
                <tr class:mismatch={!ok}>
                  <td class="figure n" class:lead={i === 0}><span>{i + 1}</span></td>
                  <td>{email}</td>
                  <td class:muted={!g}>{g ? g.email : 'Not signed in'}</td>
                  <td class="mark">
                    {#if ok}<span class="ok"><Icon name="check" size={16} /><span class="sr-only">Matches</span></span>
                    {:else}<span class="no"><Icon name="alert" size={16} /><span class="sr-only">Different</span></span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>

          <div class="actions">
            {#if !matches && !app.prefs.pinEnabled}
              <button type="button" class="btn btn-primary big" onclick={turnOnPin}>Turn on Pin</button>
              <button type="button" class="btn btn-quiet" onclick={closeView}>Close</button>
            {:else}
              <button type="button" class="btn btn-primary big" onclick={closeView}>
                <Icon name="check" size={18} /> Close
              </button>
            {/if}
          </div>
        {/if}

        {#if actionError}
          <p class="action-error" role="alert"><Icon name="alert" size={18} /> {actionError}</p>
        {/if}
      </main>
    </div>
  {/if}
</div>

<style>
  .page {
    min-height: 100vh;
    max-width: 1000px;
    margin: 0 auto;
    padding: 24px 32px 80px;
  }
  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
    margin-bottom: 40px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-figure);
    font-size: 19px;
    font-weight: 600;
  }

  .layout {
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 56px;
    align-items: start;
  }

  /* Rail: the lineup filling in ------------------------------------------- */
  .rail ol {
    list-style: none;
    margin: 0;
    padding: 0;
    position: relative;
  }
  .step {
    position: relative;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    padding: 6px 0;
  }
  /* connecting thread */
  .step:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 13.5px;
    top: 38px;
    bottom: -10px;
    width: 1px;
    background: var(--line-strong);
  }
  .step.done:not(:last-child)::after {
    background: var(--ink-3);
  }
  .marker {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--paper);
    box-shadow: inset 0 0 0 1.5px var(--line-strong);
    color: var(--ink-3);
    font-size: 15px;
  }
  .step.done .marker {
    background: var(--ink);
    box-shadow: none;
    color: var(--paper);
  }
  .step.current .marker {
    background: var(--jersey);
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--jersey) 30%, transparent);
    color: var(--jersey-ink);
    font-weight: 600;
  }
  .step.problem .marker {
    background: var(--danger-soft);
    box-shadow: inset 0 0 0 1.5px var(--danger);
    color: var(--danger);
  }
  .step.skipped .marker {
    border: 1.5px dashed var(--line-strong);
    box-shadow: none;
  }
  .step-text {
    display: grid;
    min-width: 0;
    color: var(--ink-2);
  }
  .step.current .step-text,
  .step.problem .step-text {
    color: var(--ink);
    font-weight: 620;
  }
  .step.done .step-text {
    color: var(--ink);
  }
  .step-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-sub {
    font-size: var(--t-sm);
    font-weight: 400;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-flag {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-3);
  }
  .step-flag.warn {
    color: var(--danger);
  }

  /* Panel -------------------------------------------------------------------- */
  .panel,
  .solo {
    max-width: 560px;
  }
  .solo {
    margin: 10vh auto 0;
    text-align: left;
  }
  h1 {
    margin: 0 0 12px;
    font-family: var(--font-figure);
    font-size: 38px;
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: -0.02em;
    text-wrap: balance;
  }
  h1:focus {
    outline: none;
  }
  .email-h .addr {
    display: block;
    font-size: 0.72em;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
    margin-top: 4px;
  }
  .lede {
    margin: 0 0 24px;
    font-size: var(--t-lg);
    line-height: 1.55;
    color: var(--ink-2);
    max-width: 52ch;
  }
  .prep {
    list-style: none;
    margin: 0 0 32px;
    padding: 0;
    background: var(--sheet);
    border-radius: var(--r-lg);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .prep li {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    padding: 14px 18px;
  }
  .prep li + li {
    border-top: 1px solid var(--line);
  }
  .prep-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-md);
    background: var(--sunk);
    color: var(--ink-2);
  }
  .prep li > span:last-child {
    padding-top: 5px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .big {
    min-height: 46px;
    padding: 0 22px;
    font-size: 15px;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 22px;
  }
  .who-av {
    position: relative;
  }
  .bib {
    position: absolute;
    right: -6px;
    bottom: -4px;
    display: grid;
    place-items: center;
    min-width: 30px;
    height: 30px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    font-size: 16px;
    font-weight: 600;
    box-shadow: 0 0 0 3px var(--paper);
  }
  .bib.lead {
    background: var(--jersey);
    color: var(--jersey-ink);
  }
  .count {
    color: var(--ink-2);
    font-size: var(--t-sm);
    font-weight: 600;
  }

  .wait {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 28px;
    padding: 8px 14px 8px 12px;
    border-radius: 999px;
    background: var(--sheet);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--ink-2);
  }
  .pulse {
    position: relative;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--jersey);
  }
  .pulse::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid var(--jersey);
    animation: ping 1.6s var(--ease) infinite;
  }
  @keyframes ping {
    from {
      transform: scale(0.6);
      opacity: 1;
    }
    to {
      transform: scale(1.6);
      opacity: 0;
    }
  }

  .callout {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 12px 14px;
    margin: 0 0 16px;
    border-radius: var(--r-md);
  }
  .callout p {
    margin: 0;
  }
  .callout.warn {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .callout.info {
    background: var(--sheet);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--ink-2);
  }

  .compare {
    width: 100%;
    margin: 0 0 28px;
    border-collapse: collapse;
    background: var(--sheet);
    border-radius: var(--r-lg);
    box-shadow: inset 0 0 0 1px var(--line);
    font-size: var(--t-sm);
  }
  .compare th {
    text-align: left;
    padding: 12px 12px 6px;
    font-weight: 600;
    color: var(--ink-3);
  }
  .compare td {
    padding: 10px 12px;
    border-top: 1px solid var(--line);
    overflow-wrap: anywhere;
  }
  .compare .n {
    width: 44px;
    padding-left: 14px;
  }
  .compare .n span {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 15px;
    color: var(--ink-3);
  }
  .compare .n.lead span {
    background: var(--jersey);
    color: var(--jersey-ink);
    font-weight: 600;
  }
  .compare .mark {
    width: 40px;
    text-align: center;
  }
  .compare .ok {
    color: var(--ok);
  }
  .compare .no {
    color: var(--danger);
  }
  .compare tr.mismatch td:nth-child(3) {
    color: var(--danger);
  }
  .muted {
    color: var(--ink-3);
  }
  .action-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    color: var(--danger);
    font-size: var(--t-sm);
  }

  @media (max-width: 820px) {
    .page {
      padding: 16px 16px 60px;
    }
    .masthead {
      margin-bottom: 24px;
    }
    .layout {
      grid-template-columns: 1fr;
      gap: 32px;
    }
    .rail {
      order: 2;
    }
    h1 {
      font-size: 30px;
    }
  }
</style>
