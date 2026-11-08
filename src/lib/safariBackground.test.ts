import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { accountsItem, statusItem, prefsItem, wizardItem, loopPausesItem } from './store';
import { fetchAccountsViaTab, NoGoogleTabError } from './safariAccounts';

const account = { email: 'a@example.com', name: 'A', photo: '', index: 1, signedOut: false };
const own = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' };
const dynamic = vi.fn(async (_: any) => {});
const session = vi.fn(async (_: any) => {});
const privateAccess = vi.fn(async (): Promise<unknown> => false);
const script = vi.fn(async () => [{ result: { status: 200, body: '["gaia.l.a.r",[]]' } }]);
async function send(msg: object, sender: object = own): Promise<any> {
  return new Promise(resolve => { void fakeBrowser.runtime.onMessage.trigger(msg, sender, resolve); });
}
beforeEach(async () => {
  vi.resetModules(); fakeBrowser.reset(); vi.clearAllMocks(); vi.stubEnv('BROWSER', 'safari');
  dynamic.mockReset().mockImplementation(async () => {});
  session.mockReset().mockImplementation(async () => {});
  Object.assign(fakeBrowser.declarativeNetRequest, {
    getDynamicRules: vi.fn(async () => [{ id: 7 }]), updateDynamicRules: dynamic,
    getSessionRules: vi.fn(async () => []), updateSessionRules: session,
  });
  privateAccess.mockReset().mockResolvedValue(false);
  Object.assign(fakeBrowser.extension, { isAllowedIncognitoAccess: privateAccess });
  Object.assign(fakeBrowser.scripting, { executeScript: script });
  Object.assign(fakeBrowser.commands, { onCommand: { addListener: vi.fn() } });
  Object.assign(fakeBrowser.permissions, { onAdded: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } });
  Object.assign(fakeBrowser.windows, { onFocusChanged: { addListener: vi.fn() } });
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 1, incognito: false, windowId: 1 }] as any);
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
  vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([{ id: 1, incognito: false, url: 'https://example.com/' }] as any);
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
it('installs normal and per-service Pin only with verified private access off', async () => {
  const second = { ...account, email: 'b@example.com', index: 2 };
  await accountsItem.setValue([account, second]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email], serviceDefaults: { calendar: second.email } } });
  const rules = dynamic.mock.calls.at(-1)![0].addRules;
  expect(rules.some((r: any) => r.action.type === 'redirect' && JSON.stringify(r).includes('/mail/u/1/'))).toBe(true);
  expect(rules.some((r: any) => r.action.type === 'redirect' && JSON.stringify(r).includes('/calendar/u/2/'))).toBe(true);
  expect((await send({ type: 'getState' })).data.pinError).toBeNull();
  expect(session.mock.calls.flatMap(([o]) => o.addRules ?? []).some((r: any) => r.action.type === 'modifyHeaders')).toBe(false);
});
it.each([true, undefined, null, 'false', 0, 'throw', 'missing'])('clears legacy redirect and loop rules when private access is %s', async access => {
  await accountsItem.setValue([account]);
  await prefsItem.setValue({ ...(await prefsItem.getValue()), pinEnabled: true, order: [account.email] });
  vi.mocked(fakeBrowser.declarativeNetRequest.getSessionRules).mockResolvedValue([{ id: 1 }, { id: 9001 }] as any);
  if (access === 'throw') privateAccess.mockRejectedValue(new Error('denied'));
  else if (access === 'missing') Object.assign(fakeBrowser.extension, { isAllowedIncognitoAccess: undefined });
  else privateAccess.mockResolvedValue(access);
  dynamic.mockClear(); session.mockClear();
  const state = await send({ type: 'getState' });
  expect(state.data.pinError).toContain('Allow in Private Browsing');
  expect(state.data.pinError).toContain(access === true ? 'off' : 'verify');
  expect(dynamic.mock.calls.at(-1)![0]).toMatchObject({ removeRuleIds: [7] });
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
  expect(session.mock.calls.at(-1)![0]).toMatchObject({ removeRuleIds: [1, 9001] });
  expect(session.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
  expect((await prefsItem.getValue()).pinEnabled).toBe(true);
});
it('fresh-checks eligibility without rewriting unchanged successful rules on every UI state request', async () => {
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  dynamic.mockClear(); session.mockClear(); privateAccess.mockClear();
  await send({ type: 'getState' });
  await send({ type: 'getState' });
  expect(privateAccess).toHaveBeenCalledTimes(2);
  expect(dynamic).not.toHaveBeenCalled();
  expect(session).not.toHaveBeenCalled();
  privateAccess.mockResolvedValue(true);
  await send({ type: 'getState' });
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
});
it('recovers saved Pin after private access is disabled, including unchanged preference saves', async () => {
  await accountsItem.setValue([account]);
  privateAccess.mockResolvedValue(true);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  expect((await send({ type: 'getState' })).data.pinError).toContain('off');
  privateAccess.mockResolvedValue(false);
  await send({ type: 'savePrefs', patch: { pinEnabled: true } });
  expect(dynamic.mock.calls.at(-1)![0].addRules.length).toBeGreaterThan(10);
  expect((await send({ type: 'getState' })).data.pinError).toBeNull();
});
it('does not install redirects while Pin is off or the wizard is active', async () => {
  await accountsItem.setValue([account]);
  await send({ type: 'getState' });
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
  await wizardItem.setValue({ phase: 'signing-in', queue: [account.email], current: 0, completed: [], startedAt: Date.now() });
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
  await send({ type: 'wizardCancel' });
  expect(dynamic.mock.calls.at(-1)![0].addRules.length).toBeGreaterThan(10);
});
it('keeps rule-installation failures visible without replacing account errors', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await accountsItem.setValue([account]);
  await statusItem.setValue({ kind: 'error', message: 'Google request failed (403).', at: 1 });
  dynamic.mockImplementation(async o => { if (o.addRules?.length) throw new Error('DNR rejected'); });
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  const state = await send({ type: 'getState' });
  expect(state.data.pinError).toContain('DNR rejected');
  expect(state.data.status.message).toBe('Google request failed (403).');
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
  dynamic.mockImplementation(async () => {});
});
it('waits for expired-wizard Pin recovery before returning its installation status', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await accountsItem.setValue([account]);
  await prefsItem.setValue({ ...(await prefsItem.getValue()), pinEnabled: true, order: [account.email] });
  await wizardItem.setValue({ phase: 'signing-in', queue: [account.email], current: 0, completed: [], startedAt: Date.now() - 31 * 60_000 });
  dynamic.mockImplementation(async o => { if (o.addRules?.length) throw new Error('resume rejected'); });
  const state = await send({ type: 'getState' });
  expect(state.data.wizard.errorKind).toBe('expired');
  expect(state.data.pinError).toContain('resume rejected');
  dynamic.mockImplementation(async () => {});
});
it('rechecks private access during refresh even when no Google tab exists', async () => {
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  privateAccess.mockResolvedValue(true);
  await send({ type: 'refresh' });
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
});
it('serializes delayed eligibility checks so a later unsafe check removes earlier rules', async () => {
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  let release!: (value: unknown) => void;
  privateAccess.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(true);
  const first = send({ type: 'getState' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const second = send({ type: 'getState' });
  release(false);
  await Promise.all([first, second]);
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
});
it('installs eligible loop allow rules and removes them with redirects when private access changes', async () => {
  await accountsItem.setValue([account]);
  await loopPausesItem.setValue({ 'mail.google.com': Date.now() + 60_000 });
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  expect(session.mock.calls.at(-1)![0].addRules).toEqual([expect.objectContaining({ action: { type: 'allow' }, condition: expect.objectContaining({ requestDomains: ['mail.google.com'] }) })]);
  privateAccess.mockResolvedValue(true);
  await fakeBrowser.alarms.onAlarm.trigger({ name: 'uzero-loop-pauses' } as any);
  await vi.waitFor(() => expect(session.mock.calls.at(-1)![0].addRules ?? []).toEqual([]));
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
});
it('records real normal-tab redirect loops and installs a host allow rule', async () => {
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  const go = async (url: string) => {
    await fakeBrowser.tabs.onUpdated.trigger(10, { status: 'loading', url }, { id: 10, incognito: false, url } as any);
    await new Promise(resolve => setTimeout(resolve, 5));
  };
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  for (let i = 0; i < 3; i++) {
    await go('https://mail.google.com/mail/');
    await go('https://mail.google.com/mail/u/1/');
  }
  await vi.waitFor(async () => expect(Object.keys(await loopPausesItem.getValue())).toEqual(['mail.google.com']));
  expect(session.mock.calls.at(-1)![0].addRules).toEqual([expect.objectContaining({ action: { type: 'allow' }, condition: expect.objectContaining({ requestDomains: ['mail.google.com'] }) })]);
  expect(await fakeBrowser.alarms.get('uzero-loop-pauses')).toBeDefined();
});
it.each(['onAdded', 'onRemoved', 'onFocusChanged'] as const)('rechecks eligibility on the supported %s wakeup', async event => {
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  privateAccess.mockResolvedValue(true);
  dynamic.mockClear();
  const source = event === 'onFocusChanged' ? fakeBrowser.windows[event] : fakeBrowser.permissions[event];
  const wake = vi.mocked(source.addListener).mock.calls[0]![0] as (...args: any[]) => void;
  wake(event === 'onFocusChanged' ? 1 : {});
  await vi.waitFor(() => expect(dynamic).toHaveBeenCalled());
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
});
it('verifies persisted rules on worker restart without a UI request', async () => {
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  privateAccess.mockResolvedValue(true); dynamic.mockClear();
  vi.resetModules();
  const bg = (await import('../entrypoints/background')).default as unknown as { main(): void };
  bg.main();
  await vi.waitFor(() => expect(dynamic).toHaveBeenCalled());
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
});
it('reports a rejected loop-rule install and clears redirects too', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  await loopPausesItem.setValue({ 'mail.google.com': Date.now() + 60_000 });
  session.mockImplementation(async o => { if (o.addRules?.length) throw new Error('session rejected'); });
  const state = await send({ type: 'getState' });
  expect(state.data.pinError).toContain('session rejected');
  expect(dynamic.mock.calls.at(-1)![0].addRules ?? []).toEqual([]);
  session.mockImplementation(async () => {});
});
it('does not claim failed rule cleanup succeeded', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await accountsItem.setValue([account]);
  await send({ type: 'savePrefs', patch: { pinEnabled: true, order: [account.email] } });
  privateAccess.mockResolvedValue(true);
  dynamic.mockRejectedValue(new Error('removal rejected'));
  const state = await send({ type: 'getState' });
  expect(state.data.pinError).toContain('could not confirm that existing rules were removed');
  expect(state.data.pinError).toContain('Allow in Private Browsing off');
  dynamic.mockImplementation(async () => {});
});
it('normal account discovery still uses its tab and never an Origin workaround', async () => {
  vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([{ id: 12, incognito: false, url: 'https://accounts.google.com/', status: 'complete' }] as any);
  const result = await send({ type: 'refresh' });
  expect(result.data.status.kind).toBe('ok');
  expect(script).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 12 } }));
  expect(session.mock.calls.flatMap(([o]) => o.addRules ?? []).some((r: any) => r.action.type === 'modifyHeaders')).toBe(false);
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

