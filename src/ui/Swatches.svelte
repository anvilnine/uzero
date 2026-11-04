<script lang="ts">
  import type { LabelColor } from '../lib/types';
  import { COLOR_NAMES, LABEL_COLORS } from './model';

  let {
    value,
    onchange,
    name,
    legend,
  }: {
    value: LabelColor;
    onchange: (c: LabelColor) => void;
    /** Radio group name, unique per account. */
    name: string;
    legend: string;
  } = $props();

  function onkey(e: KeyboardEvent) {
    const i = LABEL_COLORS.indexOf(value);
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % LABEL_COLORS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (i - 1 + LABEL_COLORS.length) % LABEL_COLORS.length;
    else return;
    e.preventDefault();
    const c = LABEL_COLORS[next]!;
    onchange(c);
    const group = e.currentTarget as HTMLElement;
    queueMicrotask(() => group.querySelector<HTMLElement>(`[data-color="${c}"]`)?.focus());
  }
</script>

<div class="swatches" role="radiogroup" aria-label={legend} tabindex="-1" onkeydown={onkey}>
  {#each LABEL_COLORS as c (c)}
    <button
      type="button"
      role="radio"
      class="sw tone-{c}"
      data-color={c}
      aria-checked={value === c}
      aria-label={COLOR_NAMES[c]}
      title={COLOR_NAMES[c]}
      tabindex={value === c ? 0 : -1}
      name={name}
      onclick={() => onchange(c)}
    ></button>
  {/each}
</div>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .swatches:focus {
    outline: none;
  }
  .sw {
    position: relative;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    display: grid;
    place-items: center;
  }
  .sw::before {
    content: '';
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--tone);
    transition: transform var(--dur) var(--ease);
  }
  .sw:hover::before {
    transform: scale(1.1);
  }
  .sw[aria-checked='true']::after {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--tone);
  }
</style>
