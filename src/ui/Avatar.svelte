<script lang="ts">
  import type { LabelColor } from '../lib/types';
  import { initials } from './model';

  let {
    name,
    email,
    photo = '',
    tone,
    size = 32,
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
  style:font-size="{Math.round(size * 0.44)}px"
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
    <span aria-hidden="true">{initials(name, email).slice(0, 1)}</span>
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
    background: color-mix(in srgb, var(--tone) 18%, var(--surface));
    color: color-mix(in srgb, var(--tone) 70%, var(--on-surface));
    font-weight: 500;
    line-height: 1;
    user-select: none;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .dim {
    filter: grayscale(1);
    opacity: 0.6;
  }
</style>