it('rejects empty or unknown active context and unknown sender privacy', async () => {
  for (const tabs of [[], [{ id: 1 }]]) {
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue(tabs as any);
    expect((await send({ type: 'getState' })).ok).toBe(false);
  }
  vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([{ id: 1, incognito: false }] as any);
  expect((await send({ type: 'getState' }, { ...own, tab: { id: 2 } })).ok).toBe(false);
});
it('preserves account errors alongside the visible private-access instruction', async () => {
  await prefsItem.setValue({ ...(await prefsItem.getValue()), pinEnabled: true });
  await statusItem.setValue({ kind: 'error', message: 'Open any Google page, then open Uzero again.', at: 1 });
  privateAccess.mockResolvedValue(true);
  const res = await send({ type: 'getState' });
  expect(res.data.status.message).toContain('Open any Google page');
  expect(res.data.pinError).toContain('Allow in Private Browsing');
});
it('pins service and overlay confirmation tab creation to a revalidated normal window', async () => {
  await prefsItem.setValue({ ...(await prefsItem.getValue()), safariGuideMode: 'overlay' });
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([{ id: 20, incognito: true }, { id: 21, incognito: false, type: 'normal' }] as any);
  vi.spyOn(fakeBrowser.windows, 'get').mockResolvedValue({ id: 21, incognito: false } as any);
  const create = vi.spyOn(fakeBrowser.tabs, 'create');
  await send({ type: 'openService', serviceId: 'gmail', email: account.email });
  await send({ type: 'wizardOpen', queue: [account.email] });
  expect(create.mock.calls.length).toBe(2);
  for (const [arg] of create.mock.calls) expect(arg.windowId).toBe(21);
});
it('accounts-driven wizard advancement cannot create into the focused private window', async () => {
  vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({ id: 30, incognito: false, url: 'https://example.com/', windowId: 21 } as any);
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([{ id: 20, incognito: true }, { id: 21, incognito: false, type: 'normal' }] as any);
  vi.spyOn(fakeBrowser.windows, 'get').mockResolvedValue({ id: 21, incognito: false } as any);
  await wizardItem.setValue({ phase: 'signing-out', queue: [account.email], current: 0, completed: [], kept: [], tabId: 30, startedAt: Date.now(), lastActivityAt: Date.now() } as any);
  vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([{ id: 31, incognito: false, url: 'https://accounts.google.com/', status: 'complete' }] as any);
  const create = vi.spyOn(fakeBrowser.tabs, 'create');
  // Alarm-driven refresh, while the private window is focused, bypasses message entry points.
  await fakeBrowser.alarms.onAlarm.trigger({ name: 'uzero-refresh' } as any);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ windowId: 21 }));
});
it('pauses wizard advancement and service creation without a verified normal window', async () => {
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([{ id: 20, incognito: true }] as any);
  vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({ id: 30, incognito: false, url: 'https://example.com/' } as any);
  const wizard = { phase: 'signing-out', queue: [account.email], current: 0, completed: [], kept: [], tabId: 30, startedAt: Date.now(), lastActivityAt: Date.now() };
  await wizardItem.setValue(wizard as any);
  const create = vi.spyOn(fakeBrowser.tabs, 'create');
  expect((await send({ type: 'openService', serviceId: 'gmail', email: account.email })).ok).toBe(false);
  vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([{ id: 31, incognito: false, url: 'https://accounts.google.com/', status: 'complete' }] as any);
  await fakeBrowser.alarms.onAlarm.trigger({ name: 'uzero-refresh' } as any);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(create).not.toHaveBeenCalled();
  expect((await wizardItem.getValue())?.phase).toBe('signing-out');
});
it('fails closed when a candidate window cannot be revalidated as normal', async () => {
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([{ id: 21, incognito: false, type: 'normal' }] as any);
  const get = vi.spyOn(fakeBrowser.windows, 'get');
  const create = vi.spyOn(fakeBrowser.tabs, 'create');
  for (const value of [undefined, { id: 21 }, { id: 21, incognito: true }]) {
    get.mockResolvedValue(value as any);
    expect((await send({ type: 'openService', serviceId: 'gmail', email: account.email })).ok).toBe(false);
  }
  expect(create).not.toHaveBeenCalled();
});

