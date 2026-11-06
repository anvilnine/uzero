import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { accountsItem, statusItem, prefsItem } from './store';
import { fetchAccountsViaTab, NoGoogleTabError } from './safariAccounts';

const account = { email: 'a@example.com', name: 'A', photo: '', index: 1, signedOut: false };
const own = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' };
const dynamic = vi.fn(async (_: any) => {});
const session = vi.fn(async (_: any) => {});
const script = vi.fn(async () => [{ result: { status: 200, body: '["gaia.l.a.r",[]]' } }]);
async function send(msg: object, sender: object = own): Promise<any> {
  return new Promise(resolve => { void fakeBrowser.runtime.onMessage.trigger(msg, sender, resolve); });
}
beforeEach(async () => {
  vi.resetModules(); fakeBrowser.reset(); vi.clearAllMocks(); vi.stubEnv('BROWSER', 'safari');
  Object.assign(fakeBrowser.declarativeNetRequest, {
    getDynamicRules: vi.fn(async () => [{ id: 7 }]), updateDynamicRules: dynamic,
    getSessionRules: vi.fn(async () => []), updateSessionRules: session,
  });
  Object.assign(fakeBrowser.scripting, { executeScript: script });
  Object.assign(fakeBrowser.commands, { onCommand: { addListener: vi.fn() } });
  const bg = (await import('../entrypoints/background')).default as unknown as { main(): void }; bg.main();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('never discovers accounts in private tabs or creates a tab on refresh', async () => {
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 10, incognito: true, url: 'https://accounts.google.com/', status: 'complete' }] as any);
  const create = vi.spyOn(fakeBrowser.tabs, 'create');
  await expect(fetchAccountsViaTab()).rejects.toBeInstanceOf(NoGoogleTabError);
  await send({ type: 'refresh' });
  expect(script).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
});
it('keeps cached accounts and clears a previous error when no normal Google tab exists', async () => {
  await accountsItem.setValue([account]); await statusItem.setValue({ kind: 'error', message: 'old error', at: 1 });
  const res = await send({ type: 'refresh' });
  expect(res.data.accounts).toEqual([account]); expect(res.data.status.kind).toBe('ok');
});
it('rejects private sender messages and private active-window popup actions', async () => {
  await accountsItem.setValue([account]);
  expect((await send({ type: 'getState' }, { ...own, tab: { id: 10, incognito: true } })).ok).toBe(false);
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 10, incognito: true, url: 'https://mail.google.com/' }] as any);
  const update = vi.spyOn(fakeBrowser.tabs, 'update'); const create = vi.spyOn(fakeBrowser.tabs, 'create');
  for (const msg of [{ type: 'switchActiveTab', email: account.email }, { type: 'openService', serviceId: 'gmail', email: account.email }, { type: 'wizardOpen', queue: [account.email] }]) expect((await send(msg)).ok).toBe(false);
  expect(update).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
});
it('removes legacy global rules and reports the Safari Pin parity blocker', async () => {
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 10, incognito: false }, { id: 11, incognito: true }] as any);
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true } });
  expect(dynamic).toHaveBeenCalledWith({ removeRuleIds: [7] });
  expect(session.mock.calls.flatMap(([o]) => o.addRules ?? [])).toEqual([]);
  const state = await send({ type: 'getState' });
  expect(state.data.status).toMatchObject({ kind: 'error', message: expect.stringContaining('Pin is unavailable in Safari') });
  expect((await prefsItem.getValue()).pinEnabled).toBe(true);
});
it('ignores private tab update events without discovering accounts', async () => {
  vi.useFakeTimers();
  await fakeBrowser.tabs.onUpdated.trigger(10, { status: 'complete' }, { id: 10, incognito: true, url: 'https://accounts.google.com/' } as any);
  await vi.advanceTimersByTimeAsync(2000);
  expect(script).not.toHaveBeenCalled();
  expect(await statusItem.getValue()).toEqual({ kind: 'idle' });
  vi.useRealTimers();
});
it('commands do not switch a private active tab', async () => {
  await prefsItem.setValue({ ...(await prefsItem.getValue()), order: [account.email] });
  await accountsItem.setValue([account]);
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 10, incognito: true, url: 'https://mail.google.com/' }] as any);
  const command = vi.mocked(fakeBrowser.commands.onCommand.addListener).mock.calls[0]![0];
  const update = vi.spyOn(fakeBrowser.tabs, 'update');
  command('switch-1', {} as any); await new Promise(resolve => setTimeout(resolve, 10));
  expect(update).not.toHaveBeenCalled();
});
it('Safari never reads or writes the popup account cache before private-context checks', async () => {
  const getItem = vi.fn(); const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem, setItem });
  const { readCache, writeCache } = await import('../ui/model');
  expect(readCache()).toBeNull();
  writeCache({ accounts: [account] } as any);
  expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it('reads a completed normal Google tab, preferring accounts.google.com and excluding unknown privacy', async () => {
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([
    { id: 10, incognito: true, url: 'https://accounts.google.com/', status: 'complete' },
    { id: 11, incognito: false, url: 'https://mail.google.com/', status: 'complete' },
    { id: 12, incognito: false, url: 'https://accounts.google.com/', status: 'complete' },
    { id: 13, url: 'https://accounts.google.com/', status: 'complete' },
  ] as any);
  await fetchAccountsViaTab();
  expect(script).toHaveBeenCalledTimes(1);
  expect(script).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 12 } }));
});
