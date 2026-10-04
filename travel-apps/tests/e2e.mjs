// End-to-end check of both apps in headless Chromium. Needs Playwright (npm i -D playwright) — skips if missing.
// Run from this folder: node tests/e2e.mjs
import http from "node:http"; import { readFile } from "node:fs/promises"; import { join, dirname, extname } from "node:path"; import { fileURLToPath } from "node:url";
let pw; try { pw = await import("playwright"); } catch { console.log("SKIP: playwright not installed"); process.exit(0); }
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const types = {".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json"};
const srv = http.createServer(async (q, r) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  try { const b = await readFile(join(root, p)); r.writeHead(200, {"content-type": types[extname(p)] || "application/octet-stream"}); r.end(b); } catch { r.writeHead(404); r.end(); } });
await new Promise(res => srv.listen(0, res)); const B = `http://localhost:${srv.address().port}/`;
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const b = await pw.chromium.launch(); const p = await b.newPage({viewport:{width:390, height:844}}); const errs = [];
p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error" && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
try {
  await p.goto(B + "packing-list/"); await p.click("text=+ New trip");
  await p.fill("#tf-name", "Phoenix"); await p.fill("#tf-where", "Phoenix, AZ"); await p.fill("#tf-start", "2026-10-08"); await p.fill("#tf-end", "2026-10-12");
  await p.click("text=Create trip"); await p.click("text=Build my packing list"); await p.check("#pb-work");
  await p.click("text=Make my list"); await p.click("text=Add to packing list"); await p.waitForTimeout(500);
  const items = await p.$$eval(".nm", n => n.map(x => x.textContent));
  if (!items.includes("Socks ×9") || !items.includes("Contacts ×10")) fail("packing quantities: " + items.slice(0, 12).join(", "));
  if (!items.includes("Grab wallet") || !items.includes("Work computer packed?")) fail("Before leaving checks");
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
