import { describe, expect, it } from 'vitest';
import { SHARE_TEXT } from './ask';
import {
  EMPTY_STATS,
  SHARE_FROM_LINKS,
  STAT_MAX,
  bump,
  hasStats,
  pinLine,
  sanitizeStats,
  shareText,
  statRows,
} from './stats';

describe('sanitizeStats', () => {
  it('turns junk into empty stats', () => {
    expect(sanitizeStats(null)).toEqual(EMPTY_STATS);
    expect(sanitizeStats('x')).toEqual(EMPTY_STATS);
    expect(sanitizeStats({ pinnedLinks: -3, tabSwitches: 1.5, reorders: '2', since: 'today' })).toEqual(EMPTY_STATS);
  });

  it('keeps good values, drops unknown keys and caps huge ones', () => {
    expect(sanitizeStats({ pinnedLinks: 7, reorders: 1, accountsReordered: 3, since: 5, extra: 1 })).toEqual({
      pinnedLinks: 7, tabSwitches: 0, reorders: 1, accountsReordered: 3, since: 5,
    });
    expect(sanitizeStats({ pinnedLinks: STAT_MAX * 10 }).pinnedLinks).toBe(STAT_MAX);
  });
});

describe('bump', () => {
  it('adds to counters and stamps the first count', () => {
    const a = bump(EMPTY_STATS, { pinnedLinks: 1 }, 100);
    expect(a).toMatchObject({ pinnedLinks: 1, since: 100 });
    const b = bump(a, { reorders: 1, accountsReordered: 4 }, 200);
    expect(b).toMatchObject({ pinnedLinks: 1, reorders: 1, accountsReordered: 4, since: 100 });
  });

  it('ignores zero, negative and broken amounts without stamping a start time', () => {
    const s = bump(EMPTY_STATS, { pinnedLinks: 0, tabSwitches: -1, reorders: Number.NaN }, 100);
    expect(s).toEqual(EMPTY_STATS);
  });

  it('never goes past the cap', () => {
    expect(bump({ ...EMPTY_STATS, tabSwitches: STAT_MAX }, { tabSwitches: 1 }, 1).tabSwitches).toBe(STAT_MAX);
  });
});

describe('display', () => {
  it('reports whether anything was counted', () => {
    expect(hasStats(EMPTY_STATS)).toBe(false);
    expect(hasStats({ ...EMPTY_STATS, reorders: 1 })).toBe(true);
  });

  it('lists only counters above zero', () => {
    expect(statRows(EMPTY_STATS, 'en-US')).toEqual([]);
    const rows = statRows({ ...EMPTY_STATS, pinnedLinks: 1284, reorders: 2, accountsReordered: 7 }, 'en-US');
    expect(rows.map((r) => r.id)).toEqual(['pinnedLinks', 'reorders']);
    expect(rows[0]?.value).toBe('1,284');
    expect(rows[1]).toMatchObject({ label: 'Reorders finished', value: '2 (7 accounts)' });
  });

  it('uses the singular for one reorder of one account', () => {
    const [row] = statRows({ ...EMPTY_STATS, reorders: 1, accountsReordered: 1 }, 'en-US');
    expect(row).toMatchObject({ label: 'Reorder finished', value: '1 (1 account)' });
  });

  it('writes the popup line only once Pin has opened something', () => {
    expect(pinLine(EMPTY_STATS)).toBeNull();
    expect(pinLine({ ...EMPTY_STATS, pinnedLinks: 1 })).toBe('1 opened so far.');
    expect(pinLine({ ...EMPTY_STATS, pinnedLinks: 1500 }, 'en-US')).toBe('1,500 opened so far.');
  });

  it('quotes the link count in share text only past the threshold', () => {
    expect(shareText({ ...EMPTY_STATS, pinnedLinks: SHARE_FROM_LINKS - 1 })).toBe(SHARE_TEXT);
    expect(shareText({ ...EMPTY_STATS, pinnedLinks: 2048 }, 'en-US')).toContain('2,048 Google links');
  });
});
