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
const b = await pw.chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined}); const p = await testPage({viewport:{width:390, height:844}}); const errs = [];
// External font availability is outside this functional check; exercise the supported system-font fallback.
async function testPage(options){const page=await b.newPage(options);await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({status:200,contentType:'text/css',body:''}));return page;}
let apiCalls=0;p.on('request',q=>{if(/api\.(anthropic|openai)\.com/.test(q.url()))apiCalls++;});
p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error" && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
try {
  await p.goto(B + "packing-list/"); await p.click('button:has-text("Packing preferences")');
  await p.getByLabel('Include Snacks',{exact:true}).uncheck(); await p.getByText('Add usual item',{exact:true}).click();await p.fill('#gp-addName','Medicine pouch');await p.check('#gp-addAlways');await p.getByRole('button',{name:'Add item',exact:true}).click();
  await p.click('button:has-text("Save my preferences")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  await p.click('button:has-text("Packing preferences")');
  if (await p.getByLabel('Include Snacks',{exact:true}).isChecked()) fail('preference exclusion not saved');
  await p.click('button:has-text("Close")'); await p.click("text=Generate a packing list");
  async function mobileLayout(){ for (const width of [360,390,430]){ for (const colorScheme of ['light','dark']){
    await p.setViewportSize({width,height:844}); await p.emulateMedia({colorScheme});
    if (await p.evaluate(()=>document.documentElement.scrollWidth > innerWidth)) fail(`setup overflow at ${width} ${colorScheme}`);
  }}}
  await mobileLayout();
  await p.fill("#rs-where", "Phoenix, AZ"); await p.locator(".rp-sum button").first().click(); for (let i = 0; i < 24; i++){ const m = await p.locator(".rp-head b").textContent(); if (m === "October 2026") break; await p.locator(".rp-head button").nth(new Date(m + " 1") < new Date(2026, 9, 1) ? 1 : 0).click(); } await p.locator('.rp-grid button[aria-label*="Oct 8"]').click(); await p.locator('.rp-grid button[aria-label*="Oct 12"]').click(); if (!/5 days/.test(await p.locator(".rp-hint").textContent())) fail("date range picker did not set dates");
  await p.check("#rs-workout"); await p.locator(".rs-optional > summary").click(); await p.selectOption("#rs-climate","cool");
  await p.click('button:has-text("Generate my list")'); await p.waitForSelector("#rr-export");
  const labels = () => p.$$eval('.refine-item strong', n => n.map(x => x.textContent));
  const initial = await labels();
  if (!initial.includes("Socks ×9") || !initial.includes("Contacts ×10")) fail("initial quantities");
  if (initial.includes('Snacks') || !initial.includes('Medicine pouch')) fail('saved preferences not used');
  if(initial.includes('Small collapsible backpack'))fail('daypack included by default');
  for(const label of ['Kindle','Hotspot','Belkin charging pad','Garmin','Garmin charger','Extra phone case'])if(initial.includes(label))fail('optional item included by default: '+label);
  await p.click('button[aria-label="Trip extras"]');await p.check('#rf-extra-garmin');await p.check('#rf-extra-kindle');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  if(!(await labels()).includes('Garmin') || !(await labels()).includes('Garmin charger') || !(await labels()).includes('Kindle'))fail('selected extras missing');
  await p.reload();await p.waitForSelector('#rr-export');if(!(await labels()).includes('Garmin charger'))fail('selected extras lost on reload');
  await p.click('button[aria-label="Trip extras"]');await p.uncheck('#rf-extra-garmin');await p.uncheck('#rf-extra-kindle');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if((await labels()).includes('Garmin charger') || (await labels()).includes('Kindle'))fail('deselected extras retained');

  if(!initial.includes('Lulu shorts ×3') || !initial.includes('T-shirts ×4'))fail('daily workouts must share regular clothes with full shorts coverage');
  if(await p.locator('[data-item-id="pack:light-packable-puffer-jacket"]').evaluate(n=>n.closest('section').querySelector('h3').textContent)!=='Clothing')fail('carry-on moved puffer');
  if(await p.locator('.refine-item summary').count())fail('row explanations returned');
  await p.click('button:has-text("Packing rules")');if(!(await p.textContent('.sheet-body')).includes('Workouts most days'))fail('workout rules not inspectable');await p.click('button:has-text("Close")');

  for(const [name,ids] of [['Packing',['rf-packing']],['Extras',['rf-extra-kindle','rf-extra-hotspot','rf-extra-chargingPad','rf-extra-garmin','rf-extra-phoneCase']],['Weather',['rf-climate','rf-thermal','rf-rain','rf-warmWeather']],['Activities',['rf-hike','rf-workout','rf-water','rf-fish','rf-daypack','rf-rugged']],['Outfits & work',['rf-work','rf-workDays','rf-formal','rf-dinners']],['Laundry',['rf-laundry','rf-first','rf-interval']]]){
    if(name==='Outfits & work'){await p.getByRole('button',{name,exact:true}).click();await p.getByRole('button',{name:'Days & work equipment',exact:true}).click();}else await p.click(`button[aria-label="${name==='Extras' ? 'Trip extras':name}"]`);
    const actual=await p.locator('.sheet-body input, .sheet-body select').evaluateAll(nodes=>nodes.map(n=>n.id));
    if(JSON.stringify(actual)!==JSON.stringify(ids))fail(`${name} editor contains unrelated fields`);
    if(name==='Packing' && (await p.locator('#rf-packing').textContent()).includes('lighter'))fail('pack lighter still offered');
    await mobileLayout();await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  }
  await p.click('button[aria-label="Weather"]');await p.selectOption('#rf-thermal','hot');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  if(!(await labels()).includes('Light packable puffer jacket'))fail('running hot removed cool-weather puffer');
  await p.click('button[aria-label="Activities"]');if(await p.locator('#rf-rugged').isVisible())fail('rugged toggle visible without hiking');await p.check('#rf-hike');if(!await p.locator('#rf-rugged').isVisible())fail('rugged toggle missing');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  if((await labels()).includes('Hiking boots / trail shoes'))fail('ordinary hiking added extra footwear');
  if((await labels()).includes('Small collapsible backpack'))fail('hiking automatically added daypack');
  await p.click('button[aria-label="Activities"]');await p.check('#rf-daypack');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if(!(await labels()).includes('Small collapsible backpack'))fail('daypack toggle did not add item');
  await p.reload();await p.waitForSelector('#rr-export');if(!(await labels()).includes('Small collapsible backpack'))fail('daypack choice lost on reload');
  await p.click('button[aria-label="Activities"]');await p.uncheck('#rf-daypack');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if((await labels()).includes('Small collapsible backpack'))fail('daypack toggle did not remove item');

  await p.click('button[aria-label="Activities"]');await p.check('#rf-rugged');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if(!(await labels()).includes('Hiking boots / trail shoes'))fail('rugged hiking footwear missing');
  await p.click('button[aria-label="Activities"]');await p.uncheck('#rf-hike');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});if((await labels()).includes('Hiking boots / trail shoes'))fail('obsolete hiking footwear retained');
  await p.getByRole('button',{name:'Outfits & work',exact:true}).click();await p.getByRole('button',{name:'Days & work equipment',exact:true}).click();if(await p.locator('.sheet-body input, .sheet-body select').count()!==4)fail('unified outfit counts missing'); await p.selectOption('#rf-work','work'); await p.fill('#rf-workDays','0'); await p.click('button:has-text("Apply & recalculate")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  if (!(await labels()).includes('Work computer charger')) fail('work power dependency');
  await p.evaluate(()=>{window.testWorkSection=[...document.querySelectorAll('section.panel')].find(n=>n.querySelector('h3')?.textContent==='Work');});
  await p.locator('[data-item-id="pack:socks"]').getByRole('button',{name:'Edit',exact:true}).click(); await p.fill('#ri-quantity','7'); await p.click('button:has-text("Save override")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  await p.click('button[aria-label="Laundry"]'); await p.selectOption('#rf-laundry','yes'); await p.fill('#rf-first','2'); await p.fill('#rf-interval','2'); await p.click('button:has-text("Apply & recalculate")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  if (!(await labels()).includes('Socks ×7') || !(await labels()).includes('T-shirts ×2') || !(await labels()).includes('Contacts ×10')) fail('laundry recalculation erased override or changed contacts');
  if(!await p.evaluate(()=>window.testWorkSection===[...document.querySelectorAll('section.panel')].find(n=>n.querySelector('h3')?.textContent==='Work')))fail('unaffected work section was replaced');
  await p.reload(); await p.waitForSelector('#rr-export'); if (!(await labels()).includes('Socks ×7')) fail('override lost after reload');
  await p.locator('[data-item-id="pack:socks"]').getByRole('button',{name:'Return to automatic',exact:true}).click(); await p.waitForFunction(()=>document.querySelector('[data-item-id="pack:socks"] strong').textContent==='Socks ×5');
  await p.locator('[data-item-id="pack:wrinkle-release"]').getByRole('button',{name:'Remove',exact:true}).click(); await p.click('button:has-text("Usually don’t pack this")'); await p.waitForSelector('.sheet-bg',{state:'detached'});
  if ((await labels()).includes('Wrinkle release')) fail('default exclusion not applied');
  await p.click('button:has-text("Packing preferences")'); if (!/Wrinkle release/.test(await p.textContent('.sheet-body'))) fail('default exclusion not inspectable');
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
  await p.click('#rr-export');await p.waitForSelector('#rr-outfitSummary');await p.waitForSelector('#pe-enex');
  const downloadPromise = p.waitForEvent('download'); await p.click('#pe-enex'); const download=await downloadPromise; const exported=await readFile(await download.path(),'utf8');
  if (!exported.includes('<en-todo checked="false"/>') || exported.includes('Work computer packed?') || !exported.includes('Socks ×5')) fail('native Notes export did not reflect refinements');
  if (exported.includes('<h1>')) fail('duplicate Notes title');
  await p.click('button:has-text("Close")');
  for (const width of [360,390,430]){ for (const colorScheme of ['light','dark']){
    await p.setViewportSize({width,height:844}); await p.emulateMedia({colorScheme});
    if (await p.evaluate(()=>document.documentElement.scrollWidth > innerWidth)) fail(`refinement review overflow at ${width} ${colorScheme}`);
  }}
  const legacyPage=await testPage({viewport:{width:390,height:844}});await legacyPage.goto(B+'packing-list/');
  await legacyPage.evaluate(()=>{localStorage.setItem('ta:trips/OLD',JSON.stringify({name:'Old trip',where:'Phoenix',start:'2026-10-08',end:'2026-10-12'}));localStorage.setItem('ta:trip/OLD/pack_meta/draft',JSON.stringify({groups:[{title:'Clothing',items:['Socks ×3','Special shirt ×2']}]}));location.hash='OLD';});
  await legacyPage.reload();await legacyPage.waitForSelector('#rr-export');
  if(!/Socks ×3/.test(await legacyPage.textContent('#view')))fail('legacy draft not preserved');
  await legacyPage.click('button[aria-label="Laundry"]');await legacyPage.click('button:has-text("Enable automatic refinement")');await legacyPage.waitForSelector('.sheet-bg',{state:'detached'});
  if(await legacyPage.locator('[data-item-id="pack:socks"]').count()!==1)fail('legacy migration duplicated socks');
  await legacyPage.locator('[data-item-id="pack:socks"]').getByRole('button',{name:'Return to automatic',exact:true}).click();await legacyPage.waitForFunction(()=>document.querySelector('[data-item-id="pack:socks"] strong').textContent==='Socks ×9');
  if(!/Special shirt ×2/.test(await legacyPage.textContent('#view')))fail('legacy custom item lost');await legacyPage.close();
  // Export guides unresolved work/dinner/suit decisions instead of silently using preliminary quantities.
  const q=await testPage({viewport:{width:390,height:844}});q.on('pageerror',e=>errs.push(e.message));await q.goto(B+'packing-list/');
  await q.evaluate(()=>{var t={id:'WARDROBE',name:'Work and suit trip',where:'Phoenix',start:'2026-10-08',end:'2026-10-14'};localStorage.setItem('ta:trips/'+t.id,JSON.stringify(t));var s=refineNewState(t,{work:'laptop',formal:2,dinners:3});localStorage.setItem('ta:'+refinePath(t.id),JSON.stringify(s));location.hash=t.id;});await q.reload();await q.waitForSelector('#rr-export');
  await q.click('#rr-export');await q.waitForSelector('#rf-workDays');if(await q.locator('#pe-enex').count())fail('export bypassed required decisions');await q.fill('#rf-workDays','6');await q.click('button:has-text("Apply & next")');
  await q.waitForSelector('#rf-dinnerTop');if(await q.locator('button:has-text("Skip")').count())fail('required dinner decision can be skipped');await q.selectOption('#rf-dinnerTop','buttonup');await q.selectOption('#rf-dinnerBottoms','khakis');await q.click('button:has-text("Apply & next")');
  await q.waitForSelector('#rf-alternateKhakis');await q.check('#rf-alternateKhakis');if(!await q.locator('#rf-tie').isChecked())fail('usual professional ties missing');await q.click('button:has-text("Apply & next")');
  await q.waitForSelector('#rf-shirtOverlapAuto');if(!await q.locator('#rf-shirtOverlapAuto').isChecked())fail('overlap should default to maximum');await q.click('button:has-text("Apply & next")');await q.waitForSelector('#rr-outfitSummary');await q.waitForSelector('#pe-enex');
  const outfitDownload=q.waitForEvent('download');await q.click('#pe-enex');const outfit=await readFile(await (await outfitDownload).path(),'utf8');if(!outfit.includes('Button-up long sleeve shirt ×6') || !outfit.includes('White dress shirts ×2') || outfit.includes('Undershirt'))fail('incorrect wardrobe export');await q.click('button:has-text("Close")');
  if(await q.locator('[data-item-id="pack:khakis"]').count()!==1 || await q.locator('[data-item-id="pack:belt"]').count()!==1)fail('khakis or belt duplicated across suit/dinners');
  await q.click('button[aria-label="Laundry"]');await q.selectOption('#rf-laundry','yes');await q.fill('#rf-first','2');await q.fill('#rf-interval','2');await q.click('button:has-text("Apply & recalculate")');await q.waitForSelector('.sheet-bg',{state:'detached'});
  if(await q.locator('[data-item-id="pack:button-up-long-sleeve-shirt"] strong').textContent()!=='Button-up long sleeve shirt ×6')fail('laundry reduced work shirts');
  await q.click('button[aria-label="Packing"]');await q.selectOption('#rf-packing','extra');await q.click('button:has-text("Apply & recalculate")');await q.waitForSelector('.sheet-bg',{state:'detached'});if(await q.locator('[data-item-id="pack:socks"] strong').textContent()!=='Socks ×5')fail('laundry and extra buffers stacked');
  await q.getByRole('button',{name:'Outfits & work',exact:true}).click();await q.getByRole('button',{name:'Days & work equipment',exact:true}).click();await q.fill('#rf-dinners','4');await q.click('button:has-text("Apply & recalculate")');await q.waitForSelector('#rf-dinnerTop');await q.selectOption('#rf-dinnerTop','polo');await q.click('button:has-text("Apply & next")');await q.click('button:has-text("Review full list")');await q.waitForSelector('.sheet-bg',{state:'detached'});if(await q.locator('[data-item-id="pack:polo-shirts"] strong').textContent()!=='Polo shirts ×4')fail('dinner style did not recalculate');
  await q.reload();await q.waitForSelector('#rr-export');await q.click('#rr-export');await q.waitForSelector('#pe-enex');await q.click('button:has-text("Close")');
  for(const width of [360,390,430]){for(const colorScheme of ['light','dark']){await q.setViewportSize({width,height:844});await q.emulateMedia({colorScheme});if(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth))fail('wardrobe mobile overflow');}}await q.close();
  // Embedded test mode reuses one scenario and isolates every write from live data.
  const sandbox=await testPage({viewport:{width:390,height:844}});sandbox.on('pageerror',e=>errs.push(e.message));
  await sandbox.goto(B+'packing-list/');
  const realBefore=await sandbox.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>!k.startsWith('packing-test:')).map(k=>[k,localStorage.getItem(k)])));
  await sandbox.click('button:has-text("Test flow")');await sandbox.click('a:has-text("Open test flow")');await sandbox.waitForSelector('button:has-text("Choose a test scenario")');
  await sandbox.click('button:has-text("Choose a test scenario")');await sandbox.click('button:has-text("Reset & generate list")');await sandbox.waitForSelector('#rr-export');
  if(await sandbox.locator('[data-item-id="pack:tie"] strong').textContent()!=='Tie ×2')fail('test scenario did not use production suit rules');
  await sandbox.click('button[aria-label="Packing"]');await sandbox.selectOption('#rf-packing','extra');await sandbox.click('button:has-text("Apply & recalculate")');await sandbox.waitForSelector('.sheet-bg',{state:'detached'});
  await sandbox.reload();await sandbox.waitForSelector('#rr-export');if(await sandbox.evaluate(()=>refineLoad(TRIPS['PACKING-TEST']).refinements.packingMode)!=='extra')fail('test edits did not persist');
  await sandbox.click('button:has-text("Packing preferences")');await sandbox.getByLabel('Include Snacks',{exact:true}).uncheck();await sandbox.click('button:has-text("Save my preferences")');await sandbox.waitForSelector('.sheet-bg',{state:'detached'});
  await sandbox.click('button:has-text("Test menu / reset")');await sandbox.selectOption('#pt-scenario','laundry');await sandbox.click('button:has-text("Reset & test setup")');await sandbox.waitForSelector('#rs-where');
  if(await sandbox.evaluate(()=>Object.keys(Store.exportAll()).filter(k=>k.startsWith('trips/')).length)!==1)fail('test reset accumulated trips');
  await sandbox.click('button:has-text("Update trip & list")');await sandbox.waitForSelector('#rr-export');
  if(await sandbox.locator('[data-item-id="pack:socks"] strong').textContent()!=='Socks ×9')fail('laundry scenario quantities');
  await sandbox.click('button:has-text("Validate current test")');await sandbox.waitForSelector('[data-current-check]');if(await sandbox.locator('[data-current-check="FAIL"]').count())fail('current test validation failed');await sandbox.click('button:has-text("Close")');
  await sandbox.click('button:has-text("Test menu / reset")');await sandbox.click('button:has-text("Run fixed regression checks")');await sandbox.waitForSelector('[data-test-check]');if(await sandbox.locator('[data-test-check="fail"]').count())fail('embedded scenario checks failed: '+await sandbox.locator('[data-test-check="fail"]').allTextContents());await sandbox.click('button:has-text("Close")');
  await sandbox.locator('[data-item-id="pack:wrinkle-release"]').getByRole('button',{name:'Remove',exact:true}).click();await sandbox.click('button:has-text("Usually don’t pack this")');await sandbox.waitForSelector('.sheet-bg',{state:'detached'});
  await sandbox.click('button[aria-label="Packing"]');await sandbox.selectOption('#rf-packing','extra');await sandbox.click('button:has-text("Apply & recalculate")');await sandbox.waitForSelector('.sheet-bg',{state:'detached'});
  await sandbox.locator('.refine-changes').getByRole('button',{name:'Undo',exact:true}).click();await sandbox.waitForFunction(()=>document.querySelector('.refine-changes').textContent.includes('Last change undone'));
  if(!await sandbox.evaluate(()=>!!generatorPrefs().refinementProfile.excluded['pack:wrinkle-release']))fail('Undo of packing erased an older preference exclusion');
  const savedBefore=await sandbox.evaluate(()=>({trip:lsGet('ta:trips/PACKING-TEST'),state:lsGet('ta:'+refinePath('PACKING-TEST'))}));
  await sandbox.click('a[aria-label^="Trip details"]');await sandbox.waitForSelector('#rs-where');
  const nextEndLabel=await sandbox.evaluate(()=>{var d=pd(TRIPS['PACKING-TEST'].end);d.setDate(d.getDate()+1);return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});});await sandbox.locator('.rp-sum button').nth(1).click();for(let n=0;n<3 && !(await sandbox.getByRole('button',{name:nextEndLabel,exact:true}).count());n++)await sandbox.getByRole('button',{name:'Next month',exact:true}).click();await sandbox.getByRole('button',{name:nextEndLabel,exact:true}).click();await sandbox.getByRole('button',{name:'OK',exact:true}).click();
  await sandbox.evaluate(()=>{window.testOriginalDoc=db.doc;db.doc=function(path){var doc=window.testOriginalDoc(path);if(path===refinePath('PACKING-TEST'))doc.set=function(){return Promise.reject(new Error('Injected second write failure'));};return doc;};document.querySelector('.rs-form').requestSubmit();});
  await sandbox.waitForFunction(()=>document.querySelector('.rs-form .gen-error').textContent.includes('Could not save'));
  const savedAfter=await sandbox.evaluate(()=>{db.doc=window.testOriginalDoc;return {trip:lsGet('ta:trips/PACKING-TEST'),state:lsGet('ta:'+refinePath('PACKING-TEST'))};});
  if(JSON.stringify(savedBefore)!==JSON.stringify(savedAfter))fail('Failed second write left dates or state changed');await sandbox.reload();await sandbox.waitForSelector('#rs-where');await sandbox.click('a:has-text("Cancel")');await sandbox.waitForSelector('#rr-export');

  await sandbox.goto(B+'packing-list/?test=1#rules');await sandbox.waitForSelector('.gen-rule');if(/Kindle always|1 day of dress clothes by default|fewer pants/.test(await sandbox.textContent('#view')))fail('legacy rules prose still displayed');await sandbox.goto(B+'packing-list/?test=1#PACKING-TEST');await sandbox.waitForSelector('#rr-export');
  await sandbox.click('button:has-text("Test menu / reset")');await sandbox.selectOption('#pt-scenario','one-day');await sandbox.fill('#pt-name','Five-day suit variant');await sandbox.fill('#pt-days','5');await sandbox.fill('#pt-workDays','3');await sandbox.fill('#pt-formal','2');await sandbox.fill('#pt-dinners','2');await sandbox.click('button:has-text("Save setup configuration")');await sandbox.waitForFunction(()=>document.querySelector('#pt-error').textContent.includes('Scenario saved'));await sandbox.click('button:has-text("Reset & generate list")');await sandbox.waitForSelector('#rr-export');
  if(await sandbox.evaluate(()=>refineLoad(TRIPS['PACKING-TEST']).refinements.formalDays)!==2)fail('configured suit days not applied');
  if(await sandbox.evaluate(()=>refineDays(TRIPS['PACKING-TEST'].start,TRIPS['PACKING-TEST'].end))!==5)fail('configured trip length not applied');
  await sandbox.click('button:has-text("Test menu / reset")');if(!(await sandbox.locator('#pt-scenario').textContent()).includes('Five-day suit variant'))fail('saved variant disappeared on reset');await sandbox.selectOption('#pt-scenario','long-trip');await sandbox.click('button:has-text("Reset & generate list")');await sandbox.waitForSelector('#rr-export');
  if(await sandbox.evaluate(()=>refineLoad(TRIPS['PACKING-TEST']).refinements.laundry.firstWash)!==3)fail('configured first wash not applied');
  await sandbox.click('button:has-text("Test menu / reset")');if(!(await sandbox.locator('#pt-scenario').textContent()).includes('Five-day suit variant'))fail('reset deleted the scenario library');await sandbox.click('button:has-text("Close")');
  const realAfter=await sandbox.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>!k.startsWith('packing-test:')).map(k=>[k,localStorage.getItem(k)])));
  if(JSON.stringify(realBefore)!==JSON.stringify(realAfter))fail('test flow changed live data');
  for(const width of [360,390,430]){await sandbox.setViewportSize({width,height:844});if(await sandbox.evaluate(()=>document.documentElement.scrollWidth>innerWidth))fail('test controls mobile overflow');}
  await sandbox.click('a:has-text("Exit test mode")');await sandbox.waitForSelector('button:has-text("Test flow")');if(await sandbox.locator('a.tripcard:has-text("Test ·")').count())fail('test trip leaked into live trips');await sandbox.close();
  await p.goto(B + "itinerary-generator/"); await p.click("a.tripcard");
  await p.click("text=+ Flight"); await p.fill("#fl-day", "2026-10-08"); await p.fill("#fl-no", "UA 1234"); await p.fill("#fl-to", "PHX"); await p.fill("#fl-dep", "15:05"); await p.fill("#fl-arr", "17:40");
  await p.click('button:has-text("Add flight")'); await p.waitForTimeout(1000);
  await p.click("text=+ Lodging"); await p.fill("#lg-name", "Hyatt Place Phoenix"); await p.fill("#lg-addr", "1 E Main St, Phoenix, AZ"); await p.fill("#lg-in", "2026-10-08"); await p.fill("#lg-out", "2026-10-12");
  await p.click('button:has-text("Add lodging")'); await p.waitForTimeout(1200);
  const d1 = await p.textContent('section.day[data-date="2026-10-08"]');
  if (!/11:35a/.test(d1) || !/Leave home for/.test(d1) || !/Lodging · 4 nights/.test(d1)) fail("itinerary day 1: " + d1.replace(/\s+/g, " ").slice(0, 200));
  if ((await p.$$("section.day")).length !== 5) fail("expected 5 days");
} catch (e) { fail(e.stack || e.message); }
if (errs.length) fail("page errors: " + errs.join(" | "));
if(apiCalls)fail('routine refinement made an AI API call');
await b.close(); srv.close();
if (!process.exitCode) console.log("OK: packing list and itinerary generator pass");
