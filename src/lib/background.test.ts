// Integration test of the background router against WXT's fake browser.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { accountsItem, loopPausesItem, prefsItem, wizardItem } from './store';
import { WIZARD_TTL_MS } from './wizard';

const dnr = {
  getDynamicRules: vi.fn(async () => [{ id: 7 }]),
  updateDynamicRules: vi.fn(async (_o: unknown) => undefined),
  updateSessionRules: vi.fn(async (_o: unknown) => undefined),
  getSessionRules: vi.fn(async () => [] as { id: number }[]),
};

const row = (email: string, index: number) => ['gaia.l.a', 1, email, email, '', null, null, index, null, 1, 'id', null, null, null, 0];
let rows: unknown[] = [];
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(['gaia.l.a.r', rows])));

const OWN = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/popup.html' };

/** Loose view of Envelope so tests can read .data without narrowing. */
type Reply = { ok: boolean; data?: any; error?: string };

async function send(msg: unknown, sender: object = OWN): Promise<Reply> {
  let res: Reply | undefined;
  const done = new Promise<void>((resolve) => {
    void fakeBrowser.runtime.onMessage.trigger(msg, sender, (r: Reply) => {
      res = r;
      resolve();
    });
  });
  await done;
  return res!;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  fakeBrowser.reset();
  Object.assign(fakeBrowser.declarativeNetRequest, dnr);
  Object.assign(fakeBrowser.commands, { onCommand: { addListener: vi.fn() } });
  vi.stubGlobal('fetch', fetchMock);
  vi.clearAllMocks();
  rows = [row('a@x.com', 0), row('b@x.com', 1)];
  const bg = (await import('../entrypoints/background')).default as unknown as { main: () => void };
  bg.main();
});

