import { chromium } from 'playwright';
const [,, base, out] = process.argv;
const b = await chromium.launch();
for (const [n, w, h] of [['1',1280,800],['2',1280,800],['3',1280,800],['4',1280,800],['5',1280,800],['promo',440,280]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.goto(`${base}/slides.html?n=${n}`); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/raw-${n}.png` }); await p.close();
}
await b.close();
