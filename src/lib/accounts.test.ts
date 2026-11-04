import { describe, expect, it, vi } from 'vitest';
import {
  fetchAccounts, indexByEmail, LIST_ACCOUNTS_URL, normalizeEmail, parseListAccounts, safePhoto, sanitizeEmails,
} from './accounts';

/** Build a ListAccounts row the way Chromium lays it out. */
function row(o: { email: unknown; name?: unknown; photo?: unknown; index?: unknown; valid?: number; signedOut?: number }) {
  const r: unknown[] = new Array(15).fill(null);
  r[0] = 'gaia.l.a';
  r[1] = 1;
  r[2] = o.name ?? 'Name';
  r[3] = o.email;
  r[4] = o.photo ?? 'https://lh3.googleusercontent.com/a/x=s48-c';
  r[7] = o.index;
  r[9] = o.valid ?? 1;
  r[10] = '1234567890';
  r[14] = o.signedOut ?? 0;
  return r;
}

const body = (rows: unknown[]) => JSON.stringify(['gaia.l.a.r', rows]);

describe('normalizeEmail', () => {
  it.each([
    ['Alice@Example.COM', 'alice@example.com'],
    ['  bob@gmail.com ', 'bob@gmail.com'],
  ])('accepts %s', (input, out) => expect(normalizeEmail(input)).toBe(out));

  it.each([['nope'], ['a@b'], [''], ['a b@c.com'], [42], [null], [`${'a'.repeat(250)}@x.com`], ['<a@b.com>']])(
    'rejects %s',
    (input) => expect(normalizeEmail(input)).toBeNull(),
  );

  it('sanitizeEmails dedupes and drops junk', () => {
    expect(sanitizeEmails(['A@x.com', 'a@x.com', 'bad', 3, 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
    expect(sanitizeEmails('a@x.com')).toEqual([]);
  });
});

describe('parseListAccounts', () => {
  it('parses the signed-out body', () => {
    expect(parseListAccounts('["gaia.l.a.r",[]]')).toEqual([]);
  });

  it('reads email, name, photo and explicit index', () => {
    const out = parseListAccounts(
      body([row({ email: 'A@x.com', name: 'Ann', index: 0 }), row({ email: 'b@x.com', name: 'Bo', index: 1 })]),
    );
    expect(out).toEqual([
      { email: 'a@x.com', name: 'Ann', photo: 'https://lh3.googleusercontent.com/a/x=s48-c', index: 0, signedOut: false },
      { email: 'b@x.com', name: 'Bo', photo: 'https://lh3.googleusercontent.com/a/x=s48-c', index: 1, signedOut: false },
    ]);
  });

  it('counts signed-in rows when row[7] is missing', () => {
    const out = parseListAccounts(
      body([row({ email: 'a@x.com' }), row({ email: 'gone@x.com', signedOut: 1 }), row({ email: 'b@x.com' })]),
    );
    expect(out.map((a) => [a.email, a.index, a.signedOut])).toEqual([
      ['a@x.com', 0, false],
      ['b@x.com', 1, false],
      ['gone@x.com', -1, true],
    ]);
  });

  it('sorts by index with signed-out last', () => {
    const out = parseListAccounts(
      body([
        row({ email: 'out@x.com', signedOut: 1 }),
        row({ email: 'two@x.com', index: 2 }),
        row({ email: 'zero@x.com', index: 0 }),
        row({ email: 'one@x.com', index: 1 }),
      ]),
    );
    expect(out.map((a) => a.email)).toEqual(['zero@x.com', 'one@x.com', 'two@x.com', 'out@x.com']);
  });

  it('keeps invalid (needs re-auth) sessions in their slot', () => {
    const out = parseListAccounts(body([row({ email: 'a@x.com', valid: 0 }), row({ email: 'b@x.com' })]));
    expect(out.map((a) => a.index)).toEqual([0, 1]);
  });

  it("strips the )]}' prefix", () => {
    const out = parseListAccounts(`)]}'\n${body([row({ email: 'a@x.com', index: 0 })])}`);
    expect(out).toHaveLength(1);
  });

  it('skips short, odd and duplicate rows without throwing', () => {
    const out = parseListAccounts(
      body([
        [],
        ['gaia.l.a'],
        'string row',
        null,
        42,
        { email: 'obj@x.com' },
        row({ email: 'not-an-email' }),
        row({ email: 12 }),
        row({ email: 'ok@x.com', name: 7, photo: 'javascript:alert(1)', index: 'x' }),
        row({ email: 'OK@x.com' }),
      ]),
    );
    // The two unusable signed-in rows still took slots 0 and 1.
    expect(out).toEqual([{ email: 'ok@x.com', name: '', photo: '', index: 2, signedOut: false }]);
  });

  it('accepts a short row that still has an email', () => {
    const out = parseListAccounts(body([['gaia.l.a', 1, 'N', 'short@x.com']]));
    expect(out).toEqual([{ email: 'short@x.com', name: 'N', photo: '', index: 0, signedOut: false }]);
  });

  it('drops non-https photos', () => {
    const [a] = parseListAccounts(body([row({ email: 'a@x.com', photo: 'http://lh3.googleusercontent.com/x' })]));
    expect(a?.photo).toBe('');
  });

  it.each([
    ['https://lh3.googleusercontent.com/a/x=s48-c', true],
    ['https://yt3.ggpht.com/abc', true],
    ['https://LH5.GoogleUserContent.com/a', true],
    ['https://googleusercontent.com/a', false],
    ['https://evil.com/lh3.googleusercontent.com', false],
    ['https://googleusercontent.com.evil.com/a', false],
    ['https://evilggpht.com/a', false],
    ['http://lh3.googleusercontent.com/a', false],
    ['data:image/png;base64,AAAA', false],
    [42, false],
  ])('safePhoto(%s) keeps only Google image hosts: %s', (url, ok) => {
    expect(safePhoto(url) !== '').toBe(ok);
  });

  it.each([
    [''],
    ['<html>'],
    ['null'],
    ['{}'],
    ['[]'],
    ['["gaia.l.a.r"]'],
    ['["gaia.l.a.r", {}]'],
    [")]}'"],
    [undefined],
    [123],
  ])('returns [] for garbage %j', (input) => {
    expect(parseListAccounts(input)).toEqual([]);
  });
});

describe('indexByEmail', () => {
  it('maps only signed-in accounts', () => {
    const accounts = parseListAccounts(body([row({ email: 'a@x.com' }), row({ email: 'b@x.com', signedOut: 1 })]));
    expect([...indexByEmail(accounts)]).toEqual([['a@x.com', 0]]);
  });
});

describe('fetchAccounts', () => {
  it('POSTs with cookies and parses', async () => {
    const fetchFn = vi.fn(async () => new Response(body([row({ email: 'a@x.com', index: 0 })]), { status: 200 }));
    const out = await fetchAccounts(fetchFn as unknown as typeof fetch);
    expect(out).toHaveLength(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LIST_ACCOUNTS_URL);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
  });

  it('throws on HTTP errors', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 403 }));
    await expect(fetchAccounts(fetchFn as unknown as typeof fetch)).rejects.toThrow('403');
  });
});
