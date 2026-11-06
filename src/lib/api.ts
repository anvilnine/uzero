// UI client -> background messages.
// In a plain browser tab (design preview, no extension runtime) the mock is used; it is only
// bundled in non-production builds (`pnpm build:preview`, `pnpm dev`).
import type { AppState, Envelope, Request, Response } from './types';

type Listener = (state: AppState) => void;

export interface Api {
  send<T extends Request['type']>(req: Extract<Request, { type: T }>): Promise<Response<T>>;
  /** Fires whenever prefs, accounts, status or wizard change in storage. */
  subscribe(fn: Listener): () => void;
}

function inExtension(): boolean {
  return typeof browser !== 'undefined' && !!browser.runtime?.id;
}

const real: Api = {
  async send(req) {
    const res = (await browser.runtime.sendMessage(req)) as Envelope<any> | undefined;
    if (!res) throw new Error('No response from background');
    if (!res.ok) throw new Error(res.error);
    return res.data;
  },
  subscribe(fn) {
    // A burst of storage writes (refresh writes accounts, prefs, status...) becomes one getState,
    // and a slow answer never overwrites a newer one.
    let scheduled = false;
    let closed = false;
    let seq = 0;
    let applied = 0;
    const pull = async () => {
      scheduled = false;
      const mine = ++seq;
      try {
        const state = await real.send({ type: 'getState' });
        if (closed || mine < applied) return;
        applied = mine;
        fn(state);
      } catch {
        /* the next change tries again */
      }
    };
    const onChange = () => {
      if (scheduled || closed) return;
      scheduled = true;
      queueMicrotask(() => void pull());
    };
    browser.storage.onChanged.addListener(onChange);
    return () => {
      closed = true;
      browser.storage.onChanged.removeListener(onChange);
    };
  },
};

let cached: Promise<Api> | null = null;

export function getApi(): Promise<Api> {
  if (!cached) {
    if (inExtension()) cached = Promise.resolve(real);
    else if (import.meta.env.MODE !== 'production') cached = import('./api.mock').then((m) => m.mockApi);
    else cached = Promise.reject(new Error('Open Uzero from the browser toolbar.'));
  }
  return cached;
}
