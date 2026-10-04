// End-to-end check of both apps in headless Chromium. Needs Playwright (npm i -D playwright) — skips if missing.
// Run from this folder: node tests/e2e.mjs
import http from "node:http"; import { readFile } from "node:fs/promises"; import { join, dirname, extname } from "node:path"; import { fileURLToPath } from "node:url";
let pw; try { pw = await import(process.env.PLAYWRIGHT_MODULE || "playwright"); } catch { console.log("SKIP: playwright not installed"); process.exit(0); }
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const types = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json"};
const srv = http.createServer(async (q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  if (p === "/favicon.ico"){ r.writeHead(204); r.end(); return; }
  try { const b = await readFile(join(root, p)); r.writeHead(200, {"content-type": types[extname(p)] || "application/octet-stream"}); r.end(b); } catch { r.writeHead(404); r.end(); } });
await new Promise(res => srv.listen(0, res)); const B = `http://localhost:${srv.address().port}/`;
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const b = await pw.chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined}); const p = await b.newPage({viewport:{width:390, height:844}}); const errs = [];
p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error" && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
try {
  await p.goto(B + "packing-list/"); await p.click('button:has-text("My preferences")');
  await p.locator('.gen-pref-item').filter({hasText:/^Kindle$/}).locator('input').uncheck(); await p.fill('#gp-custom','Medicine pouch');
  await p.click('button:has-text("Save my preferences")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  await p.click('button:has-text("My preferences")');
  if (await p.locator('.gen-pref-item').filter({hasText:/^Kindle$/}).locator('input').isChecked()) fail('preference exclusion not saved');
  await p.click('button:has-text("Close")'); await p.click("text=Generate a packing list");
  async function mobileLayout(){ for (const width of [360,390,430]){ for (const colorScheme of ['light','dark']){
    await p.setViewportSize({width,height:844}); await p.emulateMedia({colorScheme});
    if (await p.evaluate(()=>document.documentElement.scrollWidth > innerWidth)) fail(`setup overflow at ${width} ${colorScheme}`);
  }}}
  await mobileLayout();
  await p.fill("#gs-name", "Phoenix"); await p.fill("#gs-where", "Phoenix, AZ"); await p.fill("#gs-start", "2026-10-08"); await p.fill("#gs-end", "2026-10-12");
  await p.click('button:has-text("Continue")'); await mobileLayout(); await p.selectOption("#gs-work","work"); await p.click('button:has-text("Continue")'); await mobileLayout();
  await p.click('button:has-text("Generate my list")'); await p.waitForSelector("#gr-export");
  const items = await p.$$eval(".gen-item input", n => n.map(x => x.value));
  if (!items.includes("Socks ×9") || !items.includes("Contacts ×10")) fail("packing quantities: " + items.slice(0, 12).join(", "));
  if (items.includes('Kindle') || !items.includes('Medicine pouch')) fail('saved preferences not used for generation');
  if (!/Grab wallet/.test(await p.textContent("#view")) || !/Work computer packed\?/.test(await p.textContent("#view"))) fail("Before leaving checks");
  // Remove an item, then verify its dependent departure check disappears from the exported file.
  await p.locator('.gen-item').filter({has:p.locator('input')}).evaluateAll(rows => {
    const row = rows.find(r => r.querySelector('input').value === 'Work computer'); row.querySelector('button').click();
  });
  await p.reload(); await p.waitForSelector('#gr-export');
  if ((await p.$$eval('.gen-item input', n => n.map(x => x.value))).includes('Work computer')) fail('review draft lost on reload');
  await p.click("#gr-export"); await p.waitForSelector("#pe-enex");
  const downloadPromise = p.waitForEvent("download"); await p.click("#pe-enex"); const download = await downloadPromise;
  const exported = await readFile(await download.path(),"utf8");
  if (!exported.includes('<en-todo checked="false"/>') || exported.includes("Work computer packed?")) fail("native checklist export or departure dependencies");
  if (exported.includes("<h1>")) fail("duplicate note title");
  await p.click('button:has-text("Close")'); await p.reload(); await p.waitForSelector("#gr-export");
  if ((await p.$$eval('.gen-item input', n => n.map(x => x.value))).includes('Work computer')) fail("review edit did not persist");
  for (const width of [360,390,430]){ for (const colorScheme of ['light','dark']){
    await p.setViewportSize({width,height:844}); await p.emulateMedia({colorScheme});
    if (await p.evaluate(()=>document.documentElement.scrollWidth > innerWidth)) fail(`packing review overflow at ${width} ${colorScheme}`);
    if (await p.$eval('.gen-item input',e=>parseFloat(getComputedStyle(e).fontSize)) < 16) fail("small mobile input text");
  }}
  await p.goto(B + "itinerary-generator/"); await p.click("a.tripcard");
  await p.click("text=+ Flight"); await p.fill("#fl-day", "2026-10-08"); await p.fill("#fl-no", "UA 1234"); await p.fill("#fl-to", "PHX"); await p.fill("#fl-dep", "15:05"); await p.fill("#fl-arr", "17:40");
  await p.click('button:has-text("Add flight")'); await p.waitForTimeout(1000);
  await p.click("text=+ Lodging"); await p.fill("#lg-name", "Hyatt Place Phoenix"); await p.fill("#lg-addr", "1 E Main St, Phoenix, AZ"); await p.fill("#lg-in", "2026-10-08"); await p.fill("#lg-out", "2026-10-12");
  await p.click('button:has-text("Add lodging")'); await p.waitForTimeout(1200);
  const d1 = await p.textContent('section.day[data-date="2026-10-08"]');
  if (!/11:35a/.test(d1) || !/Leave home for/.test(d1) || !/Lodging · 4 nights/.test(d1)) fail("itinerary day 1: " + d1.replace(/\s+/g, " ").slice(0, 200));
  if ((await p.$$("section.day")).length !== 5) fail("expected 5 days");
} catch (e) { fail(e.message); }
if (errs.length) fail("page errors: " + errs.join(" | "));
await b.close(); srv.close();
if (!process.exitCode) console.log("OK: packing list and itinerary generator pass");