describe('background router', () => {
  it('rejects untrusted senders and unknown messages', async () => {
    expect(await send({ type: 'getState' }, { id: 'other', url: 'chrome-extension://other/x.html' })).toEqual({
      ok: false, error: 'Forbidden sender',
    });
    expect(await send({ type: 'getState' }, { id: OWN.id, url: 'https://evil.com/' })).toMatchObject({ ok: false });
    expect(await send({ type: 'nuke' })).toEqual({ ok: false, error: 'Invalid message' });
  });

  it('refresh stores accounts, merges order and installs the Origin rule', async () => {
    const res = await send({ type: 'refresh' });
    expect(res.ok).toBe(true);
    expect(res.data.accounts.map((a: { email: string }) => a.email)).toEqual(['a@x.com', 'b@x.com']);
    expect(res.data.prefs.order).toEqual(['a@x.com', 'b@x.com']);
    expect(res.data.status.kind).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
    expect(dnr.updateSessionRules).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight fetch between concurrent refreshes', async () => {
    await Promise.all([send({ type: 'refresh' }), send({ type: 'refresh' }), send({ type: 'refresh' })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports fetch errors in status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    const res = await send({ type: 'refresh' });
    expect(res.data.status).toMatchObject({ kind: 'error', message: expect.stringContaining('403') });
  });

  it('savePrefs validates, then replaces dynamic rules atomically', async () => {
    await send({ type: 'refresh' });
    dnr.updateDynamicRules.mockClear();
    const res = await send({ type: 'savePrefs', patch: { order: ['B@x.com', 'a@x.com', 'junk'], pinEnabled: true } });
    expect(res.data.order).toEqual(['b@x.com', 'a@x.com']);
    expect(await prefsItem.getValue()).toMatchObject({ pinEnabled: true, order: ['b@x.com', 'a@x.com'] });
    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(1);
    const arg = dnr.updateDynamicRules.mock.calls[0]![0] as { removeRuleIds: number[]; addRules: unknown[] };
    expect(arg.removeRuleIds).toEqual([7]);
    expect(arg.addRules.length).toBeGreaterThan(10);
    expect(await fakeBrowser.alarms.get('lineup-refresh')).toBeDefined();
  });

  it('switchActiveTab rewrites the active Google tab', async () => {
    await send({ type: 'refresh' });
    const tab = await fakeBrowser.tabs.create({ url: 'https://mail.google.com/mail/u/0/#inbox', active: true });
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((async () => [await fakeBrowser.tabs.get(tab.id!)]) as never);
    const res = await send({ type: 'switchActiveTab', email: 'b@x.com' });
    expect(res.data).toEqual({ ok: true });
    expect((await fakeBrowser.tabs.get(tab.id!)).url).toBe('https://mail.google.com/mail/u/1/#inbox');
    expect((await send({ type: 'switchActiveTab', email: 'nobody@x.com' })).data.ok).toBe(false);
  });

  it('activeTabService names the service and account', async () => {
    await send({ type: 'refresh' });
    const tab = await fakeBrowser.tabs.create({ url: 'https://meet.google.com/abc?authuser=1', active: true });
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((async () => [tab]) as never);
    expect((await send({ type: 'activeTabService' })).data).toEqual({ serviceId: 'meet', email: 'b@x.com' });
  });

  it('runs the wizard: open, begin (sign out), sign in, done', async () => {
    await send({ type: 'refresh' });
    const opened = await send({ type: 'wizardOpen', queue: ['b@x.com', 'a@x.com'] });
    expect(opened.data.phase).toBe('confirm');

    const begun = await send({ type: 'wizardBegin' });
    expect(begun.data.phase).toBe('signing-out');
    const tabId = begun.data.tabId as number;
    expect((await fakeBrowser.tabs.get(tabId)).url).toBe('https://accounts.google.com/Logout');

    rows = [];
    await send({ type: 'refresh' });
    let w = await wizardItem.getValue();
    expect(w).toMatchObject({ phase: 'signing-in', current: 0, tabId });
    expect((await fakeBrowser.tabs.get(tabId)).url).toContain('/AccountChooser?Email=b%40x.com');

    rows = [row('b@x.com', 0)];
    await send({ type: 'refresh' });
    w = await wizardItem.getValue();
    expect(w).toMatchObject({ phase: 'signing-in', current: 1, tabId });
    expect((await fakeBrowser.tabs.get(tabId)).url).toContain('/AddSession?Email=a%40x.com');

    rows = [row('b@x.com', 0), row('a@x.com', 1)];
    await send({ type: 'refresh' });
    w = await wizardItem.getValue();
    expect(w).toMatchObject({ phase: 'done', completed: ['b@x.com', 'a@x.com'] });
    expect(w?.tabId).toBeUndefined();
    expect(await fakeBrowser.tabs.get(tabId)).toBeUndefined(); // closed
    expect((await accountsItem.getValue()).map((a) => a.index)).toEqual([0, 1]);

    expect((await send({ type: 'wizardCancel' })).data).toBeNull();
    expect(await wizardItem.getValue()).toBeNull();
  });

  /** Open the wizard and get to "signing in as b@x.com" (Google tab on AccountChooser). */
  async function toSigningIn(): Promise<{ tabId: number; pageTabId: number }> {
    await send({ type: 'refresh' });
    const opened = await send({ type: 'wizardOpen', queue: ['b@x.com', 'a@x.com'] });
    const begun = await send({ type: 'wizardBegin' });
    rows = [];
    await send({ type: 'refresh' });
    expect(await wizardItem.getValue()).toMatchObject({ phase: 'signing-in', current: 0 });
    return { tabId: begun.data.tabId as number, pageTabId: opened.data.pageTabId as number };
  }

  const reorderTabs = async () =>
    (await fakeBrowser.tabs.query({})).filter((t) => t.url?.endsWith('/reorder.html'));

  it('wizardOpen while a reorder runs keeps it and focuses the same reorder tab', async () => {
    const { pageTabId } = await toSigningIn();
    expect(pageTabId).toBeTypeOf('number');
    expect(await reorderTabs()).toHaveLength(1);
    const before = await wizardItem.getValue();
    dnr.updateDynamicRules.mockClear();

    const again = await send({ type: 'wizardOpen', queue: ['a@x.com'] });
    expect(again.data).toMatchObject({ phase: 'signing-in', queue: ['b@x.com', 'a@x.com'], pageTabId });
    expect(await reorderTabs()).toHaveLength(1);
    expect((await wizardItem.getValue())?.startedAt).toBe(before?.startedAt);
    expect(dnr.updateDynamicRules).not.toHaveBeenCalled(); // pin stays paused

    // Reorder tab closed: a new one opens.
    await fakeBrowser.tabs.remove(pageTabId).catch(() => undefined);
    const third = await send({ type: 'wizardOpen', queue: ['a@x.com'] });
    expect(third.data.pageTabId).not.toBe(pageTabId);
    expect(await reorderTabs()).toHaveLength(1);
  });

  it('wizardOpen from the reorder page itself opens no extra tab', async () => {
    const page = await fakeBrowser.tabs.create({ url: 'chrome-extension://test-extension-id/reorder.html' });
    const before = (await fakeBrowser.tabs.query({})).length;
    const res = await send({ type: 'wizardOpen', queue: ['a@x.com'] }, {
      ...OWN, url: 'chrome-extension://test-extension-id/reorder.html', tab: page,
    });
    expect(res.data).toMatchObject({ phase: 'confirm', pageTabId: page.id });
    expect((await fakeBrowser.tabs.query({})).length).toBe(before);
  });

  it('wizardReopen sends the Google tab back to the sign-in page', async () => {
    const { tabId } = await toSigningIn();
    // The user wandered inside Google's sign-in flow.
    await fakeBrowser.tabs.update(tabId, { url: 'https://accounts.google.com/v3/signin/challenge/pwd' });
    const res = await send({ type: 'wizardReopen' });
    expect(res.data).toMatchObject({ phase: 'signing-in', current: 0, tabId });
    expect((await fakeBrowser.tabs.get(tabId)).url).toContain('/AccountChooser?Email=b%40x.com');
  });

  it('never reuses or closes a wizard tab the user took elsewhere', async () => {
    const { tabId } = await toSigningIn();
    await fakeBrowser.tabs.update(tabId, { url: 'https://example.com/' });
    const res = await send({ type: 'wizardReopen' });
    expect(res.data.tabId).not.toBe(tabId);
    expect((await fakeBrowser.tabs.get(tabId)).url).toBe('https://example.com/');
    expect((await fakeBrowser.tabs.get(res.data.tabId)).url).toContain('/AccountChooser');

    // Same on cancel: the user's tab stays.
    await fakeBrowser.tabs.update(res.data.tabId, { url: 'https://example.com/two' });
    await send({ type: 'wizardCancel' });
    expect((await fakeBrowser.tabs.get(res.data.tabId))?.url).toBe('https://example.com/two');
  });

  it('wizardFocusTab activates the Google tab, or reopens it when gone', async () => {
    const { tabId } = await toSigningIn();
    const other = await fakeBrowser.tabs.create({ url: 'https://example.com/', active: true });
    expect((await send({ type: 'wizardFocusTab' })).data).toEqual({ ok: true });
    const [active] = await fakeBrowser.tabs.query({ active: true });
    expect(active?.id).toBe(tabId);
    expect(other.id).not.toBe(tabId);

    await fakeBrowser.tabs.update(tabId, { url: 'https://example.com/elsewhere' });
    expect((await send({ type: 'wizardFocusTab' })).data).toEqual({ ok: true });
    const w = await wizardItem.getValue();
    expect(w?.tabId).not.toBe(tabId);
    expect((await fakeBrowser.tabs.get(w!.tabId!)).url).toContain('/AccountChooser');

    await send({ type: 'wizardCancel' });
    expect((await send({ type: 'wizardFocusTab' })).data).toEqual({ ok: false });
  });

  it('an abandoned wizard expires on the next getState and pin comes back', async () => {
    await send({ type: 'savePrefs', patch: { order: ['b@x.com', 'a@x.com'], pinEnabled: true } });
    rows = [row('a@x.com', 0), row('b@x.com', 1)];
    await send({ type: 'refresh' });
    await send({ type: 'wizardOpen', queue: ['b@x.com', 'a@x.com'] });
    await send({ type: 'wizardBegin' });
    const w = await wizardItem.getValue();
    expect(w?.lastActivityAt).toBeTypeOf('number');
    expect(await fakeBrowser.alarms.get('lineup-wizard-expiry')).toBeDefined();
    // Pin paused while the wizard runs.
    await vi.waitFor(() => {
      const last = dnr.updateDynamicRules.mock.calls.at(-1)![0] as { addRules: unknown[] };
      expect(last.addRules).toEqual([]);
    });

    dnr.updateDynamicRules.mockClear();
    const later = w!.lastActivityAt! + WIZARD_TTL_MS + 1;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const res = await send({ type: 'getState' });
    expect(res.data.wizard).toMatchObject({ phase: 'error', errorKind: 'expired' });
    await vi.waitFor(() => expect(dnr.updateDynamicRules).toHaveBeenCalled());
    const arg = dnr.updateDynamicRules.mock.calls.at(-1)![0] as { addRules: unknown[] };
    expect(arg.addRules.length).toBeGreaterThan(10);
    expect(await fakeBrowser.alarms.get('lineup-wizard-expiry')).toBeUndefined();
  });

  it('pauses pin on a host that keeps bouncing a tab', async () => {
    await send({ type: 'refresh' });
    await send({ type: 'savePrefs', patch: { order: ['b@x.com', 'a@x.com'], pinEnabled: true } });
    const tab = await fakeBrowser.tabs.create({ url: 'https://mail.google.com/mail/u/1/' });
    const hit = () => fakeBrowser.tabs.onUpdated.trigger(tab.id!, { status: 'loading' }, tab);
    dnr.updateSessionRules.mockClear();
    await hit();
    await hit();
    await new Promise((r) => setTimeout(r, 10));
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
    await hit();
    await vi.waitFor(() => expect(dnr.updateSessionRules).toHaveBeenCalled());
    const arg = dnr.updateSessionRules.mock.calls.at(-1)![0] as { addRules: { condition: { requestDomains: string[] } }[] };
    expect(arg.addRules.map((r) => r.condition.requestDomains)).toEqual([['mail.google.com']]);
    expect(Object.keys(await loopPausesItem.getValue())).toEqual(['mail.google.com']);
    expect(await fakeBrowser.alarms.get('lineup-loop-pauses')).toBeDefined();

    // A tab without our marker, or a host we don't pin, never counts.
    dnr.updateSessionRules.mockClear();
    const bare = await fakeBrowser.tabs.create({ url: 'https://meet.google.com/abc' });
    for (let i = 0; i < 4; i++) await fakeBrowser.tabs.onUpdated.trigger(bare.id!, { status: 'loading' }, bare);
    await new Promise((r) => setTimeout(r, 10));
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
  });
});
