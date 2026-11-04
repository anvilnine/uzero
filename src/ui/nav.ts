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

export interface PanelApis {
  sidePanel?: { open(o: { windowId: number }): Promise<void> };
  sidebarAction?: { open(): Promise<void>; close?(): Promise<void> };
}

/**
 * Open Lineup's side panel (Chrome) or sidebar (Firefox) next to the page.
 * Both need a user gesture, so call it first thing in a click handler, before any await:
 * the browser call happens right away, and the promise only reports how it went.
 * Resolves false when the browser has neither, no window id is known yet (Chrome), or it refused.
 */
export function openSidePanel(windowId: number | undefined): Promise<boolean> {
  return openPanelVia(ext() as PanelApis | null, windowId);
}

/** openSidePanel with the browser APIs passed in (tests). */
export function openPanelVia(b: PanelApis | null, windowId: number | undefined): Promise<boolean> {
  try {
    let opening: Promise<void> | undefined;
    if (b?.sidePanel && windowId !== undefined) opening = b.sidePanel.open({ windowId });
    else if (b?.sidebarAction) opening = b.sidebarAction.open();
    if (opening) return opening.then(() => true, () => false);
  } catch {
    /* no gesture, or not allowed here */
  }
  return Promise.resolve(false);
}

export function closeView(): void {
  window.close();
}

/** Close the side panel. Firefox ignores window.close() in a sidebar, so use its own API there. */
export function closePanel(): void {
  const b = ext() as PanelApis | null;
  const close = b?.sidebarAction?.close;
  if (!close) {
    window.close();
    return;
  }
  close.call(b!.sidebarAction).catch(() => window.close());
}

export const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return m || 'Something went wrong.';
}
