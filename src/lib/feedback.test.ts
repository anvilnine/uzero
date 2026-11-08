import { describe, expect, it } from 'vitest';
import { formLink } from './feedback';

const BASE = 'https://forms.zonily.cloud/form/abc123';

describe('formLink', () => {
  it('returns an empty string while the form URL is blank', () => {
    expect(formLink('', { env: 'prod', source: 'options' })).toBe('');
  });

  it('adds the hidden fields from the feedback-forms contract', () => {
    const u = new URL(formLink(BASE, { env: 'prod', source: 'options', version: '1.2.0', locale: 'en-US' }));
    expect(u.origin + u.pathname).toBe(BASE);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      app: 'uzero',
      env: 'prod',
      source: 'options',
      version: '1.2.0',
      locale: 'en-US',
    });
  });

  it('leaves out optional fields that are missing and never sends user fields', () => {
    const u = new URL(formLink(BASE, { env: 'dev', source: 'options' }));
    expect([...u.searchParams.keys()]).toEqual(['app', 'env', 'source']);
  });
});
