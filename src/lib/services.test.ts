import { describe, expect, it } from 'vitest';
import { EXTRA_QUERY_HOSTS, permissionHosts } from './services';
import { findService, isNeverHost, isNeverRewrite, SERVICES, serviceById, underSegment } from './services';

describe('service catalog', () => {
  it('has about 30 services with unique ids', () => {
    expect(SERVICES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SERVICES.map((s) => s.id)).size).toBe(SERVICES.length);
  });

  it.each(SERVICES.map((s) => [s.id, s] as const))('%s is well formed', (_id, s) => {
    const home = new URL(s.home);
    expect(home.protocol).toBe('https:');
    expect(s.hosts.length).toBeGreaterThan(0);
    for (const h of s.hosts) {
      expect(h).toBe(h.toLowerCase());
      // A bare apex would make requestDomains match every subdomain (accounts.google.com too).
      expect(['google.com', 'youtube.com']).not.toContain(h);
      expect(isNeverHost(h)).toBe(false);
    }
    expect(s.hosts).toContain(home.hostname);
    expect(findService(home)?.id).toBe(s.id);
    if (s.style === 'path') expect(s.uAt).toBeDefined();
    if (s.prefix) expect(s.prefix.startsWith('/')).toBe(true);
    for (const p of s.never ?? []) expect(() => new RegExp(p)).not.toThrow();
  });

  it('includes the required services', () => {
    for (const id of [
      'gmail', 'drive', 'docs', 'sheets', 'slides', 'forms', 'calendar', 'meet', 'chat', 'keep', 'photos',
      'contacts', 'youtube', 'youtube-studio', 'cloud', 'firebase', 'analytics', 'ads', 'adsense',
      'search-console', 'tag-manager', 'play-console', 'admin', 'gemini', 'notebooklm', 'sites', 'maps',
      'myaccount', 'classroom', 'looker-studio',
    ]) {
      expect(serviceById(id), id).toBeDefined();
    }
  });

  it('marks the path-style services', () => {
    const path = SERVICES.filter((s) => s.style === 'path').map((s) => s.id).sort();
    expect(path).toEqual(['calendar', 'docs', 'drive', 'forms', 'gmail', 'photos', 'sheets', 'slides']);
  });
});

describe('findService', () => {
  it.each([
    ['https://docs.google.com/spreadsheets/d/abc/edit', 'sheets'],
    ['https://docs.google.com/document/d/abc/edit', 'docs'],
    ['https://docs.google.com/forms/d/e/x/viewform', 'forms'],
    ['https://www.google.com/maps/place/x', 'maps'],
    ['https://www.google.com/maps', 'maps'],
    ['https://play.google.com/console/developers', 'play-console'],
    ['https://m.youtube.com/watch?v=1', 'youtube'],
    ['https://MAIL.google.com/mail/', 'gmail'],
  ])('%s -> %s', (url, id) => expect(findService(new URL(url))?.id).toBe(id));

  it.each([
    ['https://www.google.com/search?q=x'],
    ['https://www.google.com/mapsfoo'],
    ['https://docs.google.com/'],
    ['https://play.google.com/store/apps'],
    ['https://search.google.com/test/rich-results'],
    ['https://accounts.google.com/'],
    ['https://example.com/mail/'],
  ])('%s -> none', (url) => expect(findService(new URL(url))).toBeUndefined());
});

describe('never rewrite', () => {
  it.each([
    ['https://accounts.google.com/ServiceLogin'],
    ['https://ogs.google.com/widget/app'],
    ['https://fonts.gstatic.com/x'],
    ['https://www.googleapis.com/x'],
    ['https://lh3.googleusercontent.com/a/x'],
    ['https://drive.google.com/uc?export=download&id=1'],
    ['https://docs.google.com/document/create'],
    ['https://docs.google.com/spreadsheets/create?usp=x'],
    ['https://docs.google.com/document/d/abc/export?format=pdf'],
    ['https://mail.google.com/mail/logout'],
    ['https://www.youtube.com/logout'],
    ['https://www.youtube.com/signin?next=/'],
    ['https://www.google.com/o/oauth2/auth'],
    ['https://myaccount.google.com/signout'],
  ])('%s', (url) => expect(isNeverRewrite(new URL(url))).toBe(true));

  it.each([
    ['https://drive.google.com/drive/my-drive'],
    ['https://docs.google.com/document/d/create-a-plan/edit'],
    ['https://www.youtube.com/watch?v=signin'],
    ['https://mail.google.com/mail/'],
  ])('%s is fine', (url) => expect(isNeverRewrite(new URL(url))).toBe(false));
});

describe('underSegment', () => {
  it('matches whole segments only', () => {
    expect(underSegment('/mail', '/mail')).toBe(true);
    expect(underSegment('/mail/u/0', '/mail')).toBe(true);
    expect(underSegment('/mailbox', '/mail')).toBe(false);
    expect(underSegment('/anything', '')).toBe(true);
  });
});

describe('permissionHosts', () => {
  const hosts = permissionHosts();
  it('covers every host Uzero routes, switches or reads', () => {
    for (const s of SERVICES) for (const h of s.hosts) expect(hosts).toContain(h);
    for (const h of EXTRA_QUERY_HOSTS) expect(hosts).toContain(h);
    expect(hosts).toContain('accounts.google.com');
    expect(hosts).toContain('myaccount.google.com');
  });
  it('leaves out sensitive account pages Uzero has no use for', () => {
    for (const h of ['passwords.google.com', 'pay.google.com', 'takeout.google.com', 'myactivity.google.com']) {
      expect(hosts).not.toContain(h);
    }
    // Maps lives on www.google.com, so that host stays.
    expect(hosts).toContain('www.google.com');
  });
  it('lists exact hostnames only, no wildcards or bare apex domains', () => {
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const h of hosts) {
      expect(h).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      expect(['google.com', 'youtube.com']).not.toContain(h);
    }
  });
});
