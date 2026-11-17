import { describe, expect, it } from 'vitest';
import { isTrustedSender, parseRequest } from './messages';

describe('parseRequest', () => {
  it.each([
    'getState', 'refresh', 'listServices', 'activeTabService', 'wizardBegin', 'wizardSkip', 'wizardRetry', 'wizardContinue', 'wizardReopen', 'wizardFocusTab', 'wizardCancel',
  ])('accepts %s and drops extra fields', (type) => {
    expect(parseRequest({ type, junk: 1 })).toEqual({ type });
  });

  it('validates arguments', () => {
    expect(parseRequest({ type: 'switchActiveTab', email: 'A@x.com' })).toEqual({ type: 'switchActiveTab', email: 'a@x.com' });
    expect(parseRequest({ type: 'switchActiveTab', email: 'nope' })).toBeNull();
    expect(parseRequest({ type: 'openService', serviceId: 'gmail', email: 'a@x.com' })).toEqual({
      type: 'openService', serviceId: 'gmail', email: 'a@x.com',
    });
    expect(parseRequest({ type: 'openService', serviceId: 'evil', email: 'a@x.com' })).toBeNull();
    expect(parseRequest({ type: 'wizardOpen', queue: ['B@x.com', 'bad'] })).toEqual({ type: 'wizardOpen', queue: ['b@x.com'] });
    expect(parseRequest({ type: 'wizardOpen', queue: ['a@x.com'], panel: true })).toEqual({
      type: 'wizardOpen',
      queue: ['a@x.com'],
      panel: true,
    });
    expect(parseRequest({ type: 'wizardOpen', queue: ['a@x.com'], panel: 'yes' })).toEqual({ type: 'wizardOpen', queue: ['a@x.com'] });
    expect(parseRequest({ type: 'wizardOpen', queue: [] })).toBeNull();
    expect(parseRequest({ type: 'wizardOpen', queue: 'a@x.com' })).toBeNull();
    expect(parseRequest({ type: 'wizardQueue', queue: ['A@x.com', 'a@x.com', 'bad'] })).toEqual({ type: 'wizardQueue', queue: ['a@x.com'] });
    expect(parseRequest({ type: 'wizardQueue', queue: [] })).toEqual({ type: 'wizardQueue', queue: [] });
    expect(parseRequest({ type: 'wizardQueue' })).toBeNull();
    expect(parseRequest({ type: 'savePrefs', patch: { pinEnabled: true } })).toEqual({ type: 'savePrefs', patch: { pinEnabled: true } });
    expect(parseRequest({ type: 'savePrefs', patch: [] })).toBeNull();
    expect(parseRequest({ type: 'savePrefs' })).toBeNull();
  });

  it.each([[null], [undefined], ['getState'], [{}], [{ type: 'deleteEverything' }], [{ type: 7 }], [{ type: 'toString' }]])(
    'rejects %j',
    (msg) => expect(parseRequest(msg)).toBeNull(),
  );
});

describe('isTrustedSender', () => {
  const id = 'abc';
  const origin = 'chrome-extension://abc/';
  it('accepts our own pages', () => {
    expect(isTrustedSender({ id, url: 'chrome-extension://abc/popup.html' }, id, origin)).toBe(true);
    expect(isTrustedSender({ id, url: 'chrome-extension://abc/reorder.html' }, id, origin)).toBe(true);
  });
  it('rejects other extensions and web pages', () => {
    expect(isTrustedSender({ id: 'other', url: 'chrome-extension://other/x.html' }, id, origin)).toBe(false);
    expect(isTrustedSender({ id, url: 'https://evil.com/' }, id, origin)).toBe(false);
    expect(isTrustedSender({ id }, id, origin)).toBe(false);
    expect(isTrustedSender({}, id, origin)).toBe(false);
  });
});