it('opens a user-triggered Safari guide window at confirmation without signing out', async () => {
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 22, incognito: false, tabs: [{ id: 23 }] } as any);
  const create = vi.spyOn(fakeBrowser.tabs, 'create');
  const result = await send({ type: 'wizardOpen', queue: [account.email] });
  expect(result).toMatchObject({ ok: true, data: { phase: 'confirm', pageTabId: 23 } });
  expect(fakeBrowser.windows.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'popup', incognito: false }));
  expect(create).not.toHaveBeenCalled();
});
it('overlay authorization reveals only a boolean and does not trust ordinary content messages', async () => {
  const tab = { id: 10, incognito: false, url: 'https://accounts.google.com/signin', windowId: 1 };
  const sender = { ...own, url: tab.url, tab, frameId: 0 };
  vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(tab as any);
  await prefsItem.setValue({ ...(await prefsItem.getValue()), safariGuideMode: 'overlay' });
  await wizardItem.setValue({ phase: 'signing-in', queue: [account.email], current: 0, completed: [], tabId: 10, startedAt: Date.now() });
  expect(await send({ type: 'safariGuideAuthorize' }, sender)).toEqual({ ok: true, data: { authorized: true } });
  for (const type of ['getState', 'wizardBegin', 'wizardCancel']) expect((await send({ type }, sender)).ok).toBe(false);
  expect(await send({ type: 'safariGuideAuthorize' }, { ...sender, tab: { ...tab, id: 11 } })).toEqual({ ok: true, data: { authorized: false } });
});
it('gates extension iframe state/actions by current overlay tab and limits its API', async () => {
  const tab = { id: 10, incognito: false, url: 'https://accounts.google.com/signin', windowId: 1 };
  vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(tab as any);
  await prefsItem.setValue({ ...(await prefsItem.getValue()), safariGuideMode: 'overlay' });
  await wizardItem.setValue({ phase: 'signing-in', queue: [account.email], current: 0, completed: [], tabId: 10, startedAt: Date.now() });
  const frame = { ...own, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=overlay', frameId: 2, tab };
  expect((await send({ type: 'getState' }, frame)).ok).toBe(true);
  for (const sender of [{ ...frame, frameId: undefined }, { ...frame, frameId: 0 }, { ...frame, tab: { ...tab, id: 11 } }, { ...frame, tab: { ...tab, incognito: true } }, { ...frame, url: fakeBrowser.runtime.getURL('/reorder.html') }]) {
    for (const type of ['getState', 'wizardCancel']) expect((await send({ type }, sender)).ok).toBe(false);
  }
  expect((await send({ type: 'savePrefs', patch: { pinEnabled: true } }, frame)).ok).toBe(false);
  expect((await send({ type: 'openService', serviceId: 'gmail', email: account.email }, frame)).ok).toBe(false);
  await prefsItem.setValue({ ...(await prefsItem.getValue()), safariGuideMode: 'window' });
  expect((await send({ type: 'getState' }, frame)).ok).toBe(false);
});
it('removes an overlay on cancel and clears wizard state', async () => {
  const tab = { id: 10, incognito: false, url: 'https://accounts.google.com/signin', windowId: 1 };
  vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(tab as any);
  const remove = vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
  await wizardItem.setValue({ phase: 'signing-in', queue: [account.email], current: 0, completed: [], tabId: 10, startedAt: Date.now() });
  await send({ type: 'wizardCancel' });
  expect(remove).toHaveBeenCalledWith(10, { type: 'safariGuideRemove' }, { frameId: 0 });
  expect(await wizardItem.getValue()).toBeNull();
});

it.each(['untouched', 'moved', 'resized'])('native guide close restores only untouched geometry (%s) without cancelling Google', async change => {
  const source = { id: 1, incognito: false, type: 'normal', left: 100, top: 50, width: 1000, height: 800 };
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([source] as any);
  vi.spyOn(fakeBrowser.windows, 'get').mockImplementation(async () => ({ ...source }) as any);
  const update = vi.spyOn(fakeBrowser.windows, 'update').mockImplementation(async (_id, patch) => { Object.assign(source, patch); return { ...source } as any; });
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 22, incognito: false, tabs: [{ id: 23 }] } as any);
  await send({ type: 'wizardOpen', queue: [account.email] });
  expect(source.width).toBe(640);
  const w = { ...(await wizardItem.getValue())!, phase: 'signing-in' as const, tabId: 10 };
  await wizardItem.setValue(w);
  if (change === 'moved') source.left = 120;
  if (change === 'resized') source.width = 700;
  update.mockClear();
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove');
  // No onUpdated observation for the owned extension page, and no privacy in removal events.
  await fakeBrowser.tabs.onRemoved.trigger(23, { windowId: 22, isWindowClosing: true });
  await vi.waitFor(async () => expect((await wizardItem.getValue())?.pageTabId).toBeUndefined());
  expect(await wizardItem.getValue()).toEqual({ ...w, pageTabId: undefined });
  expect(remove).not.toHaveBeenCalled();
  if (change !== 'untouched') expect(update).not.toHaveBeenCalled();
  else expect(update).toHaveBeenCalledWith(1, { width: 1000 });
});

