#!/usr/bin/env node
// Prints Markdown release notes for a tag, grouped by Conventional Commit type.
// Usage: node scripts/release-notes.mjs v1.2.0
import { execFileSync } from 'node:child_process';
import { changelogSection } from './changelog.mjs';

const tag = process.argv[2];
if (!tag) {
  console.error('Usage: release-notes.mjs <tag>');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// The user-facing section from CHANGELOG.md goes first, when it exists.
const userNotes = changelogSection(tag);
if (userNotes) console.log(`${userNotes}\n`);

let previous = '';
try {
  previous = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', `${tag}^`);
} catch {
  // First release: no earlier tag.
}

const range = previous ? `${previous}..${tag}` : tag;
const lines = git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean);

const groups = [
  ['Features', /^feat(\(.+?\))?!?:\s*/],
  ['Fixes', /^fix(\(.+?\))?!?:\s*/],
  ['Performance', /^perf(\(.+?\))?!?:\s*/],
];
const buckets = new Map(groups.map(([title]) => [title, []]));
const other = [];

for (const line of lines) {
  if (/^chore(\(.+?\))?: release v/.test(line)) continue;
  const hit = groups.find(([, re]) => re.test(line));
  if (hit) {
    const scope = line.match(/^\w+\((.+?)\)/)?.[1];
    const text = line.replace(hit[1], '');
    buckets.get(hit[0]).push(scope ? `**${scope}:** ${text}` : text);
  } else {
    other.push(line);
  }
}

const out = [];
for (const [title, items] of buckets) {
  if (items.length) out.push(`## ${title}`, '', ...items.map((i) => `- ${i}`), '');
}
if (other.length) out.push('## Other changes', '', ...other.map((i) => `- ${i}`), '');
if (!lines.length) out.push('No changes since the last release.', '');

out.push(
  '## Downloads',
  '',
  '- Chrome: `uzero-*-chrome.zip`',
  '- Edge: `uzero-*-edge.zip`',
  '- Firefox: `uzero-*-firefox.zip`, with `uzero-*-sources.zip` for AMO review',
  '- `SHA256SUMS.txt` lists a checksum for each zip.',
  '',
);

const repo = process.env.GITHUB_REPOSITORY ?? 'anvilnine/uzero';
if (previous) out.push(`**Full changelog:** https://github.com/${repo}/compare/${previous}...${tag}`);

console.log(out.join('\n'));
