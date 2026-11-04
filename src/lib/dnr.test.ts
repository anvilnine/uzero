import { describe, expect, it } from 'vitest';
import type { Account, Prefs } from './types';
import { DEFAULT_PREFS } from './types';
import {
  buildRules, countRegexRules, escapeRe2, GOOGLE_INITIATORS, LOOP_RULE_BASE_ID, loopAllowRules, MAX_REGEX_RULES,
  namesAccount, originRule, pinnedHosts, PRIORITY_ALLOW, PRIORITY_PATH, recordHit, serviceTargets,
  type DnrRule,
} from './dnr';
import { defaultEmail, pinEmail } from './accounts';
import { SERVICES } from './services';

const acct = (email: string, index: number, signedOut = false): Account => ({
  email, name: '', photo: '', index: signedOut ? -1 : index, signedOut,
});

const ACCOUNTS: Account[] = [acct('a@x.com', 0), acct('b@x.com', 1), acct('c@x.com', 2), acct('gone@x.com', -1, true)];

const prefs = (p: Partial<Prefs> = {}): Prefs => ({
  ...DEFAULT_PREFS,
  order: ['b@x.com', 'a@x.com', 'c@x.com'],
  pinEnabled: true,
  ...p,
});

/** Tiny DNR simulator: highest priority wins, allow beats redirect on ties. Returns the new URL or null. */
function simulate(rules: DnrRule[], input: string, initiator?: string): string | null {
  const url = new URL(input);
  const host = url.hostname;
  const under = (h: string, d: string) => h === d || h.endsWith(`.${d}`);
  const matches = rules.filter((r) => {
    const c = r.condition;
    if (!c.resourceTypes.includes('main_frame')) return false;
    if (initiator && c.excludedInitiatorDomains?.some((d) => under(initiator, d))) return false;
    if (c.requestDomains && !c.requestDomains.some((d) => host === d || host.endsWith(`.${d}`))) return false;
    if (c.regexFilter && !new RegExp(c.regexFilter, c.isUrlFilterCaseSensitive === false ? 'i' : '').test(input)) return false;
    return true;
  });
  if (matches.length === 0) return null;
  const top = Math.max(...matches.map((r) => r.priority));
  const winners = matches.filter((r) => r.priority === top);
  const allow = winners.find((r) => r.action.type === 'allow');
  if (allow) return null;
  const rule = winners[0]!;
  if (rule.action.type !== 'redirect') return null;
  const redirect = rule.action.redirect;
  if ('regexSubstitution' in redirect) {
    const re = new RegExp(rule.condition.regexFilter!, 'i');
    const m = re.exec(input)!;
    return redirect.regexSubstitution.replace(/\\(\d)/g, (_, n: string) => m[Number(n)] ?? '');
  }
  for (const { key, value } of redirect.transform.queryTransform.addOrReplaceParams) url.searchParams.set(key, value);
  return url.href;
}

/** Follow redirects like the browser would, up to a loop limit. */
function navigate(rules: DnrRule[], input: string, initiator?: string): string {
  let url = input;
  for (let i = 0; i < 5; i++) {
    const next = simulate(rules, url, initiator);
    if (next === null) return url;
    url = next;
  }
  throw new Error(`redirect loop at ${url}`);
}

