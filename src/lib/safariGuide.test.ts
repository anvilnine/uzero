import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { WizardState } from './types';

let guide: typeof import('./safariGuide');
const active = (): WizardState => ({ phase: 'signing-in', queue: ['a@example.com'], current: 0, completed: [], startedAt: Date.now(), tabId: 10 });
const normal = { id: 10, windowId: 1, incognito: false, url: 'https://accounts.google.com/signin', status: 'complete' };
const own = { id: 'test-extension-id', frameId: 0, url: normal.url, tab: normal };
beforeEach(async () => {
  vi.resetModules(); fakeBrowser.reset();
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
  vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(normal as any);
  vi.spyOn(fakeBrowser.windows, 'get').mockResolvedValue({ id: 1, incognito: false, type: 'normal', left: 100, top: 50, width: 1000, height: 800 } as any);
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([{ id: 1, incognito: false, type: 'normal' }] as any);
  vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as any);
  guide = await import('./safariGuide');
});
afterEach(() => vi.restoreAllMocks());
it('authorizes only current normal accounts top frame and exact extension overlay frame', async () => {
  expect(await guide.authorizeSafariGuide(own as any, 'overlay', active())).toBe(true);
  const frame = { ...own, frameId: 2, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=overlay' };
  expect(await guide.authorizeSafariGuide(frame as any, 'overlay', active())).toBe(true);
  for (const sender of [{ ...own, id: 'other' }, { ...own, frameId: 2 }, { ...own, url: 'https://evil.com/' }, { ...own, tab: { ...normal, id: 11 } }, { ...own, tab: { ...normal, incognito: true } }, { ...own, tab: { ...normal, incognito: undefined } }, { ...frame, url: fakeBrowser.runtime.getURL('/options.html') }]) {
    expect(await guide.authorizeSafariGuide(sender as any, 'overlay', active())).toBe(false);
  }
});
it('rejects stale/private/navigated current tabs, inactive phases, expired state and window mode', async () => {
  for (const tab of [{ ...normal, incognito: true }, { ...normal, incognito: undefined }, { ...normal, url: 'https://example.com/' }]) {
    vi.mocked(fakeBrowser.tabs.get).mockResolvedValue(tab as any);
    expect(await guide.authorizeSafariGuide(own as any, 'overlay', active())).toBe(false);
  }
  vi.mocked(fakeBrowser.tabs.get).mockResolvedValue(normal as any);
  for (const wizard of [null, { ...active(), phase: 'confirm' }, { ...active(), phase: 'done' }, { ...active(), phase: 'error', errorKind: 'expired' }, { ...active(), startedAt: Date.now() - 31 * 60_000 }]) {
    expect(await guide.authorizeSafariGuide(own as any, 'overlay', wizard as any)).toBe(false);
  }
  expect(await guide.authorizeSafariGuide(own as any, 'window', active())).toBe(false);
});
it('opens a deduplicated normal popup only on user launch, positioned beside normal Google window', async () => {
  const create = vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 2, incognito: false, tabs: [{ id: 20 }] } as any);
  vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as any);
  const confirm = { ...active(), phase: 'confirm' as const };
  await guide.showSafariGuide('window', confirm);
  expect(create).not.toHaveBeenCalled();
  expect(await guide.showSafariGuide('window', confirm, true)).toBe(20);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'popup', incognito: false, width: 360, left: 740, top: 50 }));
  vi.mocked(fakeBrowser.tabs.get).mockImplementation(async (id) => id === 20 ? { id: 20, windowId: 2, incognito: false, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window' } as any : normal as any);
  expect(await guide.showSafariGuide('window', confirm, true)).toBe(20);
  expect(create).toHaveBeenCalledTimes(1);
});
it('discloses unsupported popup APIs instead of silently opening a tab', async () => {
  vi.spyOn(fakeBrowser.windows, 'create').mockRejectedValue(new Error('unsupported'));
  const tabs = vi.spyOn(fakeBrowser.tabs, 'create');
  await expect(guide.showSafariGuide('window', active(), true)).rejects.toThrow(/choose.*overlay/i);
  expect(tabs).not.toHaveBeenCalled();
});
it('injects only in the verified current accounts tab and removes the overlay on teardown', async () => {
  const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue(undefined as never);
  const remove = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
  await guide.showSafariGuide('overlay', active());
  expect(inject).toHaveBeenCalledWith({ target: { tabId: 10, frameIds: [0] }, files: ['/content-scripts/safari-guide.js'] });
  await guide.removeSafariGuide(active());
  expect(remove).toHaveBeenCalledWith(10, { type: 'safariGuideRemove' }, { frameId: 0 });
  inject.mockClear();
  vi.mocked(fakeBrowser.tabs.get).mockResolvedValue({ ...normal, incognito: true } as any);
  await guide.showSafariGuide('overlay', active());
  expect(inject).not.toHaveBeenCalled();
});
it('cleanup never closes an unrelated page reused from a guide tab', async () => {
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove');
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
  await guide.removeSafariGuide({ ...active(), pageTabId: 20 });
  expect(remove).not.toHaveBeenCalled();
});
it('retries unsupported placement without coordinates, retaining an explicitly normal popup', async () => {
  const create = vi.spyOn(fakeBrowser.windows, 'create').mockRejectedValueOnce(new Error('placement unsupported')).mockResolvedValueOnce({ id: 2, incognito: false, tabs: [{ id: 20 }] } as any);
  expect(await guide.showSafariGuide('window', active(), true)).toBe(20);
  expect(create.mock.calls[1]?.[0]).toMatchObject({ type: 'popup', incognito: false });
  expect(create.mock.calls[1]?.[0]).not.toHaveProperty('left');
});
it('closes only the owned guide page on completion/cancel cleanup', async () => {
  vi.mocked(fakeBrowser.tabs.get).mockImplementation(async id => id === 20 ? { id: 20, incognito: false, windowId: 2, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window' } as any : normal as any);
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  await guide.removeSafariGuide({ ...active(), pageTabId: 20 });
  expect(remove).toHaveBeenCalledWith(20);
  expect(remove).not.toHaveBeenCalledWith(10);
});
it('never mounts overlay during confirmation or after completion/expiry', async () => {
  const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue(undefined as never);
  for (const w of [{ ...active(), phase: 'confirm' }, { ...active(), phase: 'done' }, { ...active(), phase: 'error', errorKind: 'expired' }]) await guide.showSafariGuide('overlay', w as any, true);
  expect(inject).not.toHaveBeenCalled();
});
it('removes the old overlay without closing the guide window when Google moves to a replacement tab', async () => {
  vi.mocked(fakeBrowser.tabs.get).mockImplementation(async id => id === 20 ? { id: 20, incognito: false, windowId: 2, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window' } as any : normal as any);
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  await guide.removeSafariGuide({ ...active(), pageTabId: 20 }, false);
  expect(remove).not.toHaveBeenCalled();
  expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(10, { type: 'safariGuideRemove' }, { frameId: 0 });
});

it('reserves adjacent space only on explicit launch and restores untouched source geometry', async () => {
  const source = { id: 1, incognito: false, type: 'normal', left: 100, top: 50, width: 1000, height: 800 };
  vi.mocked(fakeBrowser.windows.get).mockImplementation(async () => ({ ...source }) as any);
  const update = vi.mocked(fakeBrowser.windows.update).mockImplementation(async (_id, patch) => { Object.assign(source, patch); return { ...source } as any; });
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 2, incognito: false, tabs: [{ id: 20 }] } as any);
  await guide.showSafariGuide('window', active());
  expect(update).not.toHaveBeenCalled();
  await guide.showSafariGuide('window', active(), true);
  expect(update).toHaveBeenCalledWith(1, { width: 640 });
  expect(source.width).toBe(640);
  vi.mocked(fakeBrowser.tabs.get).mockImplementation(async id => id === 20 ? { id: 20, incognito: false, windowId: 2, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window' } as any : normal as any);
  vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  update.mockClear();
  await guide.showSafariGuide('window', active());
  expect(update).not.toHaveBeenCalled();
  await guide.removeSafariGuide({ ...active(), pageTabId: 20 });
  expect(update).toHaveBeenCalledWith(1, { width: 1000 });
});
it('does not restore geometry after the user moves or resizes the source window', async () => {
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 2, incognito: false, tabs: [{ id: 20 }] } as any);
  await guide.showSafariGuide('window', active(), true);
  vi.mocked(fakeBrowser.windows.get).mockResolvedValue({ id: 1, incognito: false, type: 'normal', left: 120, top: 50, width: 700, height: 800 } as any);
  vi.mocked(fakeBrowser.windows.update).mockClear();
  await guide.removeSafariGuide(active());
  expect(fakeBrowser.windows.update).not.toHaveBeenCalled();
});

it.each(['native', 'remove', 'deduplicate'])('hydrates session-owned guide before %s after worker retirement', async action => {
  const source = { id: 1, incognito: false, type: 'normal', left: 100, top: 50, width: 1000, height: 800 };
  vi.mocked(fakeBrowser.windows.get).mockImplementation(async () => ({ ...source }) as any);
  const update = vi.mocked(fakeBrowser.windows.update).mockImplementation(async (_id, patch) => { Object.assign(source, patch); return { ...source } as any; });
  const create = vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 2, incognito: false, tabs: [{ id: 20 }] } as any);
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  await guide.showSafariGuide('window', active(), true);
  vi.mocked(fakeBrowser.tabs.get).mockImplementation(async id => id === 20 ? { id: 20, windowId: 2, incognito: false, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window' } as any : normal as any);
  vi.resetModules(); guide = await import('./safariGuide');
  update.mockClear();
  if (action === 'deduplicate') {
    expect(await guide.showSafariGuide('window', active(), true)).toBe(20);
    expect(create).toHaveBeenCalledTimes(1);
    expect(source.width).toBe(640);
  } else {
    if (action === 'native') expect(await guide.safariGuideTabRemoved(20, 2)).toBe(true);
    else await guide.removeSafariGuide(active());
    expect(update).toHaveBeenCalledWith(1, { width: 1000 });
    expect((await fakeBrowser.storage.session.get('safariGuidePresentation')).safariGuidePresentation).toBeUndefined();
    if (action === 'native') expect(remove).not.toHaveBeenCalled();
    else expect(remove).toHaveBeenCalledWith(20);
  }
});

it.each([
  null,
  { version: 2 },
  { incognito: true },
  { incognito: undefined },
  { tabId: -1 },
  { tabId: '20' },
  { windowId: NaN },
  { url: 'https://accounts.google.com/' },
  { reserved: { id: 1, left: 100, top: 50, width: 1000, height: 800, appliedWidth: 700 } },
  { reserved: { id: 1, left: 100, top: 50, width: 1000, height: -1, appliedWidth: 640 } },
])('rejects malformed/private session ownership without native-close effects (%j)', async patch => {
  const valid = { version: 1, tabId: 20, windowId: 2, incognito: false, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window', reserved: { id: 1, left: 100, top: 50, width: 1000, height: 800, appliedWidth: 640 } };
  await fakeBrowser.storage.session.set({ safariGuidePresentation: patch === null ? null : { ...valid, ...patch } });
  vi.resetModules(); guide = await import('./safariGuide');
  vi.mocked(fakeBrowser.windows.get).mockResolvedValue({ id: 1, incognito: false, type: 'normal', left: 100, top: 50, width: 640, height: 800 } as any);
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  expect(await guide.safariGuideTabRemoved(20, 2)).toBe(false);
  expect(fakeBrowser.windows.update).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it.each([true, undefined])('restoration after retirement requires explicitly normal source privacy (%s)', async incognito => {
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 2, incognito: false, tabs: [{ id: 20 }] } as any);
  await guide.showSafariGuide('window', active(), true);
  vi.resetModules(); guide = await import('./safariGuide');
  vi.mocked(fakeBrowser.windows.get).mockResolvedValue({ id: 1, incognito, type: 'normal', left: 100, top: 50, width: 640, height: 800 } as any);
  vi.mocked(fakeBrowser.windows.update).mockClear();
  await guide.safariGuideTabRemoved(20, 2);
  expect(fakeBrowser.windows.update).not.toHaveBeenCalled();
});

it('does not accept a native close from a different window after retirement', async () => {
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 2, incognito: false, tabs: [{ id: 20 }] } as any);
  await guide.showSafariGuide('window', active(), true);
  vi.resetModules(); guide = await import('./safariGuide');
  vi.mocked(fakeBrowser.windows.update).mockClear();
  expect(await guide.safariGuideTabRemoved(20, 3)).toBe(false);
  expect(fakeBrowser.windows.update).not.toHaveBeenCalled();
});

it.each([
  { incognito: true }, { incognito: undefined }, { url: 'https://example.com/' },
  { pendingUrl: 'https://example.com/' }, { windowId: 3 },
])('never closes a no-longer-owned guide tab after retirement (%j)', async patch => {
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 2, incognito: false, tabs: [{ id: 20 }] } as any);
  await guide.showSafariGuide('window', active(), true);
  vi.resetModules(); guide = await import('./safariGuide');
  vi.mocked(fakeBrowser.tabs.get).mockResolvedValue({ id: 20, windowId: 2, incognito: false, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window', ...patch } as any);
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  await guide.removeSafariGuide(active());
  expect(remove).not.toHaveBeenCalled();
});
