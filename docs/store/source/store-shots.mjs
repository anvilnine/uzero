import { chromium } from 'playwright';
const [,, base, out] = process.argv;
const b = await chromium.launch();
async function shot(url, file, w, h, opts = {}) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: opts.dark ? 'dark' : 'light' });
  await p.goto(base + url); await p.waitForTimeout(700);
  if (opts.locator) await p.locator(opts.locator, { hasText: opts.hasText }).first().screenshot({ path: `${out}/${file}` });
  else await p.screenshot({ path: `${out}/${file}` });
  await p.close();
}
await shot('/popup.html', 'popup.png', 360, 600);
await shot('/popup.html', 'popup-dark.png', 360, 600, { dark: true });
await shot('/sidepanel.html?mock=signing-in', 'panel.png', 400, 820);
await shot('/sidepanel.html?mock=done', 'panel-done.png', 400, 820);
await shot('/options.html', 'pin.png', 1280, 1400, { locator: 'section', hasText: 'Pin default account' });
await b.close();
