<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { getApi, type Api } from '../../lib/api';
  import { pinEmail } from '../../lib/accounts';
  import { inProgress } from '../../lib/wizard';
  import type { AppState, LabelColor, ServiceInfo } from '../../lib/types';
  import Avatar from '../../ui/Avatar.svelte';
  import Icon from '../../ui/Icon.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import AccountSheet from './AccountSheet.svelte';
  import {
    cleanLabel,
    lineup,
    move,
    readCache,
    toneOf,
    writeCache,
    type Row,
  } from '../../ui/model';
  import { closeView, errorText, openOptions, openSidePanel, reducedMotion } from '../../ui/nav';

  // ---- State ---------------------------------------------------------------
  let api: Api | null = null;
  let app = $state<AppState | null>(readCache());
  let fatal = $state<string | null>(null);
  let busy = $state(true);
  let tab = $state<{ serviceId: string | null; email: string | null } | null>(null);
  let services = $state<ServiceInfo[]>([]);
  let sheetFor = $state<string | null>(null);
  let toast = $state('');
  let announce = $state('');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** This popup's window. Chrome's side panel needs it, and must open before any await. */
  let windowId: number | undefined;

  const rows = $derived(app ? lineup(app) : []);
  // Same rule as the pin redirects: the first signed-in account in your order.
  const first = $derived.by(() => {
    const email = app ? pinEmail(app.prefs, app.accounts) : undefined;
    return rows.find((r) => r.email === email);
  });
  // A reorder that was started and not finished: offer to resume it instead of starting another.
  const reorder = $derived.by(() => {
    const w = app?.wizard ?? null;
    if (!w || !inProgress(w)) return null;
    return { expired: w.phase === 'error' && w.errorKind === 'expired', queue: w.queue };
  });
  const sheetRow = $derived(rows.find((r) => r.email === sheetFor) ?? null);
  const tabService = $derived(
    tab?.serviceId ? (services.find((s) => s.id === tab!.serviceId)?.name ?? 'Google') : null,
  );
  const canSwitch = $derived(!!tab?.serviceId);
  const statusError = $derived(app?.status.kind === 'error' ? app.status.message : null);
  const activeCount = $derived(rows.filter((r) => !r.inactive).length);
  // Does Google's own /u/N order already match the user's order?
  const inSync = $derived(
    rows.filter((r) => !r.inactive).every((r, i) => r.account?.index === i),
  );

  /** Latest state that arrived mid-drag; applied on pointerup. */
  let queued: AppState | null = null;

  function accept(s: AppState) {
    if (dragging) {
      queued = s; // never yank the list from under the pointer
      return;
    }
    queued = null;
    app = s;
    fatal = null;
    writeCache(s);
  }

  onMount(() => {
    let unsub = () => {};
    if (typeof browser !== 'undefined' && browser.windows) {
      browser.windows.getCurrent().then((w) => (windowId = w.id), () => {});
    }
    (async () => {
      api = await getApi();
      unsub = api.subscribe(accept);
      api
        .send({ type: 'activeTabService' })
        .then((t) => (tab = t))
        .catch(() => (tab = { serviceId: null, email: null }));
      api
        .send({ type: 'listServices' })
        .then((s) => (services = s))
        .catch(() => {});
      try {
        accept(await api.send({ type: 'getState' }));
      } catch (e) {
        if (!app) fatal = errorText(e);
      }
      await refresh();
    })();
    return () => unsub();
  });

  async function refresh() {
    if (!api) return;
    busy = true;
    try {
      accept(await api.send({ type: 'refresh' }));
    } catch (e) {
      if (!app) fatal = errorText(e);
      else say(errorText(e));
    } finally {
      busy = false;
    }
  }

  function say(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 3200);
  }

  async function save(patch: Partial<AppState['prefs']>) {
    if (!app || !api) return;
    app = { ...app, prefs: { ...app.prefs, ...patch } };
    writeCache(app);
    try {
      await api.send({ type: 'savePrefs', patch });
    } catch (e) {
      say(errorText(e));
    }
  }

  function setOrder(order: string[]) {
    void save({ order });
  }

  function describe(r: Row) {
    return r.meta.label ? `${r.meta.label} (${r.email})` : r.email;
  }

  async function moveBy(email: string, delta: -1 | 1) {
    const order = rows.map((r) => r.email);
    const from = order.indexOf(email);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    const hadFocus = !!listEl?.contains(document.activeElement);
    setOrder(move(order, from, to));
    await tick();
    if (hadFocus) {
      // Keyed rows can be re-inserted on reorder; keep focus on the moved one.
      const items = listEl?.querySelectorAll<HTMLElement>('.row-main');
      items?.[to]?.focus();
    }
    const r = rows.find((x) => x.email === email);
    if (r) announce = `${describe(r)} moved to ${r.slot} of ${rows.length}.`;
  }

  async function switchTo(r: Row) {
    if (suppressClick) return;
    if (!api) return;
    if (r.inactive) {
      say('This account is signed out.');
      return;
    }
    if (!canSwitch) {
      say('Open a Google page first, then pick an account.');
      return;
    }
    if (tab?.email === r.email) {
      say(`This tab is already ${r.email}.`);
      return;
    }
    try {
      const res = await api.send({ type: 'switchActiveTab', email: r.email });
      if (res.ok) closeView();
      else say(res.reason ?? 'This page can’t switch accounts.');
    } catch (e) {
      say(errorText(e));
    }
  }

  async function togglePin(on: boolean) {
    await save({ pinEnabled: on });
    announce = on ? 'Pin is on.' : 'Pin is off.';
  }

  async function makeItReal() {
    if (!api || !app) return;
    // The steps sit next to Google's sign-in page in the side panel, when the browser has one.
    // Opened before any await (it needs this click); if it fails, the reorder tab opens instead.
    const opening = openSidePanel(windowId);
    try {
      // While a reorder runs, the background keeps it and just brings its page back.
      const queue = reorder?.queue ?? rows.filter((r) => !r.inactive).map((r) => r.email);
      const panel = await opening;
      await api.send(panel ? { type: 'wizardOpen', queue, panel } : { type: 'wizardOpen', queue });
      closeView();
    } catch (e) {
      say(errorText(e));
    }
  }

  async function cancelReorder() {
    if (!api || !app) return;
    try {
      await api.send({ type: 'wizardCancel' });
      app = { ...app, wizard: null };
      announce = 'Reorder cancelled.';
    } catch (e) {
      say(errorText(e));
    }
  }

  function setMeta(email: string, patch: { label?: string; color?: LabelColor }) {
    if (!app) return;
    const prev = app.prefs.meta[email] ?? {};
    const next = { ...prev, ...patch };
    if (patch.label !== undefined) {
      // Not trimmed here: the sheet trims on commit, so a space typed mid-word survives the debounce.
      const l = cleanLabel(patch.label);
      if (l.trim()) next.label = l;
      else delete next.label;
    }
    void save({ meta: { ...app.prefs.meta, [email]: next } });
  }

  async function openService(serviceId: string, email: string) {
    if (!api) return;
    try {
      await api.send({ type: 'openService', serviceId, email });
      closeView();
    } catch (e) {
      say(errorText(e));
    }
  }

  // ---- Keyboard ------------------------------------------------------------
  let listEl = $state<HTMLOListElement | null>(null);

  function onRowKey(e: KeyboardEvent, r: Row) {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      void moveBy(r.email, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const keys: Record<string, number> = { ArrowUp: r.slot - 2, ArrowDown: r.slot, Home: 0, End: rows.length - 1 };
    const target = keys[e.key];
    if (target === undefined) return;
    e.preventDefault();
    const el = listEl?.querySelectorAll<HTMLElement>('.row-main')[target];
    el?.focus();
  }

  // ---- Pointer drag --------------------------------------------------------
  let dragging = $state<string | null>(null);
  let lift = $state(0);
  let suppressClick = false;
  let drag: {
    email: string;
    el: HTMLElement;
    pointerId: number;
    startY: number;
    startTop: number;
    startScroll: number;
    y: number;
  } | null = null;
  let scroller = $state<HTMLElement | null>(null);

  function onPointerDown(e: PointerEvent, r: Row) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.row-menu')) return;
    const el = e.currentTarget as HTMLElement;
    drag = {
      email: r.email,
      el,
      pointerId: e.pointerId,
      startY: e.clientY,
      startTop: el.offsetTop,
      startScroll: scroller?.scrollTop ?? 0,
      y: e.clientY,
    };
  }

  async function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.y = e.clientY;
    if (!dragging) {
      if (Math.abs(e.clientY - drag.startY) < 5) return;
      dragging = drag.email;
      suppressClick = true;
      drag.el.setPointerCapture(e.pointerId);
    }
    autoScroll(e.clientY);
    await place();
  }

  async function place() {
    if (!drag) return;
    const scrollDelta = (scroller?.scrollTop ?? 0) - drag.startScroll;
    const top = drag.startTop + (drag.y - drag.startY) + scrollDelta;
    const step = drag.el.offsetHeight;
    const order = rows.map((r) => r.email);
    const from = order.indexOf(drag.email);
    const to = Math.max(0, Math.min(order.length - 1, Math.round(top / step)));
    if (from >= 0 && to !== from && app) {
      app = { ...app, prefs: { ...app.prefs, order: move(order, from, to) } };
      await tick();
    }
    if (drag) lift = top - drag.el.offsetTop;
  }

  function autoScroll(y: number) {
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    if (y < box.top + 24) scroller.scrollTop -= 8;
    else if (y > box.bottom - 24) scroller.scrollTop += 8;
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const email = drag.email;
    const wasDragging = !!dragging;
    drag = null;
    dragging = null;
    lift = 0;
    if (wasDragging && app) {
      const order = app.prefs.order;
      if (queued) {
        // Catch up on what changed during the drag, keeping the order the user just dropped.
        const q = queued;
        queued = null;
        app = { ...q, prefs: { ...q.prefs, order } };
        fatal = null;
      }
      setOrder(order);
      const r = rows.find((x) => x.email === email);
      if (r) announce = `${describe(r)} moved to ${r.slot} of ${rows.length}.`;
      // The click that follows this pointerup belongs to the drag.
      setTimeout(() => (suppressClick = false), 0);
    }
  }

  function flipFor(email: string) {
    return { duration: dragging === email || reducedMotion() ? 0 : 200 };
  }
