// Pure builders for declarativeNetRequest rules.
// "Allow rules outrank redirects instead of a negative lookahead" comes from authusher (MIT);
// RE2 has no lookahead.
import type { Account, Prefs } from './types';
import { indexByEmail, pinEmail } from './accounts';
import { GLOBAL_NEVER_PATHS, SERVICES, type Service } from './services';

type ResourceType = 'main_frame' | 'xmlhttprequest' | 'other';

export interface DnrCondition {
  regexFilter?: string;
  urlFilter?: string;
  requestDomains?: string[];
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  resourceTypes: ResourceType[];
  requestMethods?: 'get'[];
  isUrlFilterCaseSensitive?: boolean;
}

export type DnrAction =
  | { type: 'allow' }
  | { type: 'redirect'; redirect: { regexSubstitution: string } }
  | {
      type: 'redirect';
      redirect: { transform: { queryTransform: { addOrReplaceParams: { key: string; value: string }[] } } };
    }
  | { type: 'modifyHeaders'; requestHeaders: { header: string; operation: 'set'; value: string }[] };

/** Structural copy of chrome.declarativeNetRequest.Rule (whose enums don't accept string literals). */
export interface DnrRule {
  id: number;
  priority: number;
  action: DnrAction;
  condition: DnrCondition;
}

export const PRIORITY_ALLOW = 100;
export const PRIORITY_PATH = 2;
export const PRIORITY_QUERY = 1;
/** Chrome's MAX_NUMBER_OF_REGEX_RULES. We stay far below it. */
export const MAX_REGEX_RULES = 1000;

/** Escape a literal for RE2 (and JS) regexes. */
export function escapeRe2(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const hostGroup = (hosts: readonly string[]) => `(${hosts.map(escapeRe2).join('|')})`;

/** Session rule: ListAccounts answers 403 to an extension Origin, so present as google.com. */
export function originRule(extensionId: string, id = 1): DnrRule {
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'origin', operation: 'set', value: 'https://www.google.com' }],
    },
    condition: {
      urlFilter: '||accounts.google.com/ListAccounts',
      initiatorDomains: [extensionId],
      resourceTypes: ['xmlhttprequest', 'other'],
    },
  };
}

/** Which Google index each enabled service should open in. Services with nothing to do are left out. */
export function serviceTargets(prefs: Prefs, accounts: readonly Account[], services = SERVICES): Map<Service, number> {
  const out = new Map<Service, number>();
  if (!prefs.pinEnabled) return out;
  const index = indexByEmail(accounts);
  const disabled = new Set(prefs.disabledServices);
  for (const s of services) {
    if (disabled.has(s.id)) continue;
    // Signed-out picks fall back the same way the UI explains it (first signed-in in your order).
    const email = pinEmail(prefs, accounts, s.id);
    const n = email === undefined ? undefined : index.get(email);
    // Index 0 is what Google picks anyway.
    if (n !== undefined && n > 0) out.set(s, n);
  }
  return out;
}

const get: 'get'[] = ['get'];
const main: ResourceType[] = ['main_frame'];
/**
 * Pin only routes links that come from outside Google (other sites, bookmarks, typed URLs, other apps).
 * Google's own in-app links already carry the account the user is in. Subdomains are included.
 */
export const GOOGLE_INITIATORS = ['google.com', 'youtube.com'];
const fromOutside = () => [...GOOGLE_INITIATORS];

