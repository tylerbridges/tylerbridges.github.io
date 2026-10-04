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
let apiCalls=0;p.on('request',q=>{if(/api\.(anthropic|openai)\.com/.test(q.url()))apiCalls++;});
p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error" && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
try {
  await p.goto(B + "packing-list/"); await p.click('button:has-text("My preferences")');
  await p.getByLabel('Include Snacks',{exact:true}).uncheck(); await p.fill('#gp-custom','Medicine pouch');
  await p.click('button:has-text("Save my preferences")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  await p.click('button:has-text("My preferences")');
  if (await p.getByLabel('Include Snacks',{exact:true}).isChecked()) fail('preference exclusion not saved');
  await p.click('button:has-text("Close")'); await p.click("text=Generate a packing list");
  async function mobileLayout(){ for (const width of [360,390,430]){ for (const colorScheme of ['light','dark']){
    await p.setViewportSize({width,height:844}); await p.emulateMedia({colorScheme});
    if (await p.evaluate(()=>document.documentElement.scrollWidth > innerWidth)) fail(`setup overflow at ${width} ${colorScheme}`);
  }}}
  await mobileLayout();
  await p.fill("#rs-where", "Phoenix, AZ"); await p.locator(".rp-sum button").first().click(); for (let i = 0; i < 24; i++){ const m = await p.locator(".rp-head b").textContent(); if (m === "October 2026") break; await p.locator(".rp-head button").nth(new Date(m + " 1") < new Date(2026, 9, 1) ? 1 : 0).click(); } await p.locator('.rp-grid button[aria-label*="Oct 8"]').click(); await p.locator('.rp-grid button[aria-label*="Oct 12"]').click(); if (!/5 days/.test(await p.locator(".rp-hint").textContent())) fail("date range picker did not set dates");
  await p.check("#rs-workout"); await p.selectOption("#rs-climate","cool");
  await p.click('button:has-text("Generate my list")'); await p.waitForSelector("#rr-export");
  const labels = () => p.$$eval('.refine-item strong', n => n.map(x => x.textContent));
  const initial = await labels();
  if (!initial.includes("Socks ×9") || !initial.includes("Contacts ×10")) fail("initial quantities");
  if (initial.includes('Snacks') || !initial.includes('Medicine pouch')) fail('saved preferences not used');
  if(initial.includes('Small collapsible backpack'))fail('daypack included by default');
  for(const label of ['Kindle','Hotspot','Belkin charging pad','Garmin','Garmin charger','Extra phone case'])if(initial.includes(label))fail('optional item included by default: '+label);
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Extras:")'));await p.check('#rf-extra-garmin');await p.check('#rf-extra-kindle');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  if(!(await labels()).includes('Garmin') || !(await labels()).includes('Garmin charger') || !(await labels()).includes('Kindle'))fail('selected extras missing');
  await p.reload();await p.waitForSelector('#rr-export');if(!(await labels()).includes('Garmin charger'))fail('selected extras lost on reload');
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Extras:")'));await p.uncheck('#rf-extra-garmin');await p.uncheck('#rf-extra-kindle');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if((await labels()).includes('Garmin charger') || (await labels()).includes('Kindle'))fail('deselected extras retained');

  if(!initial.includes('Lulu shorts ×3') || !initial.includes('T-shirts ×4'))fail('daily workouts must share regular clothes with full shorts coverage');
  if(await p.locator('[data-item-id="pack:light-packable-puffer-jacket"]').evaluate(n=>n.closest('section').querySelector('h3').textContent)!=='Clothing')fail('carry-on moved puffer');
  if(await p.locator('.refine-item summary').count())fail('row explanations returned');
  await p.click('button:has-text("Packing rules")');if(!(await p.textContent('.sheet-body')).includes('Workouts most days'))fail('workout rules not inspectable');await p.click('button:has-text("Close")');

  for(const [name,ids] of [['Packing',['rf-packing']],['Extras',['rf-extra-kindle','rf-extra-hotspot','rf-extra-chargingPad','rf-extra-garmin','rf-extra-phoneCase']],['Bag',['rf-bag']],['Weather',['rf-climate','rf-thermal','rf-rain']],['Activities',['rf-hike','rf-workout','rf-water','rf-fish','rf-daypack','rf-rugged']],['Events',['rf-formal','rf-dinners']],['Flight',['rf-longFlight']],['Laundry',['rf-laundry','rf-first','rf-interval']]]){
    await p.click(`button:has-text("${name}:")`);
    const actual=await p.locator('.sheet-body input, .sheet-body select').evaluateAll(nodes=>nodes.map(n=>n.id));
    if(JSON.stringify(actual)!==JSON.stringify(ids))fail(`${name} editor contains unrelated fields`);
    if(name==='Packing' && (await p.locator('#rf-packing').textContent()).includes('lighter'))fail('pack lighter still offered');
    await mobileLayout();await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  }
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Weather:")'));await p.selectOption('#rf-thermal','hot');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  if(!(await labels()).includes('Light packable puffer jacket'))fail('running hot removed cool-weather puffer');
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Activities:")'));if(await p.locator('#rf-rugged').isVisible())fail('rugged toggle visible without hiking');await p.check('#rf-hike');if(!await p.locator('#rf-rugged').isVisible())fail('rugged toggle missing');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  if((await labels()).includes('Hiking boots / trail shoes'))fail('ordinary hiking added extra footwear');
  if((await labels()).includes('Small collapsible backpack'))fail('hiking automatically added daypack');
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Activities:")'));await p.check('#rf-daypack');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if(!(await labels()).includes('Small collapsible backpack'))fail('daypack toggle did not add item');
  await p.reload();await p.waitForSelector('#rr-export');if(!(await labels()).includes('Small collapsible backpack'))fail('daypack choice lost on reload');
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Activities:")'));await p.uncheck('#rf-daypack');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if((await labels()).includes('Small collapsible backpack'))fail('daypack toggle did not remove item');

  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Activities:")'));await p.check('#rf-rugged');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if(!(await labels()).includes('Hiking boots / trail shoes'))fail('rugged hiking footwear missing');
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Activities:")'));await p.uncheck('#rf-hike');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if((await labels()).includes('Hiking boots / trail shoes'))fail('obsolete hiking footwear retained');
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Work:")')); if(await p.locator('.sheet-body input, .sheet-body select').count()!==1)fail('work editor contains unrelated fields'); await p.selectOption('#rf-work','work'); await p.click('button:has-text("Apply & recalculate")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  if (!(await labels()).includes('Work computer charger')) fail('work power dependency');
  await p.evaluate(()=>{window.testWorkSection=[...document.querySelectorAll('section.panel')].find(n=>n.querySelector('h3')?.textContent==='Work');});
  await p.locator('[data-item-id="pack:socks"]').getByRole('button',{name:'Edit',exact:true}).click(); await p.fill('#ri-quantity','7'); await p.click('button:has-text("Save override")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  await p.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>p.click('button:has-text("Laundry:")')); await p.selectOption('#rf-laundry','yes'); await p.fill('#rf-first','2'); await p.fill('#rf-interval','2'); await p.click('button:has-text("Apply & recalculate")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  if (!(await labels()).includes('Socks ×7') || !(await labels()).includes('T-shirts ×2') || !(await labels()).includes('Contacts ×10')) fail('laundry recalculation erased override or changed contacts');
  if(!await p.evaluate(()=>window.testWorkSection===[...document.querySelectorAll('section.panel')].find(n=>n.querySelector('h3')?.textContent==='Work')))fail('unaffected work section was replaced');
  await p.reload(); await p.waitForSelector('#rr-export'); if (!(await labels()).includes('Socks ×7')) fail('override lost after reload');
  await p.locator('[data-item-id="pack:socks"]').getByRole('button',{name:'Return to automatic',exact:true}).click(); await p.waitForFunction(()=>document.querySelector('[data-item-id="pack:socks"] strong').textContent==='Socks ×5');
  await p.locator('[data-item-id="pack:wrinkle-release"]').getByRole('button',{name:'Remove',exact:true}).click(); await p.click('button:has-text("Usually don’t pack this")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  if ((await labels()).includes('Wrinkle release')) fail('default exclusion not applied');
  await p.click('button:has-text("Defaults & exclusions")'); if (!/Wrinkle release/.test(await p.textContent('.sheet-body'))) fail('default exclusion not inspectable');
  await p.click('button:has-text("Close")');
  await p.locator('.refine-changes').getByRole('button',{name:'Undo',exact:true}).click(); await p.waitForFunction(()=>!!document.querySelector('[data-item-id="pack:wrinkle-release"]'));
  const prefs = await p.evaluate(()=>JSON.parse(localStorage.getItem('ta:meta/packing'))); if (prefs.refinementProfile?.excluded?.['pack:wrinkle-release']) fail('Undo failed to restore profile default');
  await p.evaluate(()=>{window.originalStorageWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.endsWith('/pack_meta/refinement'))throw new DOMException('Test storage quota','QuotaExceededError');return window.originalStorageWrite.call(this,key,value);};});
  await p.locator('[data-item-id="pack:socks"]').getByRole('button',{name:'Edit',exact:true}).click();await p.fill('#ri-quantity','99');await p.click('button:has-text("Save override")');await p.waitForSelector('.refine-error');
  if(!(await labels()).includes('Socks ×5'))fail('failed storage save changed the visible list');await p.click('button:has-text("Close")');
  await p.locator('[data-item-id="pack:wrinkle-release"]').getByRole('button',{name:'Remove',exact:true}).click();await p.click('button:has-text("Usually don’t pack this")');
  await p.waitForFunction(()=>document.querySelector('#view .gen-error')?.textContent.includes('rolled back'));
  if(await p.evaluate(()=>!!JSON.parse(localStorage.getItem('ta:meta/packing')).refinementProfile?.excluded?.['pack:wrinkle-release']))fail('default was not rolled back after a failed trip save');
  await p.click('button:has-text("Close")');await p.evaluate(()=>{Storage.prototype.setItem=window.originalStorageWrite;});
  await p.locator('[data-item-id="pack:work-computer"]').getByRole('button',{name:'Remove',exact:true}).click(); await p.click('button:has-text("Remove for this trip")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  await p.reload(); await p.waitForSelector('#rr-export'); if ((await labels()).includes('Work computer')) fail('trip removal lost on reload');
  if (!/removed manually but is required/.test(await p.textContent('#view'))) fail('missing dependency warning');
  await p.click('#rr-export'); await p.waitForSelector('#pe-enex');
  const downloadPromise = p.waitForEvent('download'); await p.click('#pe-enex'); const download=await downloadPromise; const exported=await readFile(await download.path(),'utf8');
  if (!exported.includes('<en-todo checked="false"/>') || exported.includes('Work computer packed?') || !exported.includes('Socks ×5')) fail('native Notes export did not reflect refinements');
  if (exported.includes('<h1>')) fail('duplicate Notes title');
  await p.click('button:has-text("Close")');
  for (const width of [360,390,430]){ for (const colorScheme of ['light','dark']){
    await p.setViewportSize({width,height:844}); await p.emulateMedia({colorScheme});
    if (await p.evaluate(()=>document.documentElement.scrollWidth > innerWidth)) fail(`refinement review overflow at ${width} ${colorScheme}`);
  }}
  const legacyPage=await b.newPage({viewport:{width:390,height:844}});await legacyPage.goto(B+'packing-list/');
  await legacyPage.evaluate(()=>{localStorage.setItem('ta:trips/OLD',JSON.stringify({name:'Old trip',where:'Phoenix',start:'2026-10-08',end:'2026-10-12'}));localStorage.setItem('ta:trip/OLD/pack_meta/draft',JSON.stringify({groups:[{title:'Clothing',items:['Socks ×3','Special shirt ×2']}]}));location.hash='OLD';});
  await legacyPage.reload();await legacyPage.waitForSelector('#rr-export');
  if(!/Socks ×3/.test(await legacyPage.textContent('#view')))fail('legacy draft not preserved');
  await legacyPage.evaluate(()=>{var d=document.querySelector('.refine-one');if(d)d.open=true;}).then(()=>legacyPage.click('button:has-text("Laundry:")'));await legacyPage.click('button:has-text("Enable automatic refinement")');await legacyPage.waitForSelector('.sheet-bg',{state:'detached'});
  if(await legacyPage.locator('[data-item-id="pack:socks"]').count()!==1)fail('legacy migration duplicated socks');
  await legacyPage.locator('[data-item-id="pack:socks"]').getByRole('button',{name:'Return to automatic',exact:true}).click();await legacyPage.waitForFunction(()=>document.querySelector('[data-item-id="pack:socks"] strong').textContent==='Socks ×9');
  if(!/Special shirt ×2/.test(await legacyPage.textContent('#view')))fail('legacy custom item lost');await legacyPage.close();
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
if(apiCalls)fail('routine refinement made an AI API call');
await b.close(); srv.close();
if (!process.exitCode) console.log("OK: packing list and itinerary generator pass");
