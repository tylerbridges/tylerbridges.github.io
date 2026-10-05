// Long trips without laundry require a Laundry answer before export; a banner flags list changes after the last export.
import http from 'node:http';import {readFile} from 'node:fs/promises';import {join,dirname,extname} from 'node:path';import {fileURLToPath} from 'node:url';
let pw;try{pw=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');}catch{console.log('SKIP: playwright not installed');process.exit(0);}
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),server=http.createServer(async(req,res)=>{let path=req.url.split('?')[0];if(path.endsWith('/'))path+='index.html';try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)] || 'application/octet-stream');res.end(await readFile(join(root,path)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=process.env.PACKING_BASE_URL || `http://127.0.0.1:${server.address().port}/packing-list/`,browser=await pw.chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined}),p=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true}),errors=[];p.on('pageerror',e=>errors.push(e.message));
function assert(value,message){if(!value)throw new Error(message);}
const BANNER='Changed since your last export — export again to update Notes.';
async function newTrip(where,lastDay){
  await p.goto(base+'?test=1#new');await p.waitForSelector('#rs-where');await p.fill('#rs-where',where);await p.locator('.rp-sum button').first().click();
  for(let n=0;n<24;n++){const m=await p.locator('.rp-head b').textContent();if(m==='October 2026')break;await p.locator('.rp-head button').nth(new Date(m+' 1')<new Date(2026,9,1) ? 1:0).click();}
  await p.locator('.rp-grid button[aria-label*="Oct 8"]').click();await p.locator('.rp-grid button[aria-label*="Oct '+lastDay+'"]').click();await p.getByRole('button',{name:'OK',exact:true}).click();
  await p.click('button:has-text("Generate my list")');await p.waitForSelector('#rr-export');
  return p.evaluate(()=>route().t.id);
}
const laundryCard=()=>p.locator('button.trip-plan-card[aria-label="Laundry"]');
const bannerShown=()=>p.locator('#rr-export-changed').isVisible();
async function exportMeta(id){return p.evaluate(id=>({doc:lsGet('ta:trip/'+id+'/pack_meta/export',null),real:localStorage.getItem('ta:trip/'+id+'/pack_meta/export'),sandbox:localStorage.getItem('packing-test:ta:trip/'+id+'/pack_meta/export')}),id);}
async function editTshirts(quantity){await p.locator('[data-item-id="pack:tshirts"]').getByRole('button',{name:'Edit',exact:true}).click();await p.fill('#ri-quantity',String(quantity));await p.click('button:has-text("Save override")');await p.waitForSelector('.sheet-bg',{state:'detached'});}
async function ready(){await p.waitForSelector('#pe-enex');await p.waitForFunction(()=>!document.querySelector('#pe-enex').disabled);}
try{
  // 9-day trip, no laundry: export is blocked until Laundry is confirmed.
  const id=await newTrip('Long trip',16);
  assert(await p.evaluate(()=>refineDays(route().t.start,route().t.end))===9,'trip should be 9 days');
  assert(await p.locator('#rr-confirm').isVisible() && await p.locator('#pe-enex').count()===0,'long trip without laundry exported before Laundry was confirmed');
  assert((await p.textContent('#rr-export')).includes('Confirm your laundry plan before exporting'),'export gate does not name the laundry plan');
  assert((await p.textContent('#rr-confirm')).trim()==='Confirm laundry plan','export gate button is still outfit-specific');
  assert(await laundryCard().evaluate(x=>x.classList.contains('needs-attention')) && (await laundryCard().textContent()).includes('Confirm laundry plan'),'Laundry card not marked as needing attention');
  assert(!await p.locator('button.trip-plan-card[aria-label="Outfits & work"]').evaluate(x=>x.classList.contains('needs-attention')),'Laundry counted as an outfit choice');
  assert((await p.textContent('.trip-plan-progress')).trim()==='1 choice to confirm','overall status should say one choice to confirm');
  assert(await p.locator('[data-item-id="pack:tshirts"]').textContent().then(x=>x.includes('×8')),'quantities should stay literal for every day before Laundry is answered');
  assert(!await bannerShown(),'export banner shown before any export');
  await p.click('#rr-confirm');await p.waitForSelector('#rf-laundry');
  assert(await p.inputValue('#rf-laundry')==='no','Laundry editor should start on the current no-laundry answer');
  assert((await p.textContent('.sheet')).includes('Long trip: confirm your laundry plan before export'),'Laundry step not explained as required');
  assert(await p.locator('button:has-text("Skip for now")').count()===0,'required Laundry step can be skipped');
  await p.click('button:has-text("Apply & next")');await p.waitForSelector('.sheet-bg',{state:'detached'});await ready();
  assert(!await laundryCard().evaluate(x=>x.classList.contains('needs-attention')),'Laundry card still needs attention after confirmation');
  assert(await p.locator('[data-item-id="pack:tshirts"]').textContent().then(x=>x.includes('×8')),'confirming no laundry changed quantities');
  // Confirmation survives reload.
  await p.reload();await p.waitForSelector('#rr-export');await ready();
  assert(await p.locator('#rr-confirm').count()===0,'confirmed no-laundry answer reopened after reload');
  assert((await p.evaluate(()=>refinePendingDecisions(refineLoad(route().t)))).length===0,'Laundry decision not saved');
  // Banner: absent before export, appears after an edit following an export, cleared after re-export.
  assert(!await bannerShown() && (await exportMeta(id)).doc===null,'export record exists before any export');
  let download=p.waitForEvent('download');await p.click('#pe-enex');await download;
  await p.waitForFunction(id=>!!lsGet('ta:trip/'+id+'/pack_meta/export',null),id);
  let meta=await exportMeta(id);assert(meta.sandbox && !meta.real,'export record ignored the test namespace');
  assert(!await bannerShown(),'banner shown right after exporting');
  await editTshirts(7);await p.waitForSelector('#rr-export-changed',{state:'visible'});
  assert((await p.textContent('#rr-export-changed')).trim()===BANNER,'banner wording changed');
  await p.reload();await p.waitForSelector('#rr-export');await p.waitForSelector('#rr-export-changed',{state:'visible'});
  await ready();await p.getByText('More export options',{exact:true}).click();download=p.waitForEvent('download');await p.click('#pe-md');await download;
  await p.waitForSelector('#rr-export-changed',{state:'hidden'});
  await editTshirts(6);await p.waitForSelector('#rr-export-changed',{state:'visible'});
  await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async()=>{}}}));await ready();
  if(!await p.locator('#pe-copy').isVisible())await p.getByText('More export options',{exact:true}).click();
  await p.click('#pe-copy');await p.waitForSelector('#rr-export-changed',{state:'hidden'});
  // Undo returns the list to a different state than the last export.
  await p.click('button:has-text("Undo")');await p.waitForSelector('#rr-export-changed',{state:'visible'});
  // Mobile layout with the banner and the long-trip state.
  for(const width of [360,390,430])for(const colorScheme of ['light','dark']){await p.setViewportSize({width,height:844});await p.emulateMedia({colorScheme});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width+' '+colorScheme);}
  await p.setViewportSize({width:390,height:844});
  // Deleting the list removes the export record with the other packing-owned meta.
  await p.click('button:has-text("Delete list")');await p.waitForFunction(()=>location.hash==='' || location.hash==='#');
  meta=await exportMeta(id);assert(meta.doc===null && meta.sandbox===null,'deleted list kept its export record');
  // A 6-day trip without laundry is not blocked.
  await newTrip('Short trip',13);await ready();
  assert(await p.locator('#rr-confirm').count()===0 && !await laundryCard().evaluate(x=>x.classList.contains('needs-attention')),'6-day trip was blocked on Laundry');
  assert(!await bannerShown(),'banner shown on a never-exported list');
  for(const width of [360,430])for(const colorScheme of ['light','dark']){await p.setViewportSize({width,height:844});await p.emulateMedia({colorScheme});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'short-trip overflow at '+width+' '+colorScheme);}
  assert(!errors.length,errors.join('\n'));
  console.log('OK: long trips without laundry require a Laundry answer that survives reload, short trips unaffected, export-changed banner after export/edit/re-export, namespaced record removed on delete, mobile layout');
}finally{await browser.close();server.close();}
