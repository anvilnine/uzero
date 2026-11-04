import { describe, expect, it } from 'vitest';
import type { Account } from './types';
import { currentEmail, OTHER_SERVICE_ID, switchableServiceId, toAccount } from './rewrite';

describe('toAccount', () => {
  it.each([
    // Path-style: insert /u/N/
    ['https://mail.google.com/mail/', 2, 'https://mail.google.com/mail/u/2/'],
    ['https://mail.google.com/mail', 2, 'https://mail.google.com/mail/u/2/'],
    ['https://mail.google.com/mail/#inbox', 1, 'https://mail.google.com/mail/u/1/#inbox'],
    ['https://drive.google.com/drive/my-drive', 3, 'https://drive.google.com/drive/u/3/my-drive'],
    ['https://calendar.google.com/calendar/r/week', 1, 'https://calendar.google.com/calendar/u/1/r/week'],
    ['https://docs.google.com/document/d/ID/edit', 1, 'https://docs.google.com/document/u/1/d/ID/edit'],
    ['https://docs.google.com/spreadsheets/d/ID/edit#gid=0', 2, 'https://docs.google.com/spreadsheets/u/2/d/ID/edit#gid=0'],
    ['https://docs.google.com/presentation/d/ID/edit', 1, 'https://docs.google.com/presentation/u/1/d/ID/edit'],
    ['https://docs.google.com/forms/d/e/X/viewform', 1, 'https://docs.google.com/forms/u/1/d/e/X/viewform'],
    ['https://photos.google.com/', 1, 'https://photos.google.com/u/1/'],
    ['https://photos.google.com/albums', 1, 'https://photos.google.com/u/1/albums'],
    // Path-style: replace existing /u/N
    ['https://mail.google.com/mail/u/0/#inbox', 2, 'https://mail.google.com/mail/u/2/#inbox'],
    ['https://mail.google.com/mail/u/10', 3, 'https://mail.google.com/mail/u/3/'],
    ['https://docs.google.com/document/u/1/d/ID/edit', 0, 'https://docs.google.com/document/u/0/d/ID/edit'],
    ['https://photos.google.com/u/2/albums', 0, 'https://photos.google.com/u/0/albums'],
    // Path-style: authuser conflict removed
    ['https://mail.google.com/mail/u/0/?authuser=1', 2, 'https://mail.google.com/mail/u/2/'],
    ['https://docs.google.com/document/d/ID/edit?authuser=3&usp=x', 1, 'https://docs.google.com/document/u/1/d/ID/edit?usp=x'],
    // Path-style host, path outside uAt: ?authuser
    ['https://drive.google.com/file/d/ID/view', 2, 'https://drive.google.com/file/d/ID/view?authuser=2'],
    ['https://mail.google.com/', 1, 'https://mail.google.com/?authuser=1'],
    ['https://calendar.google.com/', 1, 'https://calendar.google.com/?authuser=1'],
    // Query-style
    ['https://meet.google.com/abc-defg-hij', 1, 'https://meet.google.com/abc-defg-hij?authuser=1'],
    ['https://meet.google.com/abc?authuser=3', 1, 'https://meet.google.com/abc?authuser=1'],
    ['https://meet.google.com/abc?authuser=x%40y.com&hl=en', 0, 'https://meet.google.com/abc?authuser=0&hl=en'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 2, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&authuser=2'],
    ['https://studio.youtube.com/', 1, 'https://studio.youtube.com/?authuser=1'],
    ['https://console.cloud.google.com/home?project=p', 1, 'https://console.cloud.google.com/home?project=p&authuser=1'],
    ['https://www.google.com/maps/place/X', 1, 'https://www.google.com/maps/place/X?authuser=1'],
    ['https://search.google.com/search-console', 1, 'https://search.google.com/search-console?authuser=1'],
    ['https://play.google.com/console/', 1, 'https://play.google.com/console/?authuser=1'],
    ['https://gemini.google.com/app', 1, 'https://gemini.google.com/app?authuser=1'],
    // Query-style host that already uses /u/N at the root: replace it
    ['https://gemini.google.com/u/1/app', 2, 'https://gemini.google.com/u/2/app'],
    ['https://console.firebase.google.com/u/0/project/x?authuser=0', 1, 'https://console.firebase.google.com/u/1/project/x'],
    ['https://myaccount.google.com/u/1/', 0, 'https://myaccount.google.com/u/0/'],
    // Extra hosts (not in catalog) accept ?authuser
    ['https://groups.google.com/my-groups', 1, 'https://groups.google.com/my-groups?authuser=1'],
    // Path-style host, /u/N outside uAt (Gmail Chat): replace it, never add ?authuser on top
    ['https://mail.google.com/chat/u/0/', 2, 'https://mail.google.com/chat/u/2/'],
    ['https://mail.google.com/chat/u/0/#chat/home', 1, 'https://mail.google.com/chat/u/1/#chat/home'],
    ['https://mail.google.com/chat/u/3', 1, 'https://mail.google.com/chat/u/1/'],
    ['https://drive.google.com/u/1/settings?authuser=1', 0, 'https://drive.google.com/u/0/settings'],
    ['https://mail.google.com/mail/u/1/foo/u/2/', 0, 'https://mail.google.com/mail/u/0/foo/u/2/'],
    // Gmail: a thread id belongs to one account, keep only the folder or label
    ['https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKmRtQdVqz', 1, 'https://mail.google.com/mail/u/1/#inbox'],
    ['https://mail.google.com/mail/u/0/#label/Work%2FTeam/FMfcgzQXJW', 1, 'https://mail.google.com/mail/u/1/#label/Work%2FTeam'],
    ['https://mail.google.com/mail/u/0/#search/from%3Aann/18c2f0a1b2c3d4e5', 2, 'https://mail.google.com/mail/u/2/#search/from%3Aann'],
    ['https://mail.google.com/mail/u/0/#category/social', 1, 'https://mail.google.com/mail/u/1/#category/social'],
    ['https://mail.google.com/mail/u/0/#sent', 1, 'https://mail.google.com/mail/u/1/#sent'],
    ['https://mail.google.com/mail/u/0/#inbox?compose=new', 1, 'https://mail.google.com/mail/u/1/#inbox?compose=new'],
    // Adding ?authuser leaves the rest of the query exactly as written
    ['https://meet.google.com/abc?q=a~b&s=a%20b&p=a%2Fb', 1, 'https://meet.google.com/abc?q=a~b&s=a%20b&p=a%2Fb&authuser=1'],
    ['https://meet.google.com/abc?q=a+b&authuser=0&p=%2F', 2, 'https://meet.google.com/abc?q=a+b&authuser=2&p=%2F'],
    ['https://meet.google.com/abc?q=x y', 1, 'https://meet.google.com/abc?q=x%20y&authuser=1'],
    ['https://docs.google.com/document/d/ID/edit?authuser=3&p=a~%2F', 1, 'https://docs.google.com/document/u/1/d/ID/edit?p=a~%2F'],
    ['https://docs.google.com/document/d/ID/edit?authuser=3', 1, 'https://docs.google.com/document/u/1/d/ID/edit'],
  ])('%s @%i -> %s', (input, index, out) => {
    expect(toAccount(input, index)).toBe(out);
  });

  it.each([
    ['https://accounts.google.com/AccountChooser'],
    ['https://www.google.com/search?q=x'],
    ['https://example.com/mail/'],
    ['https://drive.google.com/uc?export=download&id=1'],
    ['https://docs.google.com/document/create'],
    ['https://docs.google.com/'],
    ['https://play.google.com/store/apps'],
    ['https://www.youtube.com/logout'],
    ['https://lh3.googleusercontent.com/a/x'],
    ['chrome://extensions'],
    ['javascript:alert(1)'],
    ['not a url'],
  ])('%s -> null', (input) => {
    expect(toAccount(input, 1)).toBeNull();
  });

  it.each([[-1], [1.5], [NaN], [100]])('rejects index %s', (n) => {
    expect(toAccount('https://meet.google.com/', n)).toBeNull();
  });
});

describe('switchableServiceId', () => {
  it('names catalog services, "other" for extra hosts, null otherwise', () => {
    expect(switchableServiceId('https://mail.google.com/mail/u/0/')).toBe('gmail');
    expect(switchableServiceId('https://groups.google.com/')).toBe(OTHER_SERVICE_ID);
    expect(switchableServiceId('https://accounts.google.com/')).toBeNull();
  });
});

describe('currentEmail', () => {
  const accounts: Account[] = [
    { email: 'a@x.com', name: '', photo: '', index: 0, signedOut: false },
    { email: 'b@x.com', name: '', photo: '', index: 1, signedOut: false },
    { email: 'c@x.com', name: '', photo: '', index: -1, signedOut: true },
  ];
  it.each([
    ['https://mail.google.com/mail/u/1/', 'b@x.com'],
    ['https://mail.google.com/mail/', 'a@x.com'],
    ['https://meet.google.com/x?authuser=1', 'b@x.com'],
    ['https://meet.google.com/x?authuser=B%40x.com', 'b@x.com'],
    ['https://gemini.google.com/u/1/app', 'b@x.com'],
    ['https://mail.google.com/chat/u/1/', 'b@x.com'],
    ['https://mail.google.com/chat/u/0/#chat/home', 'a@x.com'],
    ['https://drive.google.com/u/1/settings', 'b@x.com'],
    ['https://meet.google.com/x?authuser=5', null],
    ['https://meet.google.com/x?authuser=c@x.com', null],
    ['https://www.google.com/search', null],
  ])('%s -> %s', (url, email) => expect(currentEmail(url, accounts)).toBe(email));
});
