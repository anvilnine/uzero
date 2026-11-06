// Integration test of the background router against WXT's fake browser.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { accountsItem, loopPausesItem, prefsItem, statusItem, wizardItem } from './store';
import { LOGOUT_URL, WIZARD_TTL_MS } from './wizard';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    expect(await fakeBrowser.alarms.get('uzero-refresh')).toBeDefined();
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
    expect((await fakeBrowser.tabs.get(tabId)).url).toBe(LOGOUT_URL);

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

  it('wizardOpen for the side panel opens no reorder tab', async () => {
    const before = (await fakeBrowser.tabs.query({})).length;
    const res = await send({ type: 'wizardOpen', queue: ['a@x.com'], panel: true });
    expect(res.data).toMatchObject({ phase: 'confirm', queue: ['a@x.com'] });
    expect(res.data.pageTabId).toBeUndefined();
    expect((await fakeBrowser.tabs.query({})).length).toBe(before);

    // Same from the panel page itself, without the flag.
    const again = await send({ type: 'wizardOpen', queue: ['a@x.com'] }, {
      ...OWN, url: 'chrome-extension://test-extension-id/sidepanel.html',
    });
    expect(again.data.pageTabId).toBeUndefined();
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
    expect(await fakeBrowser.alarms.get('uzero-wizard-expiry')).toBeDefined();
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
    expect(await fakeBrowser.alarms.get('uzero-wizard-expiry')).toBeUndefined();
  });

  it('pauses pin on a host that keeps bouncing a tab', async () => {
    await send({ type: 'refresh' });
    await send({ type: 'savePrefs', patch: { order: ['b@x.com', 'a@x.com'], pinEnabled: true } });
    const tab = await fakeBrowser.tabs.create({ url: 'https://mail.google.com/mail/' });
    const go = (url: string) => fakeBrowser.tabs.onUpdated.trigger(tab.id!, { status: 'loading', url }, { ...tab, url });
    // Google drops the account, pin adds it back: a bare URL, then /u/1/, over and over.
    const bounce = async () => {
      await go('https://mail.google.com/mail/');
      await go('https://mail.google.com/mail/u/1/');
    };
    dnr.updateSessionRules.mockClear();
    await bounce();
    await bounce();
    await sleep(10);
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
    await bounce();
    await vi.waitFor(() => expect(dnr.updateSessionRules).toHaveBeenCalled());
    const arg = dnr.updateSessionRules.mock.calls.at(-1)![0] as { addRules: { condition: { requestDomains: string[] } }[] };
    expect(arg.addRules.map((r) => r.condition.requestDomains)).toEqual([['mail.google.com']]);
    expect(Object.keys(await loopPausesItem.getValue())).toEqual(['mail.google.com']);
    expect(await fakeBrowser.alarms.get('uzero-loop-pauses')).toBeDefined();

    // A tab without our marker, or a host we don't pin, never counts.
    dnr.updateSessionRules.mockClear();
    const bare = await fakeBrowser.tabs.create({ url: 'https://meet.google.com/abc' });
    for (let i = 0; i < 4; i++) {
      const url = i % 2 ? 'https://meet.google.com/abc' : 'https://meet.google.com/abc?authuser=1';
      await fakeBrowser.tabs.onUpdated.trigger(bare.id!, { status: 'loading', url }, { ...bare, url });
    }
    await sleep(10);
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
  });

  it('reloads and in-app navigation on the pinned account never pause pin', async () => {
    await send({ type: 'refresh' });
    await send({ type: 'savePrefs', patch: { order: ['b@x.com', 'a@x.com'], pinEnabled: true } });
    const tab = await fakeBrowser.tabs.create({ url: 'https://mail.google.com/mail/u/1/' });
    const go = (url: string) => fakeBrowser.tabs.onUpdated.trigger(tab.id!, { status: 'loading', url }, { ...tab, url });
    dnr.updateSessionRules.mockClear();
    await go('https://mail.google.com/mail/u/1/');
    // Reloads: same URL, no change.
    for (let i = 0; i < 5; i++) {
      await fakeBrowser.tabs.onUpdated.trigger(tab.id!, { status: 'loading' }, { ...tab, url: 'https://mail.google.com/mail/u/1/' });
    }
    // Moving around inside /mail/u/1/.
    for (const h of ['#inbox', '#sent', '#starred', '#inbox/abc', '#inbox']) await go(`https://mail.google.com/mail/u/1/${h}`);
    // Arriving from another host, or from a bare URL just once, doesn't add up either.
    await go('https://drive.google.com/drive/');
    await go('https://mail.google.com/mail/u/1/');
    await go('https://mail.google.com/mail/');
    await go('https://mail.google.com/mail/u/1/');
    await sleep(10);
    expect(dnr.updateSessionRules).not.toHaveBeenCalled();
    expect(await loopPausesItem.getValue()).toEqual({});
  });

  it('removes every dynamic rule when installing new ones fails', async () => {
    await send({ type: 'refresh' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dnr.updateDynamicRules.mockClear();
    dnr.updateDynamicRules.mockRejectedValueOnce(new Error('quota'));
    await send({ type: 'savePrefs', patch: { order: ['b@x.com', 'a@x.com'], pinEnabled: true } });
    expect(dnr.updateDynamicRules).toHaveBeenCalledTimes(2);
    // Fail closed: no stale redirect may send links to the wrong /u/N.
    expect(dnr.updateDynamicRules.mock.calls[1]![0]).toEqual({ removeRuleIds: [7] });
  });

  it('does not rewrite an unchanged ok status on every refresh', async () => {
    const t0 = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await send({ type: 'refresh' });
    expect(await statusItem.getValue()).toEqual({ kind: 'ok', at: t0 });
    now.mockReturnValue(t0 + 3000);
    await send({ type: 'refresh' });
    expect(await statusItem.getValue()).toEqual({ kind: 'ok', at: t0 });
    // Accounts changed: written right away.
    rows = [row('a@x.com', 0)];
    await send({ type: 'refresh' });
    expect(await statusItem.getValue()).toEqual({ kind: 'ok', at: t0 + 3000 });
    // Nothing changed, but a minute went by.
    now.mockReturnValue(t0 + 3000 + 60_000);
    await send({ type: 'refresh' });
    expect(await statusItem.getValue()).toEqual({ kind: 'ok', at: t0 + 63_000 });
  });

  it('closing the Google tab mid-reorder stops at tab-closed, and Retry opens it again', async () => {
    const { tabId } = await toSigningIn();
    rows = [row('b@x.com', 0)];
    await send({ type: 'refresh' });
    expect(await wizardItem.getValue()).toMatchObject({ phase: 'signing-in', current: 1, tabId });

    // The fake's tabs.remove looks the window up by tab id, so close the tab by event instead.
    await fakeBrowser.tabs.onRemoved.trigger(tabId, { windowId: 0, isWindowClosing: false });
    await vi.waitFor(async () =>
      expect(await wizardItem.getValue()).toMatchObject({ phase: 'error', errorKind: 'tab-closed' }),
    );
    expect((await wizardItem.getValue())?.tabId).toBeUndefined();

    const res = await send({ type: 'wizardRetry' });
    expect(res.data).toMatchObject({ phase: 'signing-in', current: 1, completed: ['b@x.com'] });
    expect(res.data.tabId).not.toBe(tabId);
    expect((await fakeBrowser.tabs.get(res.data.tabId)).url).toContain('/AddSession?Email=a%40x.com');
  });

  it('Continue anyway goes on to sign-in, keeping accounts that stayed signed in', async () => {
    await send({ type: 'refresh' });
    await send({ type: 'wizardOpen', queue: ['b@x.com', 'a@x.com'] });
    const begun = await send({ type: 'wizardBegin' });
    const tabId = begun.data.tabId as number;
    rows = [row('a@x.com', 0)]; // Chrome sync keeps its own account
    await send({ type: 'refresh' });
    expect(await wizardItem.getValue()).toMatchObject({ phase: 'signing-out' });

    const res = await send({ type: 'wizardContinue' });
    expect(res.data).toMatchObject({ phase: 'signing-in', current: 0, kept: ['a@x.com'], tabId });
    expect((await fakeBrowser.tabs.get(tabId)).url).toContain('/AddSession?Email=b%40x.com');

    rows = [row('a@x.com', 0), row('b@x.com', 1)];
    await send({ type: 'refresh' });
    expect(await wizardItem.getValue()).toMatchObject({ phase: 'done', completed: ['a@x.com', 'b@x.com'] });

    // Outside sign-out it changes nothing.
    expect((await send({ type: 'wizardContinue' })).data.phase).toBe('done');
  });

  it('keeps its tab when Logout lands on Google’s home page, but not on a search', async () => {
    await send({ type: 'refresh' });
    await send({ type: 'wizardOpen', queue: ['b@x.com', 'a@x.com'] });
    const begun = await send({ type: 'wizardBegin' });
    const tabId = begun.data.tabId as number;
    await fakeBrowser.tabs.update(tabId, { url: 'https://www.google.com/' });
    rows = [];
    await send({ type: 'refresh' });
    expect(await wizardItem.getValue()).toMatchObject({ phase: 'signing-in', tabId });
    expect((await fakeBrowser.tabs.get(tabId)).url).toContain('/AccountChooser?Email=b%40x.com');

    // The user searched in that tab while it was on Google's home page: it is theirs now.
    await send({ type: 'wizardCancel' });
    rows = [row('a@x.com', 0)];
    await send({ type: 'wizardOpen', queue: ['b@x.com', 'a@x.com'] });
    const again = await send({ type: 'wizardBegin' });
    await fakeBrowser.tabs.update(again.data.tabId, { url: 'https://www.google.com/search?q=lineup' });
    rows = [];
    await send({ type: 'refresh' });
    const w = await wizardItem.getValue();
    expect(w?.tabId).not.toBe(again.data.tabId);
    expect((await fakeBrowser.tabs.get(again.data.tabId)).url).toBe('https://www.google.com/search?q=lineup');
  });
});