describe('buildRules', () => {
  const rules = buildRules(prefs(), ACCOUNTS);

  it('is empty when pin mode is off', () => {
    expect(buildRules(prefs({ pinEnabled: false }), ACCOUNTS)).toEqual([]);
  });

  it('is empty when the default is already Google #0', () => {
    expect(buildRules(prefs({ order: ['a@x.com'] }), ACCOUNTS)).toEqual([]);
  });

  it('is empty when the default is signed out or unknown', () => {
    expect(buildRules(prefs({ order: ['gone@x.com'] }), ACCOUNTS)).toEqual([]);
    expect(buildRules(prefs({ order: ['nobody@x.com'] }), ACCOUNTS)).toEqual([]);
    expect(buildRules(prefs({ order: [] }), ACCOUNTS)).toEqual([]);
  });

  it('gives every rule a unique positive integer id', () => {
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Number.isInteger(id) && id > 0).toBe(true);
  });

  it('ranks allow rules above every redirect', () => {
    const redirects = rules.filter((r) => r.action.type === 'redirect');
    const allows = rules.filter((r) => r.action.type === 'allow');
    expect(allows.length).toBeGreaterThan(0);
    const maxRedirect = Math.max(...redirects.map((r) => r.priority));
    for (const a of allows) expect(a.priority).toBe(PRIORITY_ALLOW);
    expect(PRIORITY_ALLOW).toBeGreaterThan(maxRedirect);
  });

  it('only touches GET main_frame navigations', () => {
    for (const r of rules) {
      expect(r.condition.resourceTypes).toEqual(['main_frame']);
      if (r.action.type === 'redirect') expect(r.condition.requestMethods).toEqual(['get']);
      expect(r.condition.requestDomains?.length).toBeGreaterThan(0);
    }
  });

  it('keeps regex rules well under the limit and RE2 friendly', () => {
    expect(countRegexRules(rules)).toBeLessThan(60);
    expect(countRegexRules(rules)).toBeLessThan(MAX_REGEX_RULES);
    for (const r of rules) {
      const re = r.condition.regexFilter;
      if (!re) continue;
      expect(() => new RegExp(re)).not.toThrow();
      expect(re).not.toMatch(/\(\?[=!<]/); // no lookaround
      expect(re).not.toMatch(/\\[1-9]/); // no backreferences
    }
  });

  it('never targets accounts, static or API hosts', () => {
    const domains = rules.flatMap((r) => r.condition.requestDomains ?? []);
    for (const bad of ['accounts.google.com', 'google.com', 'youtube.com', 'ogs.google.com', 'gstatic.com', 'googleapis.com']) {
      expect(domains).not.toContain(bad);
    }
  });

  it('skips disabled services', () => {
    const r = buildRules(prefs({ disabledServices: ['meet'] }), ACCOUNTS);
    expect(navigate(r, 'https://meet.google.com/abc')).toBe('https://meet.google.com/abc');
    expect(navigate(r, 'https://chat.google.com/')).toBe('https://chat.google.com/?authuser=1');
  });

  it('lets a per-service override win over order[0]', () => {
    const r = buildRules(prefs({ serviceDefaults: { gmail: 'c@x.com', meet: 'a@x.com' } }), ACCOUNTS);
    expect(navigate(r, 'https://mail.google.com/mail/')).toBe('https://mail.google.com/mail/u/2/');
    // Override to Google #0 means "leave alone".
    expect(navigate(r, 'https://meet.google.com/abc')).toBe('https://meet.google.com/abc');
    expect(navigate(r, 'https://drive.google.com/drive/')).toBe('https://drive.google.com/drive/u/1/');
  });

  it('falls back to the default when an override is signed out', () => {
    const r = buildRules(prefs({ serviceDefaults: { gmail: 'gone@x.com' } }), ACCOUNTS);
    expect(navigate(r, 'https://mail.google.com/mail/')).toBe('https://mail.google.com/mail/u/1/');
  });

  it('uses the first signed-in account in the order when #1 is signed out', () => {
    const r = buildRules(prefs({ order: ['gone@x.com', 'c@x.com', 'b@x.com'] }), ACCOUNTS);
    expect(navigate(r, 'https://mail.google.com/mail/')).toBe('https://mail.google.com/mail/u/2/');
    expect(navigate(r, 'https://meet.google.com/abc')).toBe('https://meet.google.com/abc?authuser=2');
  });

  it('only routes links from outside Google (other sites, bookmarks, typed URLs)', () => {
    const redirects = rules.filter((r) => r.action.type === 'redirect');
    expect(redirects.length).toBeGreaterThan(0);
    for (const r of redirects) expect(r.condition.excludedInitiatorDomains).toEqual(GOOGLE_INITIATORS);
    for (const r of rules.filter((x) => x.action.type === 'allow')) {
      expect(r.condition.excludedInitiatorDomains).toBeUndefined();
    }
    expect(GOOGLE_INITIATORS).toEqual(['google.com', 'youtube.com']);
    // No initiator (typed, bookmark, other app) and other sites: routed.
    expect(navigate(rules, 'https://mail.google.com/mail/')).toBe('https://mail.google.com/mail/u/1/');
    expect(navigate(rules, 'https://mail.google.com/mail/', 'news.ycombinator.com')).toBe('https://mail.google.com/mail/u/1/');
    // Google's own links: left alone.
    expect(navigate(rules, 'https://mail.google.com/mail/', 'www.google.com')).toBe('https://mail.google.com/mail/');
    expect(navigate(rules, 'https://meet.google.com/abc', 'calendar.google.com')).toBe('https://meet.google.com/abc');
    expect(navigate(rules, 'https://www.youtube.com/', 'm.youtube.com')).toBe('https://www.youtube.com/');
  });

  it('can pin services even when order[0] is Google #0', () => {
    const r = buildRules(prefs({ order: ['a@x.com'], serviceDefaults: { meet: 'b@x.com' } }), ACCOUNTS);
    expect(r.length).toBeGreaterThan(0);
    expect(navigate(r, 'https://meet.google.com/abc')).toBe('https://meet.google.com/abc?authuser=1');
    expect(navigate(r, 'https://mail.google.com/mail/')).toBe('https://mail.google.com/mail/');
  });

  it.each([
    ['https://mail.google.com/mail/', 'https://mail.google.com/mail/u/1/'],
    ['https://mail.google.com/mail', 'https://mail.google.com/mail/u/1/'],
    ['https://mail.google.com/', 'https://mail.google.com/?authuser=1'],
    ['https://drive.google.com/drive/folders/X', 'https://drive.google.com/drive/u/1/folders/X'],
    ['https://drive.google.com/file/d/X/view', 'https://drive.google.com/file/d/X/view?authuser=1'],
    ['https://docs.google.com/document/d/X/edit', 'https://docs.google.com/document/u/1/d/X/edit'],
    ['https://docs.google.com/spreadsheets/d/X/edit?usp=sharing', 'https://docs.google.com/spreadsheets/u/1/d/X/edit?usp=sharing'],
    ['https://calendar.google.com/calendar/r', 'https://calendar.google.com/calendar/u/1/r'],
    ['https://photos.google.com/', 'https://photos.google.com/u/1/'],
    ['https://meet.google.com/abc-defg-hij', 'https://meet.google.com/abc-defg-hij?authuser=1'],
    ['https://www.youtube.com/watch?v=1', 'https://www.youtube.com/watch?v=1&authuser=1'],
    ['https://www.google.com/maps/place/X', 'https://www.google.com/maps/place/X?authuser=1'],
    ['https://search.google.com/search-console?resource_id=x', 'https://search.google.com/search-console?resource_id=x&authuser=1'],
  ])('redirects %s', (input, out) => {
    expect(navigate(rules, input)).toBe(out);
  });

  it.each([
    // Already names an account
    ['https://mail.google.com/mail/u/0/'],
    ['https://meet.google.com/abc?authuser=0'],
    ['https://docs.google.com/document/u/0/d/X/edit'],
    // Never-rewrite paths
    ['https://drive.google.com/uc?export=download&id=1'],
    ['https://docs.google.com/document/create'],
    ['https://www.youtube.com/logout'],
    ['https://myaccount.google.com/signout'],
    // Not ours
    ['https://accounts.google.com/ServiceLogin'],
    ['https://www.google.com/search?q=maps'],
    ['https://www.google.com/mapsx'],
    ['https://play.google.com/store/apps'],
    ['https://studio.youtube.com.evil.com/'],
  ])('leaves %s alone', (input) => {
    expect(navigate(rules, input)).toBe(input);
  });

  it('cannot loop: a redirected URL is always allowed next time', () => {
    for (const s of SERVICES) {
      const once = simulate(rules, s.home);
      if (once) expect(simulate(rules, once), s.id).toBeNull();
    }
  });
});

