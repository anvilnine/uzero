// Safari only. Safari never applies DNR header rules to the extension's own requests, so a
// ListAccounts fetch from the background always answers 403. The same fetch run inside a Google
// page answers 200. So read the list through a Google tab the user already has open.
// Never opens a tab: refreshes are triggered by tab loads, and a tab we open would trigger another.
import { browser } from 'wxt/browser';
import { LIST_ACCOUNTS_URL, parseListAccounts } from './accounts';
import type { Account } from './types';

const GOOGLE_TAB = /^https:\/\/([a-z0-9-]+\.)*(google\.com|youtube\.com)\//;

export class NoGoogleTabError extends Error {
  constructor() {
    super('Open any Google page (Gmail, Drive, google.com), then open Uzero again.');
  }
}

/** Google tabs, accounts.google.com first: it is same-origin with ListAccounts. */
async function googleTabs(): Promise<number[]> {
  const tabs = await browser.tabs.query({});
  const google = tabs.filter((t) => t.incognito === false && t.id !== undefined && t.url && GOOGLE_TAB.test(t.url) && t.status === 'complete');
  google.sort((a, b) => Number(new URL(b.url!).host === 'accounts.google.com') - Number(new URL(a.url!).host === 'accounts.google.com'));
  return google.map((t) => t.id!);
}

export async function fetchAccountsViaTab(): Promise<Account[]> {
  const ids = await googleTabs();
  if (!ids.length) throw new NoGoogleTabError();
  let lastError: unknown = new NoGoogleTabError();
  for (const tabId of ids.slice(0, 3)) {
    try {
      const [res] = await browser.scripting.executeScript({
        target: { tabId },
        func: async (url: string) => {
          const r = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store' });
          return { status: r.status, body: await r.text() };
        },
        args: [LIST_ACCOUNTS_URL],
      });
      const out = res?.result as { status: number; body: string } | undefined;
      if (out && out.status === 200) return parseListAccounts(out.body);
      lastError = new Error(`Google answered ${out?.status ?? 'nothing'}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function isGoogleTabUrl(url: string | undefined): boolean {
  return !!url && GOOGLE_TAB.test(url);
}
