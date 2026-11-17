// Validate messages that reach the background. Anything unexpected is rejected, not coerced.
import type { Prefs, Request } from './types';
import { normalizeEmail, sanitizeEmails } from './accounts';
import { SERVICE_IDS } from './services';

const NO_ARGS = new Set([
  'getState', 'refresh', 'listServices', 'activeTabService',
  'wizardBegin', 'wizardSkip', 'wizardRetry', 'wizardContinue', 'wizardReopen', 'wizardFocusTab', 'wizardCancel',
] as const);

type NoArgType = typeof NO_ARGS extends Set<infer T> ? T : never;

/** A well-formed Request, or null. */
export function parseRequest(msg: unknown): Request | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  const type = m.type;
  if (typeof type !== 'string') return null;

  if (NO_ARGS.has(type as NoArgType)) return { type: type as NoArgType };

  switch (type) {
    case 'savePrefs':
      // Values are validated by applyPrefsPatch; here we only need an object.
      return m.patch && typeof m.patch === 'object' && !Array.isArray(m.patch)
        ? { type, patch: m.patch as Partial<Prefs> }
        : null;
    case 'switchActiveTab': {
      const email = normalizeEmail(m.email);
      return email ? { type, email } : null;
    }
    case 'openService': {
      const email = normalizeEmail(m.email);
      const id = m.serviceId;
      return email && typeof id === 'string' && SERVICE_IDS.has(id) ? { type, serviceId: id, email } : null;
    }
    case 'wizardOpen': {
      if (!Array.isArray(m.queue)) return null;
      const queue = sanitizeEmails(m.queue);
      if (queue.length === 0) return null;
      return m.panel === true ? { type, queue, panel: true } : { type, queue };
    }
    default:
      return null;
  }
}

/** Sender is one of this extension's own pages (popup, options, reorder tab). */
export function isTrustedSender(
  sender: { id?: string; url?: string },
  extensionId: string,
  extensionOrigin: string,
): boolean {
  if (sender.id !== extensionId) return false;
  // General messages require an extension page. Safari overlay frames get further checks in the router.
  return typeof sender.url === 'string' && sender.url.startsWith(extensionOrigin);
}
