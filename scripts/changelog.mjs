#!/usr/bin/env node
// Reads one version's section from CHANGELOG.md.
// Usage: node scripts/changelog.mjs 0.1.3            prints the Markdown section
//        node scripts/changelog.mjs 0.1.3 --amo      prints AMO version metadata JSON
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function changelogSection(version) {
  let log;
  try {
    log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  } catch {
    return '';
  }
  const v = version.replace(/^v/, '').replace(/\./g, '\\.');
  const start = log.search(new RegExp(`^## ${v}[ (]`, 'm'));
  if (start < 0) return '';
  const rest = log.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end >= 0 ? rest.slice(0, end) : rest).join('\n').trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, flag] = process.argv.slice(2);
  if (!version) {
    console.error('Usage: changelog.mjs <version> [--amo]');
    process.exit(2);
  }
  const body = changelogSection(version);
  if (flag === '--amo') {
    const notes = body.replace(/`/g, '') || 'Bug fixes and improvements.';
    const approval =
      'Source attached. Build with Node 22 and pnpm 9: pnpm install --frozen-lockfile, then pnpm zip:firefox. ' +
      'The zip in .output matches this upload. No remote code.';
    console.log(JSON.stringify({ version: { release_notes: { 'en-US': notes }, approval_notes: approval } }, null, 2));
  } else {
    console.log(body);
  }
}