</script>


<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerUp} />

<div class="popup" class:is-dragging={!!dragging} class:sheet-open={!!sheetRow}>
  <header class="top">
    <div class="brand">
      <img src="/icon/32.png" alt="" width="20" height="20" />
      <h1>Uzero</h1>
    </div>
    <div class="tools">
      <button
        type="button"
        class="icon-btn"
        class:spin={busy}
        aria-label="Refresh accounts"
        title="Refresh accounts"
        onclick={refresh}
        disabled={busy}
      >
        <Icon name="refresh" size={20} />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Settings"
        title="Settings"
        onclick={() => openOptions()}
      >
        <Icon name="settings" size={20} />
      </button>
    </div>
  </header>

  {#if fatal && !app}
    <div class="state">
      <h2>Couldn’t load your accounts</h2>
      <p>{fatal}</p>
      <button type="button" class="btn btn-filled" onclick={refresh} disabled={busy}>
        Try again
      </button>
    </div>
  {:else if !app || (rows.length === 0 && busy)}
    <div class="card list skeleton-list" aria-busy="true" aria-label="Loading accounts">
      {#each [0, 1, 2] as i (i)}
        <div class="row skeleton">
          <span class="bone av"></span>
          <span class="lines"><span class="bone l1"></span><span class="bone l2"></span></span>
        </div>
      {/each}
    </div>
  {:else if rows.length === 0}
    <div class="state">
      <h2>No Google accounts found</h2>
      <p>Sign in to Google, then open Uzero again.</p>
      <a class="btn btn-filled" href="https://accounts.google.com/" target="_blank" rel="noreferrer">
        Sign in to Google
      </a>
    </div>
  {:else}
    <section class="card pin">
      <div class="pin-text">
        <span class="pin-title" id="pin-title">Pin default account</span>
        <span class="pin-desc" id="pin-desc">
          {#if app.prefs.pinEnabled && first}
            Links without an account open as {first.meta.label ?? first.name}.
          {:else}
            Google picks the account for links.
          {/if}
        </span>
      </div>
      <Toggle
        checked={app.prefs.pinEnabled}
        label="Pin default account"
        describedby="pin-desc"
        onchange={togglePin}
      />
    </section>

    {#if statusError}
      <div class="banner" role="status">
        <span>Couldn’t refresh. {statusError}</span>
        <button type="button" class="btn btn-text" onclick={refresh} disabled={busy}>Retry</button>
      </div>
    {/if}

    <p class="caption" id="row-hint">
      {#if canSwitch}
        Choose an account to reopen this {tabService} tab.
      {:else}
        Open a Google page to switch its account here.
      {/if}
    </p>

    <div class="scroller" bind:this={scroller}>
      <ol class="card list" bind:this={listEl} aria-label="Your account order">
        {#each rows as r (r.email)}
          <li
            class="row-wrap"
            class:dragging={dragging === r.email}
            style:--lift="{dragging === r.email ? lift : 0}px"
            animate:flip={flipFor(r.email)}
            onpointerdown={(e) => onPointerDown(e, r)}
          >
            <div class="row" class:inactive={r.inactive}>
              <button
                type="button"
                class="row-main"
                aria-disabled={!canSwitch || r.inactive}
                aria-describedby={rows.length > 1 ? 'row-hint row-keys' : 'row-hint'}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                onclick={() => switchTo(r)}
                onkeydown={(e) => onRowKey(e, r)}
              >
                <span class="slot" aria-hidden="true">
                  <span class="num">{r.slot}</span>
                  <span class="grip"><Icon name="grip" size={16} /></span>
                </span>
                <span class="sr-only">Number {r.slot}.</span>
                <span class="av">
                  <Avatar
                    name={r.name}
                    email={r.email}
                    photo={r.account?.photo}
                    tone={toneOf(r)}
                    dim={r.inactive}
                  />
                  {#if tab?.email === r.email}
                    <span class="here-dot" title="Open in this tab"></span>
                    <span class="sr-only">Open in this tab.</span>
                  {/if}
                </span>
                <span class="text">
                  <span class="line1">
                    <span class="name">{r.name}</span>
                    {#if r.meta.label}
                      <span class="label"><span class="dot tone-{toneOf(r)}"></span>{r.meta.label}</span>
                    {/if}
                    {#if first?.email === r.email}<span class="default">Default</span>{/if}
                  </span>
                  <span class="line2">
                    <span class="email">{r.email}</span>
                    {#if r.inactive}
                      <span class="extra">· Signed out</span>
                    {:else if r.account && r.account.index !== r.slot - 1}
                      <span class="extra" title="Google lists this account as /u/{r.account.index}"
                        >· Google: {r.account.index + 1}</span
                      >
                    {/if}
                  </span>
                </span>
              </button>
              <button
                type="button"
                class="icon-btn row-menu"
                aria-label="Options for {r.email}"
                aria-haspopup="dialog"
                onclick={() => (sheetFor = r.email)}
              >
                <Icon name="more" size={20} />
              </button>
            </div>
          </li>
        {/each}
      </ol>
      {#if rows.length > 1}
        <p class="keys" id="row-keys">Drag to reorder, or press Alt + ↑ ↓</p>
      {/if}
    </div>

    <footer class="foot">
      {#if reorder}
        <p>
          {#if reorder.expired}
            Reorder paused.{app.prefs.pinEnabled ? ' Pin is back on.' : ''}
          {:else}
            Reorder in progress.
          {/if}
        </p>
        <div class="foot-actions">
          <button type="button" class="btn btn-text" onclick={cancelReorder}>Cancel</button>
          <button type="button" class="btn btn-tonal" onclick={makeItReal}>Resume</button>
        </div>
      {:else}
        <p>
          {#if inSync}
            Google already uses this order.
          {:else}
            Google’s order differs.
          {/if}
        </p>
        <button
          type="button"
          class="btn"
          class:btn-tonal={!inSync}
          class:btn-text={inSync}
          onclick={makeItReal}
          disabled={activeCount === 0}
        >
          Reorder in Google…
        </button>
      {/if}
    </footer>
  {/if}

  <div class="toast" class:show={!!toast} role="status" aria-live="polite">{toast}</div>
  <div class="sr-only" aria-live="assertive">{announce}</div>
</div>

{#if sheetRow}
  <AccountSheet
    row={sheetRow}
    total={rows.length}
    {services}
    onclose={() => (sheetFor = null)}
    onopen={(id) => openService(id, sheetRow.email)}
    onlabel={(label) => setMeta(sheetRow.email, { label })}
    oncolor={(color) => setMeta(sheetRow.email, { color })}
    onmove={(d) => moveBy(sheetRow.email, d)}
  />
{/if}

<style>
  :global(html),
  :global(body) {
    width: 360px;
  }
  :global(body) {
    overflow: hidden;
    background: var(--surface-container);
  }

  .popup {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 360px;
    max-height: 560px;
    min-height: 240px;
    padding-bottom: 8px;
    background: var(--surface-container);
  }
  .sheet-open {
    min-height: 500px;
  }
  .is-dragging {
    cursor: grabbing;
    user-select: none;
  }

  .card {
    background: var(--surface);
    border-radius: var(--r-lg);
  }

  /* Header ------------------------------------------------------------- */
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 8px 4px 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand img {
    display: block;
    border-radius: 4px;
  }
  h1 {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: 400;
    line-height: 24px;
  }
  .tools {
    display: flex;
  }
  .spin :global(svg) {
    animation: spin 900ms linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Pin ---------------------------------------------------------------- */
  .pin {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 4px 8px 0;
    padding: 12px 16px;
  }
  .pin-text {
    flex: 1;
    display: grid;
    min-width: 0;
  }
  .pin-title {
    font-weight: 500;
  }
  .pin-desc {
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
  }

  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 8px 0;
    padding: 4px 4px 4px 16px;
    border-radius: var(--r-lg);
    background: var(--surface-container-high);
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
  }

  .caption {
    margin: 16px 16px 8px;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
  }

  /* List --------------------------------------------------------------- */
  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px;
    scrollbar-width: thin;
  }
  .list {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 4px;
  }
  .row-wrap {
    position: relative;
    transform: translateY(var(--lift));
    touch-action: none;
  }
  .row-wrap.dragging {
    z-index: 2;
  }
  .row-wrap.dragging .row {
    background: var(--surface);
    box-shadow: var(--shadow-menu);
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    height: 56px;
    border-radius: var(--r-md);
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
  }
  .row:hover {
    background: var(--hover);
  }
  .is-dragging .row:hover {
    background: none;
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 100%;
    padding: 0 4px 0 8px;
    border: 0;
    background: none;
    text-align: left;
    border-radius: var(--r-md);
    cursor: pointer;
  }
  .is-dragging .row-main {
    cursor: grabbing;
  }
  .row-main[aria-disabled='true'] {
    cursor: grab;
  }
  .row-main:focus-visible {
    outline-offset: -2px;
  }

  .slot {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 16px;
    height: 24px;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    font-variant-numeric: tabular-nums;
  }
  .num,
  .grip {
    grid-area: 1 / 1;
    display: grid;
    place-items: center;
    transition: opacity var(--dur) var(--ease);
  }
  .grip {
    opacity: 0;
  }
  .row:hover .grip,
  .row:focus-within .grip,
  .dragging .grip {
    opacity: 1;
  }
  .row:hover .num,
  .row:focus-within .num,
  .dragging .num {
    opacity: 0;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .line1,
  .line2 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .line2 {
    gap: 4px;
  }
  .name {
    min-width: 0;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    max-width: 8.5em;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label .dot {
    width: 6px;
    height: 6px;
  }
  .default {
    flex: none;
    margin-left: auto;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
  }
  .email,
  .extra {
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
    white-space: nowrap;
  }
  .email {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .extra {
    flex: none;
  }
  .av {
    position: relative;
    display: inline-flex;
    flex: none;
  }
  .here-dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--primary);
    box-shadow: 0 0 0 2px var(--surface);
  }
  .inactive .name {
    color: var(--on-surface-variant);
    font-weight: 400;
  }
  .row-menu {
    flex: none;
  }

  .keys {
    margin: 8px 8px 0;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
  }

  /* Skeleton ----------------------------------------------------------- */
  .skeleton-list {
    margin: 8px;
  }
  .skeleton {
    gap: 12px;
    padding: 0 12px;
  }
  .bone {
    display: block;
    background: var(--surface-container-high);
    border-radius: 4px;
    animation: pulse 1.6s ease-in-out infinite;
  }
  .bone.av {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }
  .lines {
    display: grid;
    gap: 6px;
    flex: 1;
  }
  .bone.l1 {
    width: 40%;
    height: 10px;
  }
  .bone.l2 {
    width: 64%;
    height: 8px;
  }
  @keyframes pulse {
    50% {
      opacity: 0.5;
    }
  }

  /* States ------------------------------------------------------------- */
  .state {
    display: grid;
    justify-items: center;
    gap: 8px;
    margin: 8px;
    padding: 32px 24px;
    border-radius: var(--r-lg);
    background: var(--surface);
    text-align: center;
  }
  .state h2 {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: 400;
    line-height: 24px;
  }
  .state p {
    margin: 0 0 12px;
    color: var(--on-surface-variant);
    max-width: 30ch;
    text-wrap: balance;
  }

  /* Footer ------------------------------------------------------------- */
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 8px 0 16px;
  }
  .foot p {
    margin: 0;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
  }
  .foot .btn {
    flex: none;
    padding: 0 16px;
  }
  .foot-actions {
    display: flex;
    flex: none;
    gap: 4px;
  }

  .toast {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 64px;
    padding: 14px 16px;
    border-radius: 4px;
    background: var(--inverse-surface);
    color: var(--inverse-on-surface);
    font-size: var(--t-md);
    box-shadow: var(--shadow-menu);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur) var(--ease);
  }
  .toast.show {
    opacity: 1;
  }
</style>