/** Every dynamic rule for pin mode. Ids start at 1 and are unique. */
export function buildRules(prefs: Prefs, accounts: readonly Account[], services = SERVICES): DnrRule[] {
  const targets = serviceTargets(prefs, accounts, services);
  if (targets.size === 0) return [];

  const rules: DnrRule[] = [];
  const add = (priority: number, action: DnrAction, condition: DnrCondition) =>
    rules.push({ id: rules.length + 1, priority, action, condition });
  const allow = (domains: string[], regexFilter: string) =>
    add(PRIORITY_ALLOW, { type: 'allow' }, {
      regexFilter, requestDomains: domains, resourceTypes: main, isUrlFilterCaseSensitive: false,
    });

  const allHosts = [...new Set([...targets.keys()].flatMap((s) => s.hosts))].sort();

  // 1. Loop guard: a URL that already names an account is left alone.
  allow(allHosts, '[?&]authuser=|/u/[0-9]');
  // 2. Sign-in, sign-out, OAuth.
  allow(allHosts, `^https?://[^/]+(?:${GLOBAL_NEVER_PATHS.join('|')})`);
  // 3. Per-service never-rewrite paths (deduped: Docs/Sheets/Slides/Forms share one list).
  const seen = new Set<string>();
  for (const s of targets.keys()) {
    if (!s.never?.length) continue;
    const regex = `^https?://[^/]+(?:${s.never.join('|')})`;
    const key = `${s.hosts.join(',')} ${regex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allow([...s.hosts], regex);
  }

  // 4. Redirects.
  for (const [s, n] of targets) {
    const authuser: DnrAction = {
      type: 'redirect',
      redirect: { transform: { queryTransform: { addOrReplaceParams: [{ key: 'authuser', value: String(n) }] } } },
    };
    if (s.style === 'path') {
      const uAt = s.uAt ?? '';
      add(PRIORITY_PATH, { type: 'redirect', redirect: { regexSubstitution: `https://\\1${uAt}/u/${n}/\\2` } }, {
        regexFilter: `^https?://${hostGroup(s.hosts)}${escapeRe2(uAt)}(?:/(.*))?$`,
        requestDomains: [...s.hosts], excludedInitiatorDomains: fromOutside(),
        resourceTypes: main, requestMethods: get, isUrlFilterCaseSensitive: false,
      });
      if (s.queryElsewhere) {
        add(PRIORITY_QUERY, authuser, {
          requestDomains: [...s.hosts], excludedInitiatorDomains: fromOutside(), resourceTypes: main, requestMethods: get,
        });
      }
    } else if (s.prefix) {
      add(PRIORITY_QUERY, authuser, {
        regexFilter: `^https?://${hostGroup(s.hosts)}${escapeRe2(s.prefix)}(?:[/?]|$)`,
        requestDomains: [...s.hosts], excludedInitiatorDomains: fromOutside(),
        resourceTypes: main, requestMethods: get, isUrlFilterCaseSensitive: false,
      });
    } else {
      add(PRIORITY_QUERY, authuser, {
        requestDomains: [...s.hosts], excludedInitiatorDomains: fromOutside(), resourceTypes: main, requestMethods: get,
      });
    }
  }
  return rules;
}

// ---- Loop breaker -------------------------------------------------------------

/** Session rule ids for loop-breaker allow rules (the Origin rule is id 1). */
export const LOOP_RULE_BASE_ID = 1000;
export const LOOP_MAX_HOSTS = 50;
export const LOOP_HITS = 3;
export const LOOP_WINDOW_MS = 3000;
export const LOOP_PAUSE_MS = 10 * 60_000;

/** Session `allow` rules that pause pin mode on hosts caught in a redirect loop. */
export function loopAllowRules(hosts: readonly string[], baseId = LOOP_RULE_BASE_ID): DnrRule[] {
  return [...new Set(hosts)].sort().slice(0, LOOP_MAX_HOSTS).map((host, i) => ({
    id: baseId + i,
    priority: PRIORITY_ALLOW + 1,
    action: { type: 'allow' },
    condition: { requestDomains: [host], resourceTypes: main },
  }));
}

/** Pinned host -> the index pin mode sends it to. */
export function pinnedHosts(prefs: Prefs, accounts: readonly Account[], services = SERVICES): Map<string, number> {
  const out = new Map<string, number>();
  for (const [s, n] of serviceTargets(prefs, accounts, services)) for (const h of s.hosts) out.set(h, n);
  return out;
}

/** The URL names account `n` the way pin mode would add it (?authuser=n or /u/n/). */
export function namesAccount(url: string, n: number): boolean {
  try {
    const u = new URL(url);
    return u.searchParams.get('authuser') === String(n) || new RegExp(`/u/${n}(?:/|$)`).test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Record one navigation of a tab to `host` at `now`. Returns the hits still inside the window
 * and whether this looks like a loop (LOOP_HITS or more within LOOP_WINDOW_MS).
 */
export function recordHit(
  hits: readonly number[],
  now: number,
  windowMs = LOOP_WINDOW_MS,
  limit = LOOP_HITS,
): { hits: number[]; loop: boolean } {
  const kept = [...hits.filter((t) => now - t < windowMs), now];
  return { hits: kept, loop: kept.length >= limit };
}

export function countRegexRules(rules: readonly DnrRule[]): number {
  return rules.filter((r) => r.condition.regexFilter !== undefined).length;
}

/** Safari cannot scope DNR rules to normal tabs (tabIds is unsupported). Never install
 * global Pin rules there, even if private access is currently off: that permission can change. */
export const SAFARI_PIN_UNAVAILABLE = 'Pin is unavailable in Safari: Safari cannot exclude private windows from link rules. Your settings are saved. Other Uzero features still work.';
