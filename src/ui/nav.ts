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

interface PanelApis {
  sidePanel?: { open(o: { windowId: number }): Promise<void> };
  sidebarAction?: { open(): Promise<void> };
}

/**
 * Open Lineup's side panel (Chrome) or sidebar (Firefox) next to the page.
 * Both need a user gesture, so call it first thing in a click handler, before any await.
 * Returns false when the browser has neither, or no window id is known yet (Chrome).
 */
export function openSidePanel(windowId: number | undefined): boolean {
  const b = ext() as (PanelApis & object) | null;
  try {
    if (b?.sidePanel && windowId !== undefined) {
      b.sidePanel.open({ windowId }).catch(() => {});
      return true;
    }
    if (b?.sidebarAction) {
      b.sidebarAction.open().catch(() => {});
      return true;
    }
  } catch {
    /* no gesture, or not allowed here */
  }
  return false;
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
