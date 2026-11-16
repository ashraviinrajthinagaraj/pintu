// Temporary: pasting Google Maps share links into the live Pintu, as a phone would.
import { chromium, devices } from 'playwright';
const SITE = 'https://ashraviinrajthinagaraj.github.io/pintu/';
const TRIES = [
  ['typed', 'https://maps.app.goo.gl/Q8nywjAZGExicjdr7?g_st=ac'],
  ['with name', 'Royalton Hicacos\nVaradero, Cuba\nhttps://maps.app.goo.gl/Q8nywjAZGExicjdr7?g_st=ac'],
  ['pin', 'https://maps.app.goo.gl/GqVdG8He3DA1De4w6'],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'ms-MY', permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => { try { localStorage.setItem('pintu.safetySeen', 'true'); } catch {} });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('requestfailed', (r) => console.log('requestfailed', r.url().slice(0, 160), r.failure()?.errorText));
page.on('response', (r) => { if (r.url().includes('workers.dev/link')) console.log('server', r.status(), r.url().slice(0, 160)); });
await page.goto(SITE, { waitUntil: 'networkidle' });
console.log('version', await page.evaluate(() => document.querySelector('#about-version, .version')?.textContent || ''));
let n = 0;
for (const [how, text] of TRIES) {
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.click('#where');
  if (how === 'with name') {
    // A real paste, from the clipboard, into the box.
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.focus('#search-input');
    await page.keyboard.press('Control+V');
  } else {
    await page.fill('#search-input', text);
  }
  await page.waitForTimeout(9000);
  const status = await page.textContent('#search-status');
  const results = await page.$$eval('#search-results .place', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  console.log('== try', how, '| box:', JSON.stringify(await page.inputValue('#search-input')), '| status:', status, '| results:', JSON.stringify(results));
  await page.screenshot({ path: `try-${n++}.png` });
}
// The paste button.
await page.goto(SITE, { waitUntil: 'networkidle' });
await page.evaluate((t) => navigator.clipboard.writeText(t), TRIES[0][1]);
await page.click('#where');
const btn = await page.$('#search-paste');
console.log('paste button visible', btn && await btn.isVisible());
if (btn && await btn.isVisible()) {
  await btn.click();
  await page.waitForTimeout(9000);
  console.log('== paste button | status:', await page.textContent('#search-status'), '| results:', JSON.stringify(await page.$$eval('#search-results .place', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))));
}
await browser.close();