it('unobserved non-guide removals cannot mutate the Safari wizard', async () => {
  const w = { phase: 'signing-in' as const, queue: [account.email], current: 0, completed: [], startedAt: Date.now(), tabId: 99, pageTabId: 98 };
  await wizardItem.setValue(w);
  await fakeBrowser.tabs.onRemoved.trigger(99, { windowId: 4, isWindowClosing: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(await wizardItem.getValue()).toEqual(w);
});

it.each(['expired', 'tab-closed'] as const)('explicit reopen retains the %s recovery window and Retry remains reachable', async errorKind => {
  const recovery = { phase: 'error' as const, errorKind, error: 'Paused', queue: [account.email], current: 0, completed: [], startedAt: Date.now() - 31 * 60_000 };
  await wizardItem.setValue(recovery);
  const page = { id: 23, windowId: 22, incognito: false, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window' };
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 22, incognito: false, tabs: [page] } as any);
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation(async id => id === 23 ? page as any : undefined as any);
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  const opened = await send({ type: 'wizardOpen', queue: [account.email] });
  expect(opened).toMatchObject({ ok: true, data: { phase: 'error', errorKind, pageTabId: 23 } });
  expect(remove).not.toHaveBeenCalledWith(23);
  const sender = { ...own, url: page.url, frameId: 0, tab: page };
  expect((await send({ type: 'getState' }, sender)).data.wizard.errorKind).toBe(errorKind);
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([{ id: 1, incognito: false, type: 'normal' }] as any);
  vi.spyOn(fakeBrowser.windows, 'get').mockResolvedValue({ id: 1, incognito: false, type: 'normal' } as any);
  vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({ id: 10, windowId: 1, incognito: false } as any);
  expect((await send({ type: 'wizardRetry' }, sender)).data.phase).toBe('signing-out');
  expect(remove).not.toHaveBeenCalledWith(23);
});

it('passive expiry closes the guide and never creates a replacement popup', async () => {
  const page = { id: 23, windowId: 22, incognito: false, url: fakeBrowser.runtime.getURL('/reorder.html') + '?guide=window' };
  vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue(page as any);
  await wizardItem.setValue({ phase: 'signing-in', tabId: 10, pageTabId: 23, queue: [account.email], current: 0, completed: [], startedAt: Date.now() - 31 * 60_000 });
  const create = vi.spyOn(fakeBrowser.windows, 'create');
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined);
  await fakeBrowser.alarms.onAlarm.trigger({ name: 'uzero-wizard-expiry' } as any);
  await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(23));
  expect((await wizardItem.getValue())?.errorKind).toBe('expired');
  expect(create).not.toHaveBeenCalled();
});

