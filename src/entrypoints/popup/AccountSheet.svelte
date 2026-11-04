<script lang="ts">
  import { untrack } from 'svelte';
  import type { LabelColor, ServiceInfo } from '../../lib/types';
  import Avatar from '../../ui/Avatar.svelte';
  import Icon from '../../ui/Icon.svelte';
  import Swatches from '../../ui/Swatches.svelte';
  import { LABEL_MAX, toneOf, type Row } from '../../ui/model';
  import { openOptions } from '../../ui/nav';

  let {
    row,
    total,
    services,
    onopen,
    onlabel,
    oncolor,
    onmove,
    onclose,
  }: {
    row: Row;
    total: number;
    services: ServiceInfo[];
    onopen: (serviceId: string) => void;
    onlabel: (label: string) => void;
    oncolor: (c: LabelColor) => void;
    onmove: (delta: -1 | 1) => void;
    onclose: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let label = $state(untrack(() => row.meta.label ?? ''));
  let timer: ReturnType<typeof setTimeout> | undefined;

  // `row` is rebuilt on every state update; only a different account resets what's typed.
  const email = $derived(row.email);
  $effect(() => {
    void email;
    untrack(() => (label = row.meta.label ?? ''));
  });

  $effect(() => {
    dialog.showModal();
    return () => clearTimeout(timer);
  });

  function onInput(e: Event) {
    label = (e.currentTarget as HTMLInputElement).value;
    clearTimeout(timer);
    timer = setTimeout(() => onlabel(label), 350);
  }

  function commit() {
    clearTimeout(timer);
    label = label.trim();
    if (label !== (row.meta.label ?? '')) onlabel(label);
  }

  function close() {
    commit();
    dialog.close();
  }

  const first = $derived(row.name.split(' ')[0] || row.name);
  const shown = $derived(services.slice(0, 9));
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  aria-labelledby="sheet-title"
  onclose={onclose}
  onclick={(e) => {
    if (e.target === dialog) close();
  }}
>
  <div class="inner">
    <span class="handle" aria-hidden="true"></span>
    <header>
      <Avatar
        name={row.name}
        email={row.email}
        photo={row.account?.photo}
        tone={toneOf(row)}
        size={40}
        dim={row.inactive}
      />
      <div class="who">
        <h2 id="sheet-title">{row.name}</h2>
        <p>{row.email}</p>
      </div>
      <button type="button" class="icon-btn" aria-label="Close" onclick={close}>
        <Icon name="close" />
      </button>
    </header>

    {#if row.inactive}
      <p class="note">
        Signed out. Sign in again at accounts.google.com to open apps as this account.
      </p>
    {:else if shown.length}
      <section aria-labelledby="open-h">
        <h3 id="open-h">Open as {first}</h3>
        <div class="apps">
          {#each shown as s (s.id)}
            <button type="button" class="app" onclick={() => onopen(s.id)}>{s.name}</button>
          {/each}
        </div>
      </section>
    {/if}

    <section aria-labelledby="label-h">
      <h3 id="label-h">Label</h3>
      <input
        class="field"
        type="text"
        value={label}
        maxlength={LABEL_MAX}
        placeholder="Work, School, Shop…"
        aria-labelledby="label-h"
        oninput={onInput}
        onchange={commit}
        onkeydown={(e) => {
          if (e.key === 'Enter') close();
        }}
      />
      <Swatches
        value={toneOf(row)}
        onchange={oncolor}
        name="color-{row.email}"
        legend="Label color"
      />
    </section>

    <footer>
      <div class="moves">
        <button
          type="button"
          class="btn btn-text"
          disabled={row.slot === 1}
          onclick={() => onmove(-1)}
        >
          Move up
        </button>
        <button
          type="button"
          class="btn btn-text"
          disabled={row.slot === total}
          onclick={() => onmove(1)}
        >
          Move down
        </button>
      </div>
      <button type="button" class="btn btn-text" onclick={() => openOptions()}>
        Settings
      </button>
    </footer>
  </div>
</dialog>

<style>
  .sheet {
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-width: 100%;
    max-height: calc(100% - 32px);
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    background: var(--surface-container-low);
    color: var(--on-surface);
    box-shadow: var(--shadow-menu);
    overflow: auto;
    animation: rise 200ms var(--ease);
  }
  .sheet::backdrop {
    background: rgb(0 0 0 / 0.32);
    animation: fade 200ms var(--ease);
  }
  @keyframes rise {
    from {
      transform: translateY(16px);
      opacity: 0;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .inner {
    padding: 8px 16px 8px;
    display: grid;
    gap: 16px;
  }
  .handle {
    justify-self: center;
    width: 32px;
    height: 4px;
    border-radius: 2px;
    background: var(--outline-variant);
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-right: -8px;
  }
  .who {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: 400;
    line-height: 24px;
  }
  .who p {
    margin: 0;
    color: var(--on-surface-variant);
    font-size: var(--t-sm);
    line-height: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  section {
    display: grid;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font-size: var(--t-md);
    font-weight: 500;
  }
  .apps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .app {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--outline-variant);
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--on-surface-variant);
    font-size: var(--t-md);
    font-weight: 500;
    white-space: nowrap;
    transition: background-color var(--dur) var(--ease);
  }
  .app:hover {
    background: var(--hover);
  }
  .note {
    margin: 0;
    color: var(--on-surface-variant);
  }
  footer {
    display: flex;
    justify-content: space-between;
    border-top: 1px solid var(--outline-variant);
    padding-top: 8px;
    margin: 0 -8px;
  }
  .moves {
    display: flex;
  }
</style>
