<script lang="ts">
  /** Five tappable stars. `value` is 0 until the user picks one. */
  let { value = 0, label = 'Rating', onpick }: { value?: number; label?: string; onpick: (n: number) => void } = $props();
  let hover = $state(0);
</script>

<div class="stars" role="radiogroup" aria-label={label}>
  {#each [1, 2, 3, 4, 5] as n (n)}
    <button
      type="button"
      role="radio"
      aria-checked={value === n}
      aria-label={`${n} of 5`}
      class:on={(hover || value) >= n}
      onmouseenter={() => (hover = n)}
      onmouseleave={() => (hover = 0)}
      onfocus={() => (hover = n)}
      onblur={() => (hover = 0)}
      onclick={() => onpick(n)}>★</button
    >
  {/each}
</div>

<style>
  .stars {
    display: flex;
    gap: 4px;
  }
  button {
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--outline-variant);
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    transition: color 120ms ease, transform 120ms ease;
  }
  button.on {
    color: var(--primary);
  }
  button:hover {
    transform: scale(1.08);
  }
  button:focus-visible {
    outline: 2px solid var(--primary);
  }
</style>