it.each(['untouched', 'moved', 'resized', 'confirmation'])('worker restart retains native-close ownership and geometry (%s)', async change => {
  const source = { id: 1, incognito: false, type: 'normal', left: 100, top: 50, width: 1000, height: 800 };
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([source] as any);
  vi.spyOn(fakeBrowser.windows, 'get').mockImplementation(async () => ({ ...source }) as any);
  const update = vi.spyOn(fakeBrowser.windows, 'update').mockImplementation(async (_id, patch) => { Object.assign(source, patch); return { ...source } as any; });
  vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 22, incognito: false, tabs: [{ id: 23 }] } as any);
  await send({ type: 'wizardOpen', queue: [account.email] });
  expect(source.width).toBe(640);
  const w = { ...(await wizardItem.getValue())!, ...(change === 'confirmation' ? {} : { phase: 'signing-in' as const, tabId: 10 }) };
  await wizardItem.setValue(w);
  if (change === 'moved') source.left = 120;
  if (change === 'resized') source.height = 780;
  // Retire worker modules/listeners, preserving browser storage and window state.
  for (const event of [fakeBrowser.tabs.onRemoved, fakeBrowser.tabs.onUpdated, fakeBrowser.runtime.onMessage, fakeBrowser.alarms.onAlarm]) {
    event.removeAllListeners();
  }
  vi.resetModules();
  const bg = (await import('../entrypoints/background')).default as unknown as { main(): void }; bg.main();
  update.mockClear();
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove');
  await fakeBrowser.tabs.onRemoved.trigger(23, { windowId: 22, isWindowClosing: true });
  await vi.waitFor(async () => expect((await wizardItem.getValue())?.pageTabId).toBeUndefined());
  expect(await wizardItem.getValue()).toEqual({ ...w, pageTabId: undefined });
  expect(remove).not.toHaveBeenCalled();
  if (change === 'untouched' || change === 'confirmation') expect(update).toHaveBeenCalledWith(1, { width: 1000 });
  else expect(update).not.toHaveBeenCalled();
});
