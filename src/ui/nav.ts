// Small navigation helpers that also work in the plain-browser design preview.

function ext(): typeof browser | null {
  return typeof browser !== 'undefined' && browser.runtime?.id ? browser : null;
}

export function openOptions(hash = ''): void {
  const b = ext();
  if (b && !hash) {
    void b.runtime.openOptionsPage();
    return;
  }
  const url = b ? b.runtime.getURL(`/options.html${hash}` as '/options.html') : `options.html${hash}`;
  window.open(url, '_blank', 'noopener');
}

export function closeView(): void {
  window.close();
}

export const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return m || 'Something went wrong.';
}
