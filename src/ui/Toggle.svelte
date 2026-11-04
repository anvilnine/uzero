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
  <span class="knob"></span>
</button>

<style>
  .switch {
    position: relative;
    flex: none;
    width: 40px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--line-strong);
    transition: background var(--dur) var(--ease);
  }
  /* Bigger hit area without a bigger switch */
  .switch::before {
    content: '';
    position: absolute;
    inset: -10px -4px;
  }
  .switch[aria-checked='true'] {
    background: var(--toggle-on);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--sheet-raised);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
    transition: transform var(--dur) var(--ease), background var(--dur) var(--ease);
  }
  .switch[aria-checked='true'] .knob {
    transform: translateX(16px);
    background: var(--jersey);
  }
  .switch:disabled {
    opacity: 0.5;
  }
</style>
