<script lang="ts">
  /** Quiet links to the website and legal pages. Sits at the bottom of every Uzero page. */
  let { align = 'center' }: { align?: 'center' | 'start' } = $props();
  const links = [
    { href: 'https://uzero.app/', label: 'uzero.app' },
    { href: 'https://uzero.app/privacy/', label: 'Privacy' },
    { href: 'https://uzero.app/terms/', label: 'Terms' },
  ];
</script>

<nav class="site-links" class:start={align === 'start'} aria-label="About Uzero">
  {#each links as l, i (l.href)}
    {#if i > 0}<span aria-hidden="true">·</span>{/if}
    <a href={l.href} target="_blank" rel="noreferrer">{l.label}</a>
  {/each}
</nav>

<style>
  .site-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 6px;
    padding: 12px 16px;
    color: var(--on-surface-variant);
    font-size: 12px;
    line-height: 16px;
  }
  .site-links.start {
    justify-content: flex-start;
  }
  a {
    color: inherit;
    text-decoration: none;
    border-radius: 4px;
  }
  a:hover {
    color: var(--on-surface);
    text-decoration: underline;
  }
  a:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  span {
    opacity: 0.6;
  }
</style>
