<script lang="ts">
  import type { LabelColor } from '../lib/types';
  import { initials } from './model';

  let {
    name,
    email,
    photo = '',
    tone,
    size = 34,
    dim = false,
  }: {
    name: string;
    email: string;
    photo?: string;
    tone: LabelColor;
    size?: number;
    dim?: boolean;
  } = $props();

  let failed = $state(false);
  $effect(() => {
    // A new photo URL deserves a fresh attempt.
    photo;
    failed = false;
  });
</script>

<span
  class="avatar tone-{tone}"
  class:dim
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.38)}px"
>
  {#if photo && !failed}
    <img
      src={photo}
      alt=""
      width={size}
      height={size}
      referrerpolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onerror={() => (failed = true)}
    />
  {:else}
    <span aria-hidden="true">{initials(name, email)}</span>
  {/if}
</span>

<style>
  .avatar {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    border-radius: 50%;
    overflow: hidden;
    background: color-mix(in oklab, var(--tone) 22%, var(--sheet-raised));
    color: color-mix(in oklab, var(--tone) 70%, var(--ink));
    font-weight: 650;
    letter-spacing: 0.01em;
    user-select: none;
  }
  .avatar::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ink) 10%, transparent);
    pointer-events: none;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .dim {
    filter: grayscale(1);
    opacity: 0.7;
  }
</style>
