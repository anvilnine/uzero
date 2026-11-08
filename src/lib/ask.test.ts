import { describe, expect, it } from 'vitest';
import {
  ASK_MAX_DISMISSALS,
  ASK_SNOOZE_MS,
  EMPTY_ASK,
  detectStore,
  dismiss,
  feedbackLink,
  rate,
  route,
  sanitizeAsk,
  shareLinks,
  shouldAsk,
} from './ask';

const DAY = 24 * 60 * 60 * 1000;

describe('shouldAsk', () => {
  it('asks a new user', () => {
    expect(shouldAsk(EMPTY_ASK, 0)).toBe(true);
  });
  it('never asks again after a rating', () => {
    expect(shouldAsk(rate(EMPTY_ASK, 2), 0)).toBe(false);
    expect(shouldAsk(rate(EMPTY_ASK, 5), 10_000 * DAY)).toBe(false);
  });
  it('waits out the snooze after "Not now"', () => {
    const s = dismiss(EMPTY_ASK, 1000);
    expect(shouldAsk(s, 1000 + DAY)).toBe(false);
    expect(shouldAsk(s, 1000 + ASK_SNOOZE_MS)).toBe(true);
  });
  it('stops for good after the last "Not now"', () => {
    let s = EMPTY_ASK;
    for (let i = 0; i < ASK_MAX_DISMISSALS; i++) s = dismiss(s, 0);
    expect(shouldAsk(s, 100 * ASK_SNOOZE_MS)).toBe(false);
  });
});

describe('route', () => {
  it('sends 4 and 5 to the store, 1 to 3 to the form', () => {
    expect([1, 2, 3, 4, 5].map(route)).toEqual(['feedback', 'feedback', 'feedback', 'review', 'review']);
  });
});

describe('sanitizeAsk', () => {
  it('drops bad values', () => {
    expect(sanitizeAsk({ rating: 9, dismissals: -1, dismissedAt: 'x' })).toEqual({ dismissals: 0 });
    expect(sanitizeAsk(null)).toEqual({ dismissals: 0 });
    expect(sanitizeAsk({ rating: 4, dismissals: 1, dismissedAt: 5 })).toEqual({ rating: 4, dismissals: 1, dismissedAt: 5 });
  });
});

describe('detectStore', () => {
  it('tells Edge from Chrome on the Chrome build', () => {
    expect(detectStore('chrome', 'Mozilla/5.0 Chrome/140.0 Safari/537.36')).toBe('chrome');
    expect(detectStore('chrome', 'Mozilla/5.0 Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('edge');
    expect(detectStore('edge', '')).toBe('edge');
    expect(detectStore('firefox', '')).toBe('firefox');
  });
  it('has no store for Safari', () => {
    expect(detectStore('safari', '')).toBeNull();
  });
});

describe('feedbackLink', () => {
  it('is empty without a form', () => {
    expect(feedbackLink('', { env: 'prod', source: 'x' })).toBe('');
  });
  it('adds the hidden fields and no personal data', () => {
    const u = new URL(feedbackLink('https://forms.zonily.cloud/form/abc', { env: 'prod', source: 'reorder-done', version: '0.1.0', locale: 'en-US' }));
    expect(Object.fromEntries(u.searchParams)).toEqual({ app: 'uzero', env: 'prod', source: 'reorder-done', version: '0.1.0', locale: 'en-US' });
  });
});

describe('shareLinks', () => {
  it('links to uzero.app on every network', () => {
    for (const l of shareLinks()) expect(decodeURIComponent(l.href)).toContain('https://uzero.app/');
  });
});
