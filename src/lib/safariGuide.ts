// Safari presentation only. Wizard state and Google navigation remain background-owned.
import { browser, type Browser, type PublicPath } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
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

type Placement = { id: number; left: number; top: number; width: number; height: number; appliedWidth: number };
type Ownership = { version: 1; tabId: number; windowId: number; url: string; incognito: false; reserved?: Placement };
// Session storage survives MV3 worker retirement, never browser-session end. No account data.
const presentationItem = storage.defineItem<unknown>('session:safariGuidePresentation', { fallback: null });
let hydrated = false;
let owned: Ownership | undefined;
let pageTabId: number | undefined;
let reserved: Placement | undefined;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const id = (value: unknown): value is number => integer(value) && value >= 0;
function readOwnership(value: unknown): Ownership | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !id(raw.tabId) || !id(raw.windowId) || raw.incognito !== false || raw.url !== windowUrl()) return undefined;
  let bounds: Placement | undefined;
  if (raw.reserved !== undefined) {
    if (!raw.reserved || typeof raw.reserved !== 'object' || Array.isArray(raw.reserved)) return undefined;
    const r = raw.reserved as Record<string, unknown>;
    if (!id(r.id) || r.id === raw.windowId || !integer(r.left) || !integer(r.top) || !integer(r.width) || !integer(r.height)
      || !integer(r.appliedWidth) || r.width < 960 || r.height <= 0 || r.appliedWidth !== r.width - 360) return undefined;
    bounds = { id: r.id, left: r.left, top: r.top, width: r.width, height: r.height, appliedWidth: r.appliedWidth };
  }
  return { version: 1, tabId: raw.tabId, windowId: raw.windowId, url: raw.url, incognito: false, reserved: bounds };
}
async function hydrate(): Promise<void> {
  if (hydrated) return;
  owned = readOwnership(await presentationItem.getValue());
  pageTabId = owned?.tabId;
  reserved = owned?.reserved;
  hydrated = true;
}
async function persist(): Promise<void> {
  await presentationItem.setValue(owned ? { ...owned, reserved } : null);
}

/** Restore only geometry we still own. A user move/resize takes ownership away from Uzero. */
async function restorePlacement(): Promise<void> {
  const old = reserved; reserved = undefined;
  await persist();
  if (!old) return;
  const win = await browser.windows.get(old.id).catch(() => undefined);
  if (win?.id === old.id && win.incognito === false && win.type === 'normal' && win.left === old.left && win.top === old.top
    && win.width === old.appliedWidth && win.height === old.height) {
    await browser.windows.update(old.id, { width: old.width }).catch(() => undefined);
  }
}
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.catch(() => undefined).then(async () => { await hydrate(); return fn(); });
  tail = run.catch(() => undefined); return run;
}
async function guideTab(w: WizardState | null): Promise<Browser.tabs.Tab | undefined> {
  const tab = await normalTab(pageTabId ?? w?.pageTabId);
  return tab?.url === windowUrl() && (!tab.pendingUrl || tab.pendingUrl === windowUrl())
    && (!owned || tab.windowId === owned.windowId) ? tab : undefined;
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
  owned = undefined;
  await restorePlacement();
}
export function removeSafariGuide(wizard: WizardState | null, closeWindow = true): Promise<void> {
  return serial(async () => { await removeOverlay(wizard); if (closeWindow) await removeWindow(wizard); });
}
/** A removal event has no privacy metadata. Accept only our validated session-owned normal popup.
 * This is presentation cleanup only, never a Google-tab/wizard cancellation event. */
export function safariGuideTabRemoved(tabId: number, windowId: number): Promise<boolean> {
  return serial(async () => {
    if (owned?.tabId !== tabId || owned.windowId !== windowId) return false;
    pageTabId = undefined;
    owned = undefined;
    await restorePlacement();
    return true;
  });
}
/** Reserve side-by-side space inside the normal browser window's existing footprint. */
async function placement(w: WizardState): Promise<{ left: number; top: number; width: number; height: number } | undefined> {
  const tab = await normalTab(w.tabId);
  const id = tab?.windowId ?? (await browser.windows.getAll()).find(win => win.incognito === false && win.type === 'normal')?.id;
  if (id === undefined) return undefined;
  const win = await browser.windows.get(id).catch(() => undefined);
  if (win?.incognito !== false || win.type !== 'normal' || win.left === undefined || win.top === undefined
    || win.width === undefined || win.height === undefined || win.width <= 0 || win.height <= 0) return undefined;
  const width = Math.min(360, win.width);
  const bounds = { left: win.left + win.width - width, top: win.top, width, height: Math.min(640, win.height) };
  // Keep at least 600px for Google's page. Narrow windows retain their geometry; guide may overlap.
  if (win.width >= 960) {
    try {
      await browser.windows.update(id, { width: win.width - width });
      reserved = { id, left: win.left, top: win.top, width: win.width, height: win.height, appliedWidth: win.width - width };
    } catch { /* Placement remains bounded; unsupported resizing is a live parity limitation. */ }
  }
  return bounds;
}

/** Only explicit user entry creates a window. Background ticks never move windows; they may inject an authorized overlay. */
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
    if (tab?.id !== undefined) {
      if (userTriggered) await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
      return tab.id;
    }
    if (!userTriggered) return undefined;
    owned = undefined;
    pageTabId = undefined;
    await restorePlacement();
    const bounds = await placement(wizard).catch(() => undefined);
    let win: Browser.windows.Window | undefined;
    const options = { url: windowUrl(), type: 'popup' as const, incognito: false, width: 360, height: 640, focused: true };
    try { win = await browser.windows.create({ ...options, ...bounds }); }
    catch {
      // Some Safari versions cannot place windows. Retry without coordinates, still a real popup.
      await restorePlacement();
      if (bounds) win = await browser.windows.create(options).catch(() => undefined);
    }
    const created = win?.tabs?.[0];
    if (win?.incognito !== false || !id(win.id) || created?.id === undefined || !id(created.id)) {
      await restorePlacement();
      throw new Error(WINDOW_UNAVAILABLE);
    }
    pageTabId = created.id;
    owned = { version: 1, tabId: pageTabId, windowId: win.id, url: windowUrl(), incognito: false };
    await persist();
    return pageTabId;
  });
}