describe('serviceTargets', () => {
  it('resolves emails to the current Google index', () => {
    const t = serviceTargets(prefs({ serviceDefaults: { gmail: 'c@x.com' } }), ACCOUNTS);
    const byId = new Map([...t].map(([s, n]) => [s.id, n]));
    expect(byId.get('gmail')).toBe(2);
    expect(byId.get('drive')).toBe(1);
  });
});

describe('escapeRe2', () => {
  it('escapes regex metacharacters', () => {
    const raw = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    const re = new RegExp(`^${escapeRe2(raw)}$`);
    expect(re.test(raw)).toBe(true);
    expect(re.test('aXb*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(false);
  });

  it('host dots are literal in generated rules', () => {
    const rules = buildRules(prefs(), ACCOUNTS);
    const gmail = rules.find((r) => r.condition.regexFilter?.includes('mail\\.google\\.com'));
    expect(gmail).toBeDefined();
    expect(simulate(rules, 'https://mailxgoogle.com/mail/')).toBeNull();
  });
});

describe('originRule', () => {
  it('sets Origin for our own ListAccounts calls only', () => {
    const r = originRule('abcdefghijklmnop');
    expect(r.action).toEqual({
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'origin', operation: 'set', value: 'https://www.google.com' }],
    });
    expect(r.condition.initiatorDomains).toEqual(['abcdefghijklmnop']);
    expect(r.condition.urlFilter).toBe('||accounts.google.com/ListAccounts');
    expect(r.condition.resourceTypes).toEqual(['xmlhttprequest', 'other']);
  });
});

