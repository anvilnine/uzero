<script lang="ts">
  // The Lineup mark: accounts in running order, #1 in jersey yellow.
  let { size = 24 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="4 4 120 120" aria-hidden="true" focusable="false">
  <rect x="4" y="4" width="120" height="120" rx="30" fill="#1f4337" />
  <circle cx="37" cy="38" r="11" fill="#f2c230" />
  <rect x="55" y="32" width="46" height="12" rx="6" fill="#f2c230" />
  <circle cx="37" cy="64" r="11" fill="#e7efe9" fill-opacity=".9" />
  <rect x="55" y="58" width="34" height="12" rx="6" fill="#e7efe9" fill-opacity=".9" />
  <circle cx="37" cy="90" r="11" fill="#e7efe9" fill-opacity=".45" />
  <rect x="55" y="84" width="24" height="12" rx="6" fill="#e7efe9" fill-opacity=".45" />
</svg>
