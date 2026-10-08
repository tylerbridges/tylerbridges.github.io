// Start from a past trip (fields, item edits, fresh quantities, exclusive with styles) and short-quantity warnings after date changes.
import http from 'node:http';import {readFile} from 'node:fs/promises';import {join,dirname,extname} from 'node:path';import {fileURLToPath} from 'node:url';
let pw;try{pw=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');}catch{console.log('SKIP: playwright not installed');process.exit(0);}
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),server=http.createServer(async(req,res)=>{let path=req.url.split('?')[0];if(path.endsWith('/'))path+='index.html';try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)] || 'application/octet-stream');res.end(await readFile(join(root,path)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=process.env.PACKING_BASE_URL || `http://127.0.0.1:${server.address().port}/packing-list/`,browser=await pw.chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined}),p=await browser.newPage({viewport:{width:390,height:844}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
function assert(value,message){if(!value)throw new Error(message);}
async function month(){for(let n=0;n<24;n++){const m=await p.locator('.rp-head b').textContent();if(m==='October 2026')return;await p.locator('.rp-head button').nth(new Date(m+' 1')<new Date(2026,9,1) ? 1:0).click();}}
async function dates(a,b){await p.locator('.rp-sum button').first().click();await month();await p.locator(`.rp-grid button[aria-label*="Oct ${a}"]`).click();await p.locator(`.rp-grid button[aria-label*="Oct ${b}"]`).click();await p.getByRole('button',{name:'OK',exact:true}).click();}
async function closed(){await p.waitForSelector('.sheet-bg',{state:'detached'});}
async function row(id){return p.locator(`[data-item-id="${id}"]`);}
const load=()=>p.evaluate(()=>refineLoad(route().t));
async function mobile(label){for(const width of [360,390,430])for(const colorScheme of ['light','dark']){await p.setViewportSize({width,height:844});await p.emulateMedia({colorScheme});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflows at '+width+' '+colorScheme);}await p.setViewportSize({width:390,height:844});}
try{
  // The first trip: workouts, Pack extra, and explicit edits (quantity, rename + move, removal, addition).
  await p.goto(base+'?test=1#new');await p.waitForSelector('#rs-style');await p.fill('#rs-where','Chicago');await dates(8,14);await p.check('#rs-workout');await p.check('#rs-extra-kindle');await p.click('button:has-text("Generate my list")');await p.waitForSelector('#rr-export');
  const pastId=await p.evaluate(()=>route().t.id);
  await p.click('button[aria-label="Packing"]');await p.selectOption('#rf-packing','extra');await p.click('button:has-text("Apply & recalculate")');await closed();
  await (await row('pack:tshirts')).getByRole('button',{name:'Edit',exact:true}).click();await p.fill('#ri-quantity','1');await p.click('button:has-text("Save override")');await closed();
  await (await row('pack:toothpaste')).getByRole('button',{name:'Edit',exact:true}).click();await p.fill('#ri-label','Travel toothpaste');await p.selectOption('#ri-section','Dry toiletries');await p.click('button:has-text("Save override")');await closed();
  await (await row('pack:wrinkle-release')).getByRole('button',{name:'Remove',exact:true}).click();await p.click('button:has-text("Remove for this trip")');await closed();
  await p.click('#rr-add');await p.fill('#ra-label','Camera');await p.fill('#ra-quantity','2');await p.selectOption('#ra-section','Gear');await p.click('button:has-text("Add item")');await closed();
  let past=await load();assert(past.overrides.edited['pack:tshirts'].autoQuantity===7 && past.overrides.edited['pack:tshirts'].quantity===1,'edit did not store the automatic quantity at edit time');

  // New trip: the past-trip select reuses fields, is exclusive with styles, and never copies dates, destination, weather or counts.
  await p.goto(base+'?test=1#new');await p.waitForSelector('#rs-past');const options=await p.locator('#rs-past option').allTextContents();assert(options[0]==='None' && options.some(x=>x.startsWith('Chicago')),'past trip missing from the select');
  await p.selectOption('#rs-climate','cold');await p.selectOption('#rs-past',pastId);
  assert(await p.isChecked('#rs-workout') && await p.isChecked('#rs-extra-kindle') && await p.inputValue('#rs-climate')==='unknown' && await p.inputValue('#rs-where')==='' && (await p.locator('.rp-sum b').allTextContents()).every(x=>x==='Select date'),'past trip fields not reused, or dates/weather copied');
  let note=await p.textContent('#rs-style-note');assert(await p.isVisible('#rs-style-note'),'past trip note hidden');assert(/^Reusing Chicago/.test(note) && /Pack extra, no laundry/.test(note) && /1 added item, 1 removal, 1 renamed or moved item carry over/.test(note) && /Quantities are recalculated/.test(note),'past trip note unclear: '+note);
  await p.selectOption('#rs-style','weekend');assert(await p.inputValue('#rs-past')==='' && !await p.isChecked('#rs-workout') && await p.inputValue('#rs-mode')==='drive','choosing a style did not reset the past trip');
  await p.selectOption('#rs-past',pastId);assert(await p.inputValue('#rs-style')==='' && await p.isChecked('#rs-workout') && await p.inputValue('#rs-mode')==='fly','choosing a past trip did not reset the style');
  await mobile('setup with past trip');
  await p.fill('#rs-where','Denver');await dates(20,23);await p.click('button:has-text("Generate my list")');await p.waitForSelector('#rr-export');
  let state=await load();const newId=state.inputs.where==='Denver' && await p.evaluate(()=>route().t.id);
  assert(newId && newId!==pastId && state.inputs.start==='2026-10-20' && state.refinements.climate==='unknown' && state.refinements.packingMode==='extra' && !state.refinements.laundry.available && state.inputs.activities.workout && state.refinements.extraItems.kindle,'new trip inputs wrong');
  assert(!state.overrides.edited['pack:tshirts'] && state.overrides.edited['pack:toothpaste'] && state.overrides.edited['pack:toothpaste'].quantity==null && state.overrides.removed['pack:wrinkle-release'] && Object.values(state.overrides.added).some(x=>x.label==='Camera' && x.quantity===2),'item edits not carried as specified');
  const page=await p.textContent('.gen-review');assert(page.includes('Travel toothpaste') && page.includes('Camera ×2') && !await p.locator('[data-item-id="pack:wrinkle-release"]').count() && page.includes('Removed for this trip · 1'),'carried items not shown');
  const fresh=await p.evaluate(()=>{var t=route().t,s=refineLoad(t),a=clone(s);a.overrides={removed:{},edited:{},added:{}};a.ruleResults={};return refineEvaluate(a,generatorPrefs(),null).items.find(x=>x.id==='pack:tshirts').quantity;});
  assert(await (await row('pack:tshirts')).textContent().then(x=>x.includes('T-shirts ×'+fresh) && !x.includes('Manual override')),'T-shirt quantity not fresh');
  assert(await (await row('pack:toothpaste')).locator('..').locator('h3').textContent()==='Dry toiletries','carried section edit lost');
  const ledger=await p.evaluate(id=>packingLearningLoad().editTrips[id],newId);assert(ledger && !ledger.items['pack:wrinkle-release'] && !Object.keys(ledger.added).length,'carried edits counted as new learning evidence before export');
  await (await row('pack:toothpaste')).getByRole('button',{name:'Return to automatic',exact:true}).click();await p.waitForFunction(()=>!refineLoad(route().t).overrides.edited['pack:toothpaste']);await p.waitForFunction(()=>{var r=document.querySelector('[data-item-id="pack:toothpaste"]');return r && /^Toothpaste/.test(r.textContent) && !/Manual override/.test(r.textContent) && r.closest('section').querySelector('h3').textContent==='Liquid toiletries';});
  state=await load();assert(state.carried && !state.carried.edited['pack:toothpaste'] && state.carried.added,'reverted carried edit still marked as carried');

  // Short-quantity warning: a deliberate lower quantity is quiet until the automatic quantity rises after a date change.
  const before=await p.evaluate(()=>refineEvaluate(refineLoad(route().t),generatorPrefs(),[]).autoQuantities['pack:tshirts']);
  await (await row('pack:tshirts')).getByRole('button',{name:'Edit',exact:true}).click();await p.fill('#ri-quantity',String(before-1));await p.click('button:has-text("Save override")');await closed();
  state=await load();assert(state.overrides.edited['pack:tshirts'].autoQuantity===before,'auto quantity not stored at edit time');assert(!(await p.textContent('.gen-review')).includes('this trip now needs'),'deliberate lower quantity warned');
  await p.goto(base+'?test=1#'+newId+'.edit');await p.waitForSelector('.rp-sum');await p.locator('.rp-sum button').nth(1).click();await month();await p.locator('.rp-grid button[aria-label*="Oct 26"]').click();await p.getByRole('button',{name:'OK',exact:true}).click();await p.click('button:has-text("Update trip & recalculate")');await p.waitForSelector('#rr-export');
  const after=await p.evaluate(()=>refineEvaluate(refineLoad(route().t),generatorPrefs(),[]).autoQuantities['pack:tshirts']);assert(after>before,'date extension did not raise T-shirts');
  const warning=p.locator('.refine-warning p',{hasText:'this trip now needs'});await warning.waitFor();assert((await warning.textContent()).startsWith('T-shirts ×'+(before-1)+' is below the '+after+' this trip now needs.'),'warning text wrong: '+await warning.textContent());
  assert((await (await row('pack:tshirts')).textContent()).includes('T-shirts ×'+(before-1)),'manual quantity changed without confirmation');
  await mobile('review with short-quantity warning');
  await warning.getByRole('button',{name:'Use new amount',exact:true}).click();await p.waitForFunction(q=>refineLoad(route().t).overrides.edited['pack:tshirts'].quantity===q,after);
  assert(!(await p.textContent('.gen-review')).includes('this trip now needs'),'Use new amount did not clear the warning');assert((await (await row('pack:tshirts')).textContent()).includes('T-shirts ×'+after),'new amount not used');
  state=await load();assert(state.overrides.edited['pack:tshirts'].autoQuantity===after,'new amount not recorded as the edit-time automatic quantity');
  await p.getByRole('button',{name:'Undo',exact:true}).click();await p.waitForFunction(q=>refineLoad(route().t).overrides.edited['pack:tshirts'].quantity===q,before-1);await p.locator('.refine-warning p',{hasText:'this trip now needs'}).waitFor();
  // Exporting makes the still-carried edits this trip's own learning evidence.
  await p.waitForFunction(()=>document.querySelector('#pe-enex') && !document.querySelector('#pe-enex').disabled);const download=p.waitForEvent('download');await p.click('#pe-enex');await download;
  await p.waitForFunction(id=>{var e=packingLearningLoad().editTrips[id];return e && e.items['pack:wrinkle-release'] && e.items['pack:wrinkle-release'].change==='removed' && e.added.camera;},newId);
  assert(!errors.length,errors.join('\n'));
  console.log('OK: past-trip select reuses fields and explicit item edits with fresh quantities, exclusive with styles, carried edits revertible and held from learning until export, then observed, short-quantity warning after a date change with Use new amount and Undo, mobile layout');
}finally{await browser.close();server.close();}