describe('pin target (shared with the UI)', () => {
  it('defaultEmail is the first signed-in email in the order', () => {
    expect(defaultEmail(['b@x.com', 'a@x.com'], ACCOUNTS)).toBe('b@x.com');
    expect(defaultEmail(['gone@x.com', 'nobody@x.com', 'c@x.com'], ACCOUNTS)).toBe('c@x.com');
    expect(defaultEmail([], ACCOUNTS)).toBe('a@x.com');
    expect(defaultEmail(['a@x.com'], [])).toBeUndefined();
  });

  it('pinEmail prefers a signed-in override, else the default', () => {
    const p = prefs({ serviceDefaults: { gmail: 'c@x.com', meet: 'gone@x.com' } });
    expect(pinEmail(p, ACCOUNTS, 'gmail')).toBe('c@x.com');
    expect(pinEmail(p, ACCOUNTS, 'meet')).toBe('b@x.com');
    expect(pinEmail(p, ACCOUNTS)).toBe('b@x.com');
  });
});

describe('loop breaker', () => {
  it('builds session allow rules that outrank every pin rule', () => {
    const r = loopAllowRules(['mail.google.com', 'meet.google.com', 'mail.google.com']);
    expect(r).toEqual([
      { id: LOOP_RULE_BASE_ID, priority: PRIORITY_ALLOW + 1, action: { type: 'allow' }, condition: { requestDomains: ['mail.google.com'], resourceTypes: ['main_frame'] } },
      { id: LOOP_RULE_BASE_ID + 1, priority: PRIORITY_ALLOW + 1, action: { type: 'allow' }, condition: { requestDomains: ['meet.google.com'], resourceTypes: ['main_frame'] } },
    ]);
    expect(PRIORITY_ALLOW + 1).toBeGreaterThan(PRIORITY_PATH);
    // With the pause in place, a bare Gmail link is left alone.
    expect(navigate([...buildRules(prefs(), ACCOUNTS), ...r], 'https://mail.google.com/mail/')).toBe('https://mail.google.com/mail/');
    expect(loopAllowRules([])).toEqual([]);
  });

  it('maps pinned hosts to their index', () => {
    const hosts = pinnedHosts(prefs({ serviceDefaults: { meet: 'c@x.com' } }), ACCOUNTS);
    expect(hosts.get('mail.google.com')).toBe(1);
    expect(hosts.get('meet.google.com')).toBe(2);
    expect(hosts.get('www.youtube.com')).toBe(1);
    expect(hosts.has('accounts.google.com')).toBe(false);
    expect(pinnedHosts(prefs({ pinEnabled: false }), ACCOUNTS).size).toBe(0);
  });

  it('recognises the account marker pin mode adds', () => {
    expect(namesAccount('https://mail.google.com/mail/u/1/', 1)).toBe(true);
    expect(namesAccount('https://mail.google.com/mail/u/1', 1)).toBe(true);
    expect(namesAccount('https://meet.google.com/x?authuser=1', 1)).toBe(true);
    expect(namesAccount('https://mail.google.com/mail/u/12/', 1)).toBe(false);
    expect(namesAccount('https://meet.google.com/x?authuser=0', 1)).toBe(false);
    expect(namesAccount('not a url', 1)).toBe(false);
  });

  it('flags 3 hits within 3 seconds, not slower ones', () => {
    let h = recordHit([], 0);
    expect(h.loop).toBe(false);
    h = recordHit(h.hits, 1000);
    expect(h.loop).toBe(false);
    h = recordHit(h.hits, 2500);
    expect(h.loop).toBe(true);
    const slow = recordHit(recordHit([0], 2000).hits, 4100);
    expect(slow).toEqual({ hits: [2000, 4100], loop: false });
  });
});
