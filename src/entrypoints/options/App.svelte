<script lang="ts">
  import { onMount } from 'svelte';
  import { getApi, type Api } from '../../lib/api';
  import { pinEmail } from '../../lib/accounts';
  import type { AppState, LabelColor, Prefs, ServiceInfo } from '../../lib/types';
  import Avatar from '../../ui/Avatar.svelte';
  import Icon from '../../ui/Icon.svelte';
  import Mark from '../../ui/Mark.svelte';
  import Swatches from '../../ui/Swatches.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import { LABEL_MAX, cleanLabel, lineup, toneOf } from '../../ui/model';
  import { errorText } from '../../ui/nav';
  import { exportPrefs, parsePrefs } from '../../ui/prefsFile';

  let api: Api | null = null;
  let app = $state<AppState | null>(null);
  let services = $state<ServiceInfo[]>([]);
  let loadError = $state<string | null>(null);
  let notice = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  const labelTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** What's typed in a label field that has focus. Shown instead of the saved (trimmed) label. */
  let drafts = $state<Record<string, string>>({});

  const rows = $derived(app ? lineup(app) : []);
  const active = $derived(rows.filter((r) => !r.inactive));
  // Same rule as the pin redirects: the first signed-in account in your order.
  const first = $derived.by(() => {
    const email = app ? pinEmail(app.prefs, app.accounts) : undefined;
    return rows.find((r) => r.email === email);
  });

  onMount(() => {
    let unsub = () => {};
    (async () => {
      try {
        api = await getApi();
        unsub = api.subscribe((s) => (app = s));
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

  async function save(patch: Partial<Prefs>) {
    if (!app || !api) return;
    app = { ...app, prefs: { ...app.prefs, ...patch } };
    try {
      await api.send({ type: 'savePrefs', patch });
    } catch (e) {
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
    a.download = `lineup-settings-${new Date().toISOString().slice(0, 10)}.json`;
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
      notice = { kind: 'error', text: 'That file is too large to be a Lineup backup.' };
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

<div class="page">
  <header class="masthead">
    <Mark size={30} />
    <div>
      <h1>Lineup</h1>
      <p>Settings</p>
    </div>
  </header>

  {#if loadError}
    <div class="callout danger" role="alert">
      <Icon name="alert" />
      <p>Couldn’t load your settings. {loadError}</p>
    </div>
  {:else if !app}
    <p class="muted" aria-busy="true">Loading your accounts…</p>
  {:else}
    <section aria-labelledby="h-accounts">
      <div class="sec-head">
        <h2 id="h-accounts">Your accounts</h2>
        <p>In your order. Drag to reorder from the Lineup button in your toolbar.</p>
      </div>

      {#if rows.length === 0}
        <div class="sheet empty">
          <p>No Google accounts found. Sign in at google.com, then come back.</p>
        </div>
      {:else}
        <ol class="sheet accounts">
          {#each rows as r (r.email)}
            <li class="acct" class:inactive={r.inactive}>
              <span class="slot figure" class:lead={r.slot === 1} aria-hidden="true">{r.slot}</span>
              <Avatar
                name={r.name}
                email={r.email}
                photo={r.account?.photo}
                tone={toneOf(r)}
                size={38}
                dim={r.inactive}
              />
              <div class="who">
                <span class="name">{r.name}</span>
                <span class="email">{r.email}</span>
                {#if r.inactive}<span class="signed-out">Signed out</span>{/if}
              </div>
              <label class="label-field">
                <span class="sr-only">Label for {r.email}</span>
                <input
                  type="text"
                  value={drafts[r.email] ?? r.meta.label ?? ''}
                  maxlength={LABEL_MAX}
                  placeholder="Add a label"
                  oninput={(e) => onLabel(r.email, (e.currentTarget as HTMLInputElement).value)}
                  onblur={() => commitLabel(r.email)}
                />
              </label>
              <Swatches
                value={toneOf(r)}
                name="c-{r.email}"
                legend="Color for {r.email}"
                onchange={(c) => setMeta(r.email, { color: c })}
              />
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <section aria-labelledby="h-pin">
      <div class="sec-head">
        <h2 id="h-pin">Pin</h2>
        <p>
          When a Google link names no account, open it as your #1{first ? `, ${short(first.email)}` : ''},
          or as the account you choose for that app.
        </p>
      </div>

      <div class="sheet">
        <div class="pin-row">
          <div>
            <span class="strong" id="pin-l">Pin your #1</span>
            <span class="muted small" id="pin-d">
              {app.prefs.pinEnabled ? 'On for every app you leave on.' : 'Off. Google picks the account.'}
            </span>
          </div>
          <Toggle
            checked={app.prefs.pinEnabled}
            label="Pin your #1"
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
                    aria-label="{s.name} opens as"
                    value={app.prefs.serviceDefaults[s.id] ?? ''}
                    disabled={!on}
                    onchange={(e) => setServiceDefault(s.id, (e.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="">Your #1{first ? ` (${first.meta.label ?? first.email})` : ''}</option>
                    {#each active as r (r.email)}
                      <option value={r.email}>{r.meta.label ? `${r.meta.label}: ${r.email}` : r.email}</option>
                    {/each}
                    {#if picked && !active.some((r) => r.email === picked)}
                      <option value={picked}>{picked} (signed out, opens as your #1)</option>
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
      </div>
    </section>

    <section aria-labelledby="h-backup">
      <div class="sec-head">
        <h2 id="h-backup">Backup</h2>
        <p>Save your order, labels and pin choices to a file, or load them on another computer.</p>
      </div>
      <div class="actions">
        <button type="button" class="btn" onclick={download}>
          <Icon name="download" size={18} /> Export settings
        </button>
        <button type="button" class="btn" onclick={() => fileInput?.click()}>
          <Icon name="upload" size={18} /> Import settings
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
        <p class="notice {notice.kind}" role="status">
          <Icon name={notice.kind === 'ok' ? 'check' : 'alert'} size={18} />
          {notice.text}
        </p>
      {/if}
    </section>

    <section aria-labelledby="h-how" class="how">
      <div class="sec-head">
        <h2 id="h-how">How it works</h2>
      </div>
      <dl>
        <div>
          <dt>Your order</dt>
          <dd>Drag accounts in the toolbar popup. Your #1 is your default.</dd>
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
          <dd>Links that name no account open as your #1. You stay signed in to everything.</dd>
        </div>
        <div>
          <dt>Make it real</dt>
          <dd>
            Google numbers accounts in the order you signed in (/u/0, /u/1…). Make it real signs
            you out of all of them, then walks you through signing back in, in your order. You type
            every password yourself.
          </dd>
        </div>
      </dl>
      <div class="privacy">
        <Icon name="shield" />
        <p>
          Your order, labels and settings stay in this browser. Lineup only talks to Google, to see
          which accounts are signed in.
        </p>
      </div>
    </section>
  {/if}
</div>

<style>
  .page {
    max-width: 780px;
    margin: 0 auto;
    padding: 48px 28px 80px;
  }
  .masthead {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 40px;
  }
  .masthead h1 {
    margin: 0;
    font-family: var(--font-figure);
    font-size: var(--t-2xl);
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.05;
  }
  .masthead p {
    margin: 2px 0 0;
    color: var(--ink-2);
  }

  section {
    margin-bottom: 48px;
  }
  .sec-head {
    margin-bottom: 14px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-figure);
    font-size: var(--t-xl);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .sec-head p {
    margin: 4px 0 0;
    color: var(--ink-2);
    max-width: 62ch;
  }

  .sheet {
    background: var(--sheet);
    border-radius: var(--r-lg);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .empty {
    padding: 20px;
    color: var(--ink-2);
  }
  .empty p {
    margin: 0;
  }

  .accounts {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .acct {
    display: grid;
    grid-template-columns: 28px 38px minmax(0, 1fr) 150px auto;
    align-items: center;
    gap: 12px;
    padding: 12px 14px 12px 12px;
  }
  .acct + .acct {
    border-top: 1px solid var(--line);
  }
  .slot {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    font-size: 17px;
    color: var(--ink-3);
  }
  .slot.lead {
    background: var(--jersey);
    color: var(--jersey-ink);
    font-weight: 600;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .name {
    font-weight: 620;
  }
  .email {
    color: var(--ink-2);
    font-size: var(--t-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .signed-out {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-3);
  }
  .inactive .name,
  .inactive .email {
    color: var(--ink-3);
  }
  .label-field input,
  select {
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--sheet-raised);
    font-size: var(--t-sm);
  }
  .label-field input::placeholder {
    color: var(--ink-3);
  }
  .acct :global(.swatches) {
    flex-wrap: nowrap;
    gap: 0;
  }
  .acct :global(.sw) {
    width: 24px;
    height: 32px;
  }
  .acct :global(.sw::before) {
    width: 14px;
    height: 14px;
  }
  .acct :global(.sw[aria-checked='true']::after) {
    inset: 6px 2px;
    box-shadow: 0 0 0 1.5px var(--tone);
  }

  .pin-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px;
    border-bottom: 1px solid var(--line);
  }
  .pin-row > div {
    display: grid;
  }
  .strong {
    font-weight: 650;
  }
  .muted {
    color: var(--ink-2);
  }
  .small {
    font-size: var(--t-sm);
  }

  .services {
    width: 100%;
    border-collapse: collapse;
  }
  .services th,
  .services td {
    padding: 8px 16px;
    text-align: left;
  }
  .services thead th {
    padding-top: 12px;
    padding-bottom: 4px;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--ink-3);
  }
  .services tbody th {
    font-weight: 560;
    width: 34%;
  }
  .services tbody tr + tr {
    border-top: 1px solid var(--line);
  }
  .services .r {
    text-align: right;
    width: 72px;
  }
  .services td.r {
    padding-top: 0;
    padding-bottom: 0;
  }
  .services tr.disabled th {
    color: var(--ink-3);
  }
  .services.off tbody {
    opacity: 0.55;
  }
  .services tbody tr:last-child td,
  .services tbody tr:last-child th {
    padding-bottom: 12px;
  }
  select:disabled {
    opacity: 0.6;
  }

  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 0;
    font-size: var(--t-sm);
  }
  .notice.ok {
    color: var(--ok);
  }
  .notice.error {
    color: var(--danger);
  }

  .how dl {
    margin: 0;
    display: grid;
    gap: 0;
    border-top: 1px solid var(--line);
  }
  .how dl > div {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  dt {
    font-weight: 650;
  }
  dd {
    margin: 0;
    color: var(--ink-2);
    max-width: 60ch;
  }
  .privacy {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-top: 20px;
    padding: 14px 16px;
    border-radius: var(--r-lg);
    background: var(--sunk);
    color: var(--ink-2);
  }
  .privacy :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--ok);
  }
  .privacy p {
    margin: 0;
  }

  .callout {
    display: flex;
    gap: 10px;
    padding: 14px 16px;
    border-radius: var(--r-lg);
  }
  .callout p {
    margin: 0;
  }
  .callout.danger {
    background: var(--danger-soft);
    color: var(--danger);
  }

  @media (max-width: 680px) {
    .page {
      padding: 28px 16px 60px;
    }
    .acct {
      grid-template-columns: 28px 38px minmax(0, 1fr);
    }
    .label-field {
      grid-column: 3;
    }
    .acct :global(.swatches) {
      grid-column: 3;
      flex-wrap: wrap;
    }
    .how dl > div {
      grid-template-columns: 1fr;
      gap: 4px;
    }
  }
</style>
