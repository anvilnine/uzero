<script lang="ts">
  import { onMount } from 'svelte';
  import { getApi, type Api } from '../../lib/api';
  import { SAFARI_PRIVATE_LIMITATION, safariPinFeedback } from '../../lib/safariPin';
  import { pinEmail } from '../../lib/accounts';
  import type { AppState, LabelColor, Prefs, ServiceInfo } from '../../lib/types';
  import Avatar from '../../ui/Avatar.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import SiteLinks from '../../ui/SiteLinks.svelte';
  import { COLOR_NAMES, LABEL_COLORS, LABEL_MAX, cleanLabel, lineup, toneOf } from '../../ui/model';
  import { errorText } from '../../ui/nav';
  import { exportPrefs, parsePrefs } from '../../ui/prefsFile';
  import { FEATURE_REQUEST_URL, formLink, pageContext } from '../../lib/feedback';
  import { FEEDBACK_URL, REVIEW_URLS, STORE_NAMES, detectStore, loadAsk, rate, route, saveAsk, type AskState } from '../../lib/ask';
  import Stars from '../../ui/Stars.svelte';

  // No stars in Safari: Apple wants apps to use its own review prompt.
  const safariBuild = import.meta.env.BROWSER === 'safari';
  const featureUrl = formLink(FEATURE_REQUEST_URL, pageContext('options'));
  const feedbackUrl = formLink(FEEDBACK_URL, pageContext('options')) || 'https://uzero.app/support/';
  const store = detectStore(import.meta.env.BROWSER, typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const reviewUrl = store ? REVIEW_URLS[store] : '';
  // Same rating the reorder screen asks for. Here it is always reachable and can be changed.
  let ask = $state<AskState | null>(null);
  const stars = $derived(ask?.rating ?? 0);
  const path = $derived(stars ? route(stars) : null);

  async function pickStars(n: number) {
    ask = rate(ask ?? (await loadAsk()), n);
    await saveAsk(ask);
  }
  import { EMPTY_STATS, loadStats, saveStats, statRows, type Stats } from '../../lib/stats';

  let api: Api | null = null;
  let app = $state<AppState | null>(null);
  let services = $state<ServiceInfo[]>([]);
  let loadError = $state<string | null>(null);
  let pinVerified = $state(true);
  let notice = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  const labelTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** What's typed in a label field that has focus. Shown instead of the saved (trimmed) label. */
  let drafts = $state<Record<string, string>>({});
  let stats = $state<Stats>({ ...EMPTY_STATS });
  const locale = typeof navigator === 'undefined' ? undefined : navigator.language;
  const statList = $derived(statRows(stats, locale));

  const pinAttention = $derived(import.meta.env.BROWSER === 'safari' && (!pinVerified || app?.pinError !== null)
    ? safariPinFeedback(app?.prefs.pinEnabled ?? false, app?.pinError, pinVerified) : null);
  const rows = $derived(app ? lineup(app) : []);
  const active = $derived(rows.filter((r) => !r.inactive));
  // Same rule as the pin redirects: the first signed-in account in your order.
  const first = $derived.by(() => {
    const email = app ? pinEmail(app.prefs, app.accounts) : undefined;
    return rows.find((r) => r.email === email);
  });

  onMount(() => {
    void loadAsk().then((a) => (ask = a));
    let unsub = () => {};
    void loadStats().then((s) => (stats = s));
    (async () => {
      try {
        api = await getApi();
        unsub = api.subscribe((s) => { app = s; pinVerified = true; });
        const [s, list] = await Promise.all([
          api.send({ type: 'getState' }),
          api.send({ type: 'listServices' }),
        ]);
        app = s;
        services = list;
      } catch (e) {
        loadError = errorText(e);
      }
    })();
    return () => unsub();
  });

  async function resetStats() {
    if (!confirm('Set your numbers back to zero?')) return;
    stats = { ...EMPTY_STATS };
    await saveStats(stats);
  }

  async function save(patch: Partial<Prefs>) {
    if (!app || !api) return;
    app = { ...app, prefs: { ...app.prefs, ...patch } };
    if (import.meta.env.BROWSER === 'safari') pinVerified = false;
    try {
      await api.send({ type: 'savePrefs', patch });
      if (import.meta.env.BROWSER === 'safari') {
        app = await api.send({ type: 'getState' });
        pinVerified = true;
      }
    } catch (e) {
      if (import.meta.env.BROWSER === 'safari') pinVerified = false;
      notice = { kind: 'error', text: errorText(e) };
    }
  }

  function setMeta(email: string, patch: { label?: string; color?: LabelColor }) {
    if (!app) return;
    const next = { ...(app.prefs.meta[email] ?? {}), ...patch };
    if (patch.label !== undefined) {
      const l = cleanLabel(patch.label).trim();
      if (l) next.label = l;
      else delete next.label;
    }
    void save({ meta: { ...app.prefs.meta, [email]: next } });
  }

  function onLabel(email: string, value: string) {
    drafts[email] = value;
    clearTimeout(labelTimers.get(email));
    labelTimers.set(
      email,
      setTimeout(() => setMeta(email, { label: value }), 400),
    );
  }

  /** Blur: save now, then show the saved (trimmed) label again. */
  function commitLabel(email: string) {
    const value = drafts[email];
    if (value === undefined) return;
    clearTimeout(labelTimers.get(email));
    labelTimers.delete(email);
    delete drafts[email];
    if (cleanLabel(value).trim() !== (app?.prefs.meta[email]?.label ?? '')) setMeta(email, { label: value });
  }

  function toggleService(id: string, on: boolean) {
    if (!app) return;
    const set = new Set(app.prefs.disabledServices);
    if (on) set.delete(id);
    else set.add(id);
    void save({ disabledServices: [...set] });
  }

  function setServiceDefault(id: string, email: string) {
    if (!app) return;
    const next = { ...app.prefs.serviceDefaults };
    if (email) next[id] = email;
    else delete next[id];
    void save({ serviceDefaults: next });
  }

  function download() {
    if (!app) return;
    const blob = new Blob([exportPrefs(app.prefs)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uzero-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice = { kind: 'ok', text: 'Settings exported.' };
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 200_000) {
      notice = { kind: 'error', text: 'That file is too large to be a Uzero backup.' };
      return;
    }
    const res = parsePrefs(await file.text());
    if (!res.ok) {
      notice = { kind: 'error', text: res.error };
      return;
    }
    // Importing never turns Pin on (or off): that stays the user's call on this computer.
    const { pinEnabled: _keep, ...imported } = res.prefs;
    await save(imported);
    const n = res.prefs.order.length;
    notice = {
      kind: 'ok',
      text:
        `Imported settings for ${n} ${n === 1 ? 'account' : 'accounts'}.` +
        (res.skipped ? ` Skipped ${res.skipped} invalid ${res.skipped === 1 ? 'entry' : 'entries'}.` : ''),
    };
  }

  function short(email: string) {
    const r = rows.find((x) => x.email === email);
    return r?.meta.label ? `${r.meta.label} (${email})` : email;
  }
</script>

<header class="appbar">
  <img src="/icon/32.png" alt="" width="24" height="24" />
  <span>Uzero</span>
</header>

<main class="page">
  <h1>Settings</h1>

  {#if import.meta.env.BROWSER === 'safari'}
    <aside class="card pad small" aria-label="Safari limitation">
      <p>{SAFARI_PRIVATE_LIMITATION}</p>
      {#if app?.pinError}<p class="error" role="status">{app.pinError}</p>{/if}
    </aside>
  {/if}

  {#if loadError}
    <div class="card pad" role="alert">
      <p class="error">Couldn’t load your settings. {loadError}</p>
    </div>
  {:else if !app}
    <p class="muted center" aria-busy="true">Loading your accounts…</p>
  {:else}
    <section class="card" aria-labelledby="h-accounts">
      <div class="card-head">
        <h2 id="h-accounts">Accounts</h2>
        <p>In your order. To reorder, use the Uzero button in your toolbar.</p>
      </div>

      {#if rows.length === 0}
        <p class="pad muted">No Google accounts found. Sign in to Google, then come back.</p>
      {:else}
        <ol class="accounts">
          {#each rows as r (r.email)}
            <li class="acct" class:inactive={r.inactive}>
              <span class="slot" aria-hidden="true">{r.slot}</span>
              <Avatar
                name={r.name}
                email={r.email}
                photo={r.account?.photo}
                tone={toneOf(r)}
                dim={r.inactive}
              />
              <div class="who">
                <span class="name">{r.name}</span>
                <span class="email">{r.inactive ? `${r.email} · Signed out` : r.email}</span>
              </div>
              <label class="label-field">
                <span class="sr-only">Label for {r.email}</span>
                <input
                  class="field"
                  type="text"
                  value={drafts[r.email] ?? r.meta.label ?? ''}
                  maxlength={LABEL_MAX}
                  placeholder="Add a label"
                  oninput={(e) => onLabel(r.email, (e.currentTarget as HTMLInputElement).value)}
                  onblur={() => commitLabel(r.email)}
                />
              </label>
              <label class="color-field tone-{toneOf(r)}">
                <span class="sr-only">Color for {r.email}</span>
                <span class="dot" aria-hidden="true"></span>
                <select
                  class="field"
                  value={toneOf(r)}
                  onchange={(e) =>
                    setMeta(r.email, { color: (e.currentTarget as HTMLSelectElement).value as LabelColor })}
                >
                  {#each LABEL_COLORS as c (c)}
                    <option value={c}>{COLOR_NAMES[c]}</option>
                  {/each}
                </select>
              </label>
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <section class="card" aria-labelledby="h-pin">
      <div class="card-head">
        <h2 id="h-pin">Pin</h2>
        <p>
          When a Google link doesn’t name an account, open it as your default account{first
            ? `, ${short(first.email)}`
            : ''}, or as the account you choose for that app.
        </p>
      </div>

      <div class="pin-row">
        <div>
          <span class="strong" id="pin-l">Pin default account</span>
          <span class="muted small" id="pin-d">
            {pinAttention ?? (app.prefs.pinEnabled ? 'On for the apps turned on below.' : 'Off. Google picks the account.')}
          </span>
        </div>
        <Toggle
          checked={app.prefs.pinEnabled}
          label="Pin default account"
          describedby="pin-d"
          onchange={(v) => save({ pinEnabled: v })}
        />
      </div>

      <table class="services" class:off={!app.prefs.pinEnabled}>
        <thead>
          <tr>
            <th scope="col">App</th>
            <th scope="col">Opens as</th>
            <th scope="col" class="r">Pin</th>
          </tr>
        </thead>
        <tbody>
          {#each services as s (s.id)}
            {@const on = !app.prefs.disabledServices.includes(s.id)}
            {@const picked = app.prefs.serviceDefaults[s.id]}
            <tr class:disabled={!on}>
              <th scope="row">{s.name}</th>
              <td>
                <select
                  class="field"
                  aria-label="{s.name} opens as"
                  value={app.prefs.serviceDefaults[s.id] ?? ''}
                  disabled={!on}
                  onchange={(e) => setServiceDefault(s.id, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">Default{first ? ` (${first.meta.label ?? first.email})` : ''}</option>
                  {#each active as r (r.email)}
                    <option value={r.email}>{r.meta.label ? `${r.meta.label}: ${r.email}` : r.email}</option>
                  {/each}
                  {#if picked && !active.some((r) => r.email === picked)}
                    <option value={picked}>{picked} (signed out, opens as default)</option>
                  {/if}
                </select>
              </td>
              <td class="r">
                <Toggle checked={on} label="Pin {s.name}" onchange={(v) => toggleService(s.id, v)} />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    {#if import.meta.env.BROWSER === 'safari'}
      <section class="card" aria-labelledby="h-guide">
        <div class="card-head">
          <h2 id="h-guide">Reorder guide</h2>
          <p>Choose where Safari shows the steps while you sign in to Google.</p>
        </div>
        <div class="pad">
          <label>
            Guide location
            <select
              value={app.prefs.safariGuideMode}
              onchange={(e) => void save({ safariGuideMode: e.currentTarget.value === 'overlay' ? 'overlay' : 'window' })}
            >
              <option value="window">Guide window</option>
              <option value="overlay">Sign-in overlay</option>
            </select>
          </label>
        </div>
      </section>
    {/if}

    <section class="card stats" aria-labelledby="h-stats">
      <div class="card-head">
        <h2 id="h-stats">Your numbers</h2>
        <p>Uzero counts these on this computer and never sends them anywhere.</p>
      </div>
      {#if statList.length}
        <dl>
          {#each statList as row (row.id)}
            <div>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          {/each}
        </dl>
        <div class="actions">
          <button type="button" class="btn btn-text" onclick={resetStats}>Reset numbers</button>
        </div>
      {:else}
        <p class="pad muted empty">Nothing yet. Once Pin opens a link or you switch a tab, the count starts here.</p>
      {/if}
    </section>

    <section class="card" aria-labelledby="h-backup">
      <div class="card-head">
        <h2 id="h-backup">Backup</h2>
        <p>Save your order, labels and Pin choices to a file, or load them on another computer.</p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-outlined" onclick={download}>Export settings</button>
        <button type="button" class="btn btn-outlined" onclick={() => fileInput?.click()}>
          Import settings
        </button>
        <input
          bind:this={fileInput}
          class="sr-only"
          type="file"
          accept="application/json,.json"
          tabindex="-1"
          aria-hidden="true"
          onchange={onFile}
        />
      </div>
      {#if notice}
        <p class="notice" class:error={notice.kind === 'error'} role="status">{notice.text}</p>
      {/if}
    </section>

    <section class="card" aria-labelledby="h-feedback">
      <div class="card-head">
        <h2 id="h-feedback">Feedback</h2>
        <p>{stars && !safariBuild ? `You gave Uzero ${stars} of 5.` : 'How is Uzero working for you?'}</p>
      </div>
      {#if !safariBuild}
        <div class="rate">
          <Stars value={stars} label="Rate Uzero" onpick={pickStars} />
        </div>
      {/if}
      <div class="actions">
        {#if path === 'review' && reviewUrl}
          <a class="btn btn-filled" href={reviewUrl} target="_blank" rel="noreferrer">Write a review</a>
          <a class="btn btn-outlined" href={feedbackUrl} target="_blank" rel="noreferrer">Send feedback</a>
        {:else if path === 'feedback'}
          <a class="btn btn-filled" href={feedbackUrl} target="_blank" rel="noreferrer">Send feedback</a>
        {:else}
          <a class="btn btn-outlined" href={feedbackUrl} target="_blank" rel="noreferrer">Send feedback</a>
        {/if}
        {#if featureUrl}
          <a class="btn btn-outlined" href={featureUrl} target="_blank" rel="noreferrer">Suggest a feature</a>
        {/if}
      </div>
    </section>

    <section class="card how" aria-labelledby="h-how">
      <div class="card-head">
        <h2 id="h-how">How it works</h2>
      </div>
      <dl>
        <div>
          <dt>Your order</dt>
          <dd>Drag accounts in the toolbar popup. The first one is your default.</dd>
        </div>
        <div>
          <dt>Switch a tab</dt>
          <dd>
            Click an account in the popup to reopen the Google page you’re on as that account.
            Alt+1 to Alt+4 switch to your first four.
          </dd>
        </div>
        <div>
          <dt>Pin</dt>
          <dd>Links that don’t name an account open as your default. You stay signed in to everything.</dd>
        </div>
        <div>
          <dt>Reorder in Google</dt>
          <dd>
            Google numbers accounts in the order you signed in (/u/0, /u/1…). Reorder signs you out of
            all of them, then guides you through signing back in, in your order. You type every
            password yourself.
          </dd>
        </div>
        <div>
          <dt>Privacy</dt>
          <dd>Your order, labels and settings are stored in this browser only.</dd>
        </div>
      </dl>
    </section>
  {/if}
  <SiteLinks />
</main>

<style>
  .appbar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 64px;
    padding: 0 24px;
    font-size: 18px;
    line-height: 24px;
    color: var(--on-surface-variant);
  }
  .appbar img {
    display: block;
    border-radius: 6px;
  }

  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 8px 24px 80px;
  }
  h1 {
    margin: 16px 0 32px;
    font-size: 28px;
    font-weight: 400;
    line-height: 36px;
    text-align: center;
  }

  .card {
    margin-bottom: 16px;
    border-radius: var(--r-xl);
    background: var(--surface-container);
    padding: 8px 0;
  }
  .pad {
    padding: 16px 24px;
  }
  .card-head {
    padding: 16px 24px 12px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 400;
    line-height: 28px;
  }
  .card-head p {
    margin: 4px 0 0;
    color: var(--on-surface-variant);
    max-width: 62ch;
  }
  .muted {
    color: var(--on-surface-variant);
  }
  .center {
    text-align: center;
  }
  .small {
    font-size: var(--t-sm);
    line-height: 16px;
  }
  .error {
    margin: 0;
    color: var(--error);
  }

  /* Accounts ------------------------------------------------------------ */
  .accounts {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .acct {
    display: grid;
    grid-template-columns: 16px 32px minmax(0, 1fr) 160px 132px;
    align-items: center;
    gap: 16px;
    min-height: 64px;
    padding: 8px 24px;
    border-top: 1px solid var(--outline-variant);
  }
  .slot {
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .email {
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inactive .name {
    color: var(--on-surface-variant);
    font-weight: 400;
  }
  .color-field {
    position: relative;
    display: block;
  }
  .color-field .dot {
    position: absolute;
    left: 12px;
    top: 50%;
    margin-top: -4px;
    pointer-events: none;
  }
  .color-field select {
    padding-left: 30px;
  }

  /* Pin ----------------------------------------------------------------- */
  .pin-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 24px;
    border-top: 1px solid var(--outline-variant);
  }
  .pin-row > div {
    display: grid;
  }
  .strong {
    font-weight: 500;
  }

  .services {
    width: 100%;
    border-collapse: collapse;
  }
  .services th,
  .services td {
    padding: 8px 12px;
    text-align: left;
  }
  .services th:first-child {
    padding-left: 24px;
  }
  .services .r {
    padding-right: 24px;
    text-align: right;
    width: 96px;
  }
  .services thead th {
    padding-top: 12px;
    padding-bottom: 4px;
    font-size: var(--t-sm);
    font-weight: 500;
    color: var(--on-surface-variant);
    border-top: 1px solid var(--outline-variant);
  }
  .services tbody th {
    font-weight: 400;
    width: 34%;
  }
  .services tbody tr + tr {
    border-top: 1px solid var(--outline-variant);
  }
  .services tr.disabled th {
    color: var(--on-surface-variant);
  }
  .services select {
    height: 36px;
    border: 0;
    border-radius: var(--r-sm);
    background-color: var(--surface);
  }
  .services.off tbody {
    opacity: 0.6;
  }

  .empty {
    margin: 0;
    padding-top: 0;
  }

  /* Feedback ------------------------------------------------------------ */
  .rate {
    padding: 0 18px 4px;
  }

  /* Backup -------------------------------------------------------------- */
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 24px 16px;
  }
  .notice {
    margin: 0;
    padding: 0 24px 16px;
    color: var(--on-surface-variant);
  }
  .notice.error {
    color: var(--error);
  }

  /* Your numbers -------------------------------------------------------- */
  .stats dl {
    margin: 0;
  }
  .stats dl > div {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 24px;
    border-top: 1px solid var(--outline-variant);
  }
  .stats dd {
    color: var(--on-surface);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .stats .actions {
    padding-top: 8px;
  }

  /* How it works -------------------------------------------------------- */
  .how dl {
    margin: 0;
  }
  .how dl > div {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 16px;
    padding: 14px 24px;
    border-top: 1px solid var(--outline-variant);
  }
  dt {
    font-weight: 500;
  }
  dd {
    margin: 0;
    color: var(--on-surface-variant);
    max-width: 60ch;
  }

  @media (max-width: 680px) {
    .page {
      padding: 0 16px 60px;
    }
    .appbar {
      padding: 0 16px;
    }
    .acct {
      grid-template-columns: 16px 32px minmax(0, 1fr);
      padding: 12px 16px;
    }
    .label-field,
    .color-field {
      grid-column: 3;
    }
    .card-head,
    .pin-row,
    .how dl > div,
    .stats dl > div {
      padding-left: 16px;
      padding-right: 16px;
    }
    .how dl > div {
      grid-template-columns: 1fr;
      gap: 4px;
    }
  }
</style>
