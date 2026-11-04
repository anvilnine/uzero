<script lang="ts">
  import type { LabelColor } from '../lib/types';
  let { text, tone }: { text: string; tone: LabelColor } = $props();
</script>

<span class="chip tone-{tone}">{text}</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 9.5em;
    height: 19px;
    padding: 0 7px 0 6px;
    border-radius: var(--r-sm);
    background: color-mix(in oklab, var(--tone) 15%, transparent);
    color: color-mix(in oklab, var(--tone) 62%, var(--ink));
    font-size: var(--t-xs);
    font-weight: 620;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: none;
  }
  .chip::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tone);
    flex: none;
  }
</style>
