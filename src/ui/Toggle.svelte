<script lang="ts">
  let {
    checked,
    label,
    onchange,
    disabled = false,
    describedby,
  }: {
    checked: boolean;
    label: string;
    onchange: (next: boolean) => void;
    disabled?: boolean;
    describedby?: string;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  class="switch"
  aria-checked={checked}
  aria-label={label}
  aria-describedby={describedby}
  {disabled}
  onclick={() => onchange(!checked)}
>
  <span class="handle"></span>
</button>

<style>
  /* Material 3 switch: 52 x 32 track, handle grows when on. */
  .switch {
    position: relative;
    flex: none;
    width: 52px;
    height: 32px;
    padding: 0;
    border: 2px solid var(--outline);
    border-radius: 16px;
    background: var(--surface-container-highest);
    transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease);
  }
  .switch::before {
    content: '';
    position: absolute;
    inset: -6px -2px;
  }
  .switch[aria-checked='true'] {
    border-color: var(--primary);
    background: var(--primary);
  }
  .handle {
    position: absolute;
    top: 50%;
    left: 6px;
    width: 16px;
    height: 16px;
    margin-top: -8px;
    border-radius: 50%;
    background: var(--outline);
    transition:
      transform var(--dur) var(--ease),
      width var(--dur) var(--ease),
      height var(--dur) var(--ease),
      margin var(--dur) var(--ease),
      background-color var(--dur) var(--ease);
  }
  .switch[aria-checked='true'] .handle {
    width: 24px;
    height: 24px;
    margin-top: -12px;
    transform: translateX(16px);
    background: var(--on-primary);
  }
  .switch:disabled {
    opacity: 0.38;
  }
</style>
