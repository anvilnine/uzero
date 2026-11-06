// TEMPORARY Safari spike: try every way to get a ListAccounts answer and log each result.
// Logs status codes and counts only, never account names or emails.
import { browser } from 'wxt/browser';
import { LIST_ACCOUNTS_URL, parseListAccounts } from './accounts';

const TAG = '[uzero-safari probe]';
const PROBE_RULE = 9001;

async function tryFetch(label: string): Promise<void> {
  try {
    const res = await fetch(LIST_ACCOUNTS_URL, { method: 'POST', credentials: 'include', cache: 'no-store' });
    const body = await res.text();
    let n = -1;
    try { n = parseListAccounts(body).length; } catch { /* not parseable */ }
    console.log(TAG, label, 'status', res.status, 'accounts', n);
  } catch (e) {
    console.log(TAG, label, 'threw', String(e));
  }
}

async function withRule(label: string, condition: Record<string, unknown>): Promise<void> {
  try {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [PROBE_RULE],
      addRules: [{
        id: PROBE_RULE, priority: 2,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'https://www.google.com' }] },
        condition: { urlFilter: '||accounts.google.com/ListAccounts', ...condition },
      } as never],
    });
    console.log(TAG, label, 'rule accepted');
  } catch (e) {
    console.log(TAG, label, 'rule rejected', String(e));
    return;
  }
  await tryFetch(label);
  await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [PROBE_RULE] }).catch(() => {});
}

export async function runSafariProbe(): Promise<void> {
  console.log(TAG, 'start; session rules now', (await browser.declarativeNetRequest.getSessionRules().catch(() => [])).length);
  await tryFetch('A0 plain fetch');
  await withRule('A1 no initiator, xhr+other', { resourceTypes: ['xmlhttprequest', 'other'] });
  await withRule('A2 tabIds -1', { tabIds: [-1] });
  await withRule('A3 no condition beyond url', {});

  // B: run the fetch inside an open Google tab, where the request is same-site and carries Google's own Origin.
  try {
    const tabs = await browser.tabs.query({ url: ['https://*.google.com/*'] });
    console.log(TAG, 'B google tabs open', tabs.length);
    const tab = tabs.find((t) => t.id !== undefined);
    if (!tab?.id) { console.log(TAG, 'B skipped: open any google.com page and click the icon again'); return; }
    const [res] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (url: string) => {
        try {
          const r = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store' });
          const t = await r.text();
          return `status ${r.status} bytes ${t.length} rows ${(t.match(/"gaia\.l\.a"/g) ?? []).length}`;
        } catch (e) { return 'threw ' + String(e); }
      },
      args: [LIST_ACCOUNTS_URL],
    });
    console.log(TAG, 'B in-tab fetch on', new URL(tab.url ?? 'https://x').host, '->', res?.result);
  } catch (e) {
    console.log(TAG, 'B failed', String(e));
  }
}
