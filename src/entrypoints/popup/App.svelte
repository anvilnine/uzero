<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { getApi, type Api } from '../../lib/api';
  import { pinEmail } from '../../lib/accounts';
  import type { AppState, LabelColor, ServiceInfo } from '../../lib/types';
  import Avatar from '../../ui/Avatar.svelte';
  import Chip from '../../ui/Chip.svelte';
  import Icon from '../../ui/Icon.svelte';
  import Mark from '../../ui/Mark.svelte';
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
  import { closeView, errorText, openOptions, reducedMotion } from '../../ui/nav';

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

  const rows = $derived(app ? lineup(app) : []);
  // Same rule as the pin redirects: the first signed-in account in your order.
  const first = $derived.by(() => {
    const email = app ? pinEmail(app.prefs, app.accounts) : undefined;
    return rows.find((r) => r.email === email);
  });
  // A reorder that was started and not finished: offer to resume it instead of starting another.
  const reorder = $derived.by(() => {
    const w = app?.wizard;
    if (!w || (w.phase !== 'signing-out' && w.phase !== 'signing-in' && w.phase !== 'error')) return null;
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
    try {
      // While a reorder runs, the background keeps it and just brings its page back.
      const queue = reorder?.queue ?? rows.filter((r) => !r.inactive).map((r) => r.email);
      await api.send({ type: 'wizardOpen', queue });
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
      <Mark size={22} />
      <h1>Lineup</h1>
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
        <Icon name="refresh" size={18} />
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Settings"
        title="Settings"
        onclick={() => openOptions()}
      >
        <Icon name="settings" size={18} />
      </button>
    </div>
  </header>

  {#if fatal && !app}
    <div class="state">
      <span class="state-icon danger"><Icon name="alert" size={22} /></span>
      <h2>Couldn’t load your accounts</h2>
      <p>{fatal}</p>
      <button type="button" class="btn btn-primary" onclick={refresh} disabled={busy}>
        Try again
      </button>
    </div>
  {:else if !app || (rows.length === 0 && busy)}
    <div class="sheet-list" aria-busy="true" aria-label="Loading accounts">
      {#each [0, 1, 2] as i (i)}
        <div class="row skeleton" style:--d="{i * 90}ms">
          <span class="bone num"></span>
          <span class="bone av"></span>
          <span class="lines"><span class="bone l1"></span><span class="bone l2"></span></span>
        </div>
      {/each}
    </div>
  {:else if rows.length === 0}
    <div class="state">
      <span class="state-icon"><Mark size={36} /></span>
      <h2>No Google accounts found</h2>
      <p>Sign in at google.com, then reopen Lineup.</p>
      <a class="btn btn-primary" href="https://accounts.google.com/" target="_blank" rel="noreferrer">
        Sign in to Google
      </a>
    </div>
  {:else}
    <section class="pin" class:on={app.prefs.pinEnabled}>
      <div class="pin-text">
        <span class="pin-title" id="pin-title">Pin your #1</span>
        <span class="pin-desc" id="pin-desc">
          {#if app.prefs.pinEnabled && first}
            Links that name no account open as {first.meta.label ?? first.name}.
          {:else}
            Google picks the account for links.
          {/if}
        </span>
      </div>
      <Toggle
        checked={app.prefs.pinEnabled}
        label="Pin your #1"
        describedby="pin-desc"
        onchange={togglePin}
      />
    </section>

    {#if statusError}
      <div class="banner" role="status">
        <span>Couldn’t refresh. {statusError}</span>
        <button type="button" class="link" onclick={refresh} disabled={busy}>Retry</button>
      </div>
    {/if}

    <p class="caption" id="row-hint">
      {#if canSwitch}
        Pick an account to reopen this {tabService} tab.
      {:else}
        Open a Google page to switch accounts here.
      {/if}
    </p>

    <div class="scroller" bind:this={scroller}>
      <ol class="sheet-list" bind:this={listEl} aria-label="Your account order">
        {#each rows as r (r.email)}
          <li
            class="row-wrap"
            class:dragging={dragging === r.email}
            style:--lift="{dragging === r.email ? lift : 0}px"
            animate:flip={flipFor(r.email)}
            onpointerdown={(e) => onPointerDown(e, r)}
          >
            <div class="row" class:inactive={r.inactive} class:here={tab?.email === r.email}>
              <button
                type="button"
                class="row-main"
                aria-disabled={!canSwitch || r.inactive}
                aria-describedby="row-hint row-keys"
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                onclick={() => switchTo(r)}
                onkeydown={(e) => onRowKey(e, r)}
              >
                <span class="slot figure" class:lead={r.slot === 1} aria-hidden="true">
                  {r.slot}
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
                    {#if r.meta.label}<Chip text={r.meta.label} tone={toneOf(r)} />{/if}
                  </span>
                  <span class="line2">
                    <span class="email">{r.email}</span>
                    {#if r.inactive}
                      <span class="tag">Signed out</span>
                    {:else if r.account && r.account.index !== r.slot - 1}
                      <span
                        class="tag"
                        title="Google lists this account as /u/{r.account.index}"
                      >Google #{r.account.index + 1}</span>
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
                <Icon name="more" size={18} />
              </button>
            </div>
          </li>
        {/each}
      </ol>
      {#if rows.length > 1}
        <p class="keys" id="row-keys">Drag to reorder, or focus one and press Alt + ↑ ↓</p>
      {/if}
    </div>

    <footer class="foot">
      {#if reorder}
        <p>
          {#if reorder.expired}
            Reorder paused. Pin is back on.
          {:else}
            Reorder in progress.
          {/if}
        </p>
        <div class="foot-actions">
          <button type="button" class="btn btn-quiet" onclick={cancelReorder}>Cancel</button>
          <button type="button" class="btn btn-primary real" onclick={makeItReal}>
            <Icon name="sync" size={18} />
            Resume
          </button>
        </div>
      {:else}
        <p>
          {#if inSync}
            Google already uses this order.
          {:else}
            Google’s own order is different.
          {/if}
        </p>
        <button
          type="button"
          class="btn real"
          class:btn-primary={!inSync}
          onclick={makeItReal}
          disabled={activeCount === 0}
        >
          <Icon name="sync" size={18} />
          Make it real
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
  }

  .popup {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 360px;
    max-height: 560px;
    min-height: 240px;
    background: var(--paper);
  }
  .sheet-open {
    min-height: 500px;
  }
  .is-dragging {
    cursor: grabbing;
    user-select: none;
  }

  /* Header ------------------------------------------------------------- */
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 6px 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-figure);
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.01em;
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
    gap: 12px;
    margin: 4px 12px 0;
    padding: 10px 14px;
    border-radius: var(--r-lg);
    background: var(--sunk);
    transition: background var(--dur) var(--ease);
  }
  .pin.on {
    background: var(--jersey-soft);
  }
  .pin-text {
    flex: 1;
    display: grid;
    min-width: 0;
  }
  .pin-title {
    font-weight: 650;
    font-size: var(--t-md);
  }
  .pin-desc {
    color: var(--ink-2);
    font-size: var(--t-sm);


    text-wrap: pretty;
  }
  .pin.on .pin-desc {
    color: color-mix(in oklab, var(--jersey-ink) 70%, var(--ink-2));
  }
  @media (prefers-color-scheme: dark) {
    .pin.on .pin-desc {
      color: var(--ink-2);
    }
  }

  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 12px 0;
    padding: 8px 12px;
    border-radius: var(--r-md);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--t-sm);
  }
  .link {
    border: 0;
    background: none;
    padding: 4px;
    font-weight: 650;
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .caption {
    margin: 14px 16px 6px;
    color: var(--ink-2);
    font-size: var(--t-sm);
  }

  /* List --------------------------------------------------------------- */
  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 12px 4px;
    scrollbar-width: thin;
  }
  .sheet-list {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0;
    border-radius: var(--r-lg);
    background: var(--sheet);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .popup > .sheet-list {
    margin: 12px;
  }
  .row-wrap {
    position: relative;
    transform: translateY(var(--lift));
    touch-action: none;
  }
  .row-wrap + .row-wrap .row::before {
    content: '';
    position: absolute;
    top: 0;
    left: 48px;
    right: 12px;
    border-top: 1px solid var(--line);
  }
  .row-wrap.dragging {
    z-index: 2;
  }
  .row-wrap.dragging .row {
    background: var(--sheet-raised);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-lift);
    transform: scale(1.02);
  }
  .row-wrap.dragging .row::before,
  .row-wrap.dragging + .row-wrap .row::before {
    border-color: transparent;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    height: 62px;
    padding-right: 4px;
    transition: transform 160ms var(--ease), box-shadow 160ms var(--ease);
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 100%;
    padding: 0 4px 0 10px;
    border: 0;
    background: none;
    text-align: left;
    border-radius: var(--r-lg);
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
  .row:not(.inactive):hover .name {
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 3px;
  }
  .row-main[aria-disabled='true'] .name {
    text-decoration: none !important;
  }

  .slot {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    font-size: 17px;
    color: var(--ink-3);
    transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .slot.lead {
    background: var(--jersey);
    color: var(--jersey-ink);
    font-weight: 600;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .line1,
  .line2 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .name {
    font-weight: 620;
    letter-spacing: -0.005em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .email {
    flex: 1;
    min-width: 0;
    color: var(--ink-2);
    font-size: var(--t-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    flex: none;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-3);
    padding: 1px 6px;
    border-radius: var(--r-sm);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .av {
    position: relative;
    display: inline-flex;
    flex: none;
  }
  .here-dot {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 2.5px var(--sheet);
  }
  .inactive .name,
  .inactive .email {
    color: var(--ink-3);
  }
  .inactive .slot {
    opacity: 0.6;
  }
  .row-menu {
    flex: none;
    width: 36px;
    height: 44px;
  }

  .keys {
    margin: 8px 4px 4px;
    color: var(--ink-3);
    font-size: var(--t-xs);
    text-align: center;
  }

  /* Skeleton ----------------------------------------------------------- */
  .skeleton {
    gap: 10px;
    padding: 0 12px;
  }
  .bone {
    display: block;
    background: var(--sunk);
    border-radius: 6px;
    animation: pulse 1.4s ease-in-out infinite;
    animation-delay: var(--d);
  }
  .bone.num {
    width: 26px;
    height: 26px;
    border-radius: 50%;
  }
  .bone.av {
    width: 34px;
    height: 34px;
    border-radius: 50%;
  }
  .lines {
    display: grid;
    gap: 6px;
    flex: 1;
  }
  .bone.l1 {
    width: 46%;
    height: 11px;
  }
  .bone.l2 {
    width: 70%;
    height: 9px;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }

  /* States ------------------------------------------------------------- */
  .state {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 36px 32px 40px;
    text-align: center;
  }
  .state h2 {
    margin: 8px 0 0;
    font-family: var(--font-figure);
    font-size: var(--t-xl);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .state p {
    text-wrap: balance;
    margin: 0 0 14px;
    color: var(--ink-2);
    max-width: 30ch;
  }
  .state .btn {
    text-decoration: none;
  }
  .state-icon {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--sunk);
  }
  .state-icon.danger {
    background: var(--danger-soft);
    color: var(--danger);
  }

  /* Footer ------------------------------------------------------------- */
  .foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px 12px 16px;
    border-top: 1px solid var(--line);
    margin-top: 6px;
  }
  .foot {
    justify-content: space-between;
  }
  .foot p {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--t-sm);
    line-height: 1.35;
  }
  .real {
    flex: none;
    min-height: 40px;
  }
  .foot-actions {
    display: flex;
    flex: none;
    gap: 6px;
  }
  .foot-actions .btn {
    min-height: 40px;
  }

  .toast {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 70px;
    padding: 10px 14px;
    border-radius: var(--r-md);
    background: var(--action);
    color: var(--on-action);
    font-size: var(--t-sm);
    box-shadow: var(--shadow-pop);
    opacity: 0;
    transform: translateY(6px);
    pointer-events: none;
    transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .toast.show {
    opacity: 1;
    transform: none;
  }
</style>
