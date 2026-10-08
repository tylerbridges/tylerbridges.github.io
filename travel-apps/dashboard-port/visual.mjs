import {mkdir} from 'node:fs/promises';
import {serve, seed, open, PW, DIRS} from './lib.mjs';
await mkdir(DIRS.shots, {recursive:true});
const SH = DIRS.shots;
const port = await serve(DIRS.port), sa = await serve(DIRS.apps), data = await seed(DIRS.port);
const browser = await PW.chromium.launch(); let bad = [], errs = [];
for (const width of [360, 390, 430]) for (const scheme of ['light','dark']){
  const o = await open(browser, port.url, data, {width, colorScheme:scheme});
  await o.page.goto(port.url + '#PHX-2026-10-08.packing'); await o.page.waitForSelector('#rs-where'); await o.page.waitForTimeout(400);
  if (!await o.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#packgen *')].every(e => e.getBoundingClientRect().right <= innerWidth + 0.5))) bad.push('setup ' + width + scheme);
  await o.page.locator('#packgen').screenshot({path:`${SH}phx-setup-${width}-${scheme}.png`});
  await o.page.click('button:has-text("Generate my list")'); await o.page.waitForSelector('#rr-export'); await o.page.waitForTimeout(500);
  await o.page.locator('#packgen').screenshot({path:`${SH}dash-review-${width}-${scheme}.png`});
  errs.push(...o.errors); await o.ctx.close();
  // standalone: same trip via its own setup
  const ctx = await browser.newContext({viewport:{width, height:844}, colorScheme:scheme}); await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  const p = await ctx.newPage(); await p.goto(sa.url + 'packing-list/#new'); await p.waitForSelector('#rs-where');
  await p.fill('#rs-where', 'Phoenix, AZ'); await p.locator('.rp-sum button').first().click();
  await p.locator('.rp-grid button[aria-label*="Oct 8"]').click(); await p.locator('.rp-grid button[aria-label*="Oct 13"]').click(); await p.getByRole('button',{name:'OK',exact:true}).click();
  await p.locator('#view').screenshot({path:`${SH}sa-setup-${width}-${scheme}.png`});
  await p.click('button:has-text("Generate my list")'); await p.waitForSelector('#rr-export'); await p.waitForTimeout(500);
  await p.locator('.gen-review').first().screenshot({path:`${SH}sa-review-${width}-${scheme}.png`}); await ctx.close();
}
console.log('overflow:', bad, 'errors:', errs); await browser.close(); port.server.close(); sa.server.close();
