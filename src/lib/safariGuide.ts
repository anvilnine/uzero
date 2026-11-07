// Safari presentation only. Wizard state and Google navigation remain background-owned.
import { browser, type Browser, type PublicPath } from 'wxt/browser';
import type { SafariGuideMode, WizardState } from './types';
import { inProgress, lastActivity, WIZARD_TTL_MS } from './wizard';

export const GUIDE_AUTHORIZE = 'safariGuideAuthorize';
export const GUIDE_REMOVE = 'safariGuideRemove';
export const overlayUrl = () => browser.runtime.getURL('/reorder.html') + '?guide=overlay';
const windowUrl = () => browser.runtime.getURL('/reorder.html') + '?guide=window';
const WINDOW_UNAVAILABLE = 'Safari could not open a guide window. Open Uzero options and choose Sign-in overlay, then reopen the reorder.';

export function guideRunning(w: WizardState | null): boolean {
  return !!w && inProgress(w) && w.errorKind !== 'expired' && w.errorKind !== 'tab-closed'
    && Date.now() - lastActivity(w) < WIZARD_TTL_MS;
}
export function isAccountsPage(url: string | undefined): boolean {
  try { return !!url && new URL(url).origin === 'https://accounts.google.com'; } catch { return false; }
}
async function normalTab(id: number | undefined): Promise<Browser.tabs.Tab | undefined> {
  if (id === undefined) return undefined;
  const tab = await browser.tabs.get(id).catch(() => undefined);
  return tab?.id === id && tab.incognito === false ? tab : undefined;
}

/** Boolean only. Content scripts never receive account data or general API access. */
export async function authorizeSafariGuide(sender: Browser.runtime.MessageSender, mode: SafariGuideMode, wizard: WizardState | null): Promise<boolean> {
  if (mode !== 'overlay' || !guideRunning(wizard) || sender.id !== browser.runtime.id
    || sender.tab?.incognito !== false || sender.tab.id !== wizard?.tabId || !isAccountsPage(sender.tab.url)) return false;
  const top = sender.frameId === 0 && isAccountsPage(sender.url);
  const frame = typeof sender.frameId === 'number' && sender.frameId > 0 && sender.url === overlayUrl();
  if (!top && !frame) return false;
  const tab = await normalTab(wizard!.tabId);
  return !!tab && isAccountsPage(tab.url) && (!tab.pendingUrl || isAccountsPage(tab.pendingUrl));
}

let pageTabId: number | undefined;
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn); tail = run.catch(() => undefined); return run;
}
async function guideTab(w: WizardState | null): Promise<Browser.tabs.Tab | undefined> {
  const tab = await normalTab(pageTabId ?? w?.pageTabId);
  return tab?.url === windowUrl() ? tab : undefined;
}
async function removeOverlay(w: WizardState | null): Promise<void> {
  const tab = await normalTab(w?.tabId);
  if (tab?.id !== undefined && isAccountsPage(tab.url)) {
    await browser.tabs.sendMessage(tab.id, { type: GUIDE_REMOVE }, { frameId: 0 }).catch(() => undefined);
  }
}
async function removeWindow(w: WizardState | null): Promise<void> {
  const tab = await guideTab(w);
  if (tab?.id !== undefined) await browser.tabs.remove(tab.id).catch(() => undefined);
  pageTabId = undefined;
}
export function removeSafariGuide(wizard: WizardState | null, closeWindow = true): Promise<void> {
  return serial(async () => { await removeOverlay(wizard); if (closeWindow) await removeWindow(wizard); });
}
async function placement(w: WizardState): Promise<{ left: number; top: number } | undefined> {
  const tab = await normalTab(w.tabId);
  // Confirmation has no Google tab yet. A normal window is sufficient for initial placement.
  const id = tab?.windowId ?? (await browser.windows.getAll()).find(win => win.incognito === false && win.type === 'normal')?.id;
  if (id === undefined) return undefined;
  const win = await browser.windows.get(id).catch(() => undefined);
  if (win?.incognito !== false || win.type !== 'normal' || win.left === undefined || win.top === undefined || win.width === undefined) return undefined;
  return { left: win.left + win.width, top: win.top };
}

/** Only explicit user entry creates a window. Background ticks may position it or inject an authorized overlay. */
export function showSafariGuide(mode: SafariGuideMode, wizard: WizardState | null, userTriggered = false): Promise<number | undefined> {
  return serial(async () => {
    if (!wizard) return undefined;
    if (mode === 'overlay') {
      await removeWindow(wizard);
      if (!guideRunning(wizard)) { await removeOverlay(wizard); return undefined; }
      const tab = await normalTab(wizard.tabId);
      if (tab?.id !== undefined && isAccountsPage(tab.url) && (!tab.pendingUrl || isAccountsPage(tab.pendingUrl))) {
        await browser.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['/content-scripts/safari-guide.js' as Extract<PublicPath, `${string}.js`>] });
      }
      return undefined;
    }
    await removeOverlay(wizard);
    const tab = await guideTab(wizard);
    const bounds = await placement(wizard).catch(() => undefined);
    if (tab?.id !== undefined) {
      if (bounds || userTriggered) await browser.windows.update(tab.windowId, { ...bounds, ...(userTriggered ? { focused: true } : {}) }).catch(() => undefined);
      return tab.id;
    }
    if (!userTriggered) return undefined;
    let win: Browser.windows.Window | undefined;
    const options = { url: windowUrl(), type: 'popup' as const, incognito: false, width: 360, height: 640, focused: true };
    try { win = await browser.windows.create({ ...options, ...bounds }); }
    catch {
      // Some Safari versions cannot place windows. Retry without coordinates, still a real popup.
      if (bounds) win = await browser.windows.create(options).catch(() => undefined);
    }
    const created = win?.tabs?.[0];
    if (win?.incognito !== false || created?.id === undefined) throw new Error(WINDOW_UNAVAILABLE);
    pageTabId = created.id;
    return pageTabId;
  });
}
