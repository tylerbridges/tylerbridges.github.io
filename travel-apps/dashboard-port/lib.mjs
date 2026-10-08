// Shared harness helpers: static server, seed data, browser page with the mock window.claude.
import http from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {join, extname, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Paths (env overrides; defaults assume dash-port/, dash-orig/ and this folder side by side):
//   DASH_PORT   Dashboard copy with the port   (default ../dash-port)
//   DASH_ORIG   untouched Dashboard copy       (default ../dash-orig)
//   TRAVEL_APPS standalone travel-apps folder  (default ../travel-apps; only visual.mjs and tools/scope-css.mjs use it)
//   SHOTS       screenshot folder              (default ./shots)
//   PLAYWRIGHT_MODULE  path to playwright's index.js (default: the "playwright" package)
export const HERE = dirname(fileURLToPath(import.meta.url));
export const DIRS = {port:resolve(process.env.DASH_PORT || join(HERE, '..', 'dash-port')), orig:resolve(process.env.DASH_ORIG || join(HERE, '..', 'dash-orig')),
  apps:resolve(process.env.TRAVEL_APPS || join(HERE, '..', 'travel-apps')), shots:resolve(process.env.SHOTS || join(HERE, 'shots')) + '/'};
const pwMod = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
export const PW = pwMod.default || pwMod;
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
export async function serve(dir){
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    try { const body = await readFile(join(dir, p)); res.setHeader('Content-Type', TYPES[extname(p)] || 'application/octet-stream'); res.setHeader('Cache-Control','no-store'); res.end(body); }
    catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {server, url:`http://127.0.0.1:${server.address().port}/`};
}
function btype(s){ const l = (s.label || '') + ' ' + (s.detail || ''); if (/flight|outbound|return/i.test(s.label || '')) return 'flight'; if (/night|lodging|inn|resort|hotel|house/i.test(l)) return 'lodging'; if (/rental car/i.test(l)) return 'car'; return 'other'; }
// Seed: trips/*.json as live trips/<ID> docs (segments → bookings map, as live data is shaped), plus legacy Wyoming packing docs.
export async function seed(dir){
  const idx = JSON.parse(await readFile(join(dir, 'trips/index.json'), 'utf8')), out = {};
  for (const id of idx.trips){
    const t = JSON.parse(await readFile(join(dir, 'trips', id + '.json'), 'utf8')); const b = {};
    (t.segments || []).forEach((s, i) => { b['b' + (i + 1)] = Object.assign({type:btype(s), order:i + 1}, s); });
    delete t.segments; t.bookings = b; out['trips/' + id] = t;
  }
  out['meta/main'] = {loose:idx.loose || [], monitors:idx.monitors || [], archived:idx.archived || []};
  const W = 'trip/REPLACEMENT-2026-09-19/';
  const secs = {'sec-w':{title:'Wear to travel', order:10, depart:false, note:''}, 'sec-c':{title:'Clothing', order:20, depart:false, note:''}, 'sec-t':{title:'Toiletries', order:30, depart:false, note:''}, 'sec-p':{title:'Personal bag & day gear', order:40, depart:false, note:'Daypack items'}, 'sec-d':{title:'Before leaving', order:9999, depart:true, note:'Departure checks, not packing. Run it last.'}};
  const items = [['sec-w','Brooks running shoes',true],['sec-w','Sweatshirt / hoodie',false],['sec-c','T-shirts ×8',true],['sec-c','Socks ×15',false],['sec-c','Underwear ×15',false],['sec-c','Lulu shorts ×4',true],['sec-c','Bear spray',false],
    ['sec-t','Toothbrush',true],['sec-t','Toothpaste',false],['sec-t','Contacts ×10',false],['sec-p','Binoculars',false],['sec-p','AirPods',true],['sec-d','Grab wallet',false],['sec-d','Liquids bag packed? (travel-size, quart bag)',false]];
  Object.entries(secs).forEach(([k, v]) => { out[W + 'pack_sections/' + k] = v; });
  items.forEach(([s, l, c], i) => { out[W + 'pack_items/it-legacy' + i] = {label:l, hint: l === 'Bear spray' ? 'Buy in Jackson' : '', section:s, order:(i + 1) * 10, checked:c, at:1758000000000 + i}; });
  out[W + 'pack_meta/original'] = {at:1758000000000, context:{source:'builder', tags:['hike','cool'], luggage:'carryon', where:'Wyoming', travelDays:8}, groups:[{title:'Clothing', depart:false, items:['T-shirts ×8','Socks ×16']}]};
  out['meta/packing'] = {rules:['Old dashboard rule'], lessons:[], learned:{}, updatedAt:'2026-09-30'};
  return out;
}
export async function open(browser, base, seedData, opts = {}){
  const ctx = await browser.newContext({viewport:{width:opts.width || 390, height:844}, colorScheme:opts.colorScheme || 'light', acceptDownloads:true});
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.addInitScript(({seed, opts}) => { window.__MOCK_SEED = seed; window.__MOCK_OPTS = opts; }, {seed:seedData, opts:opts.mock || {}});
  await ctx.addInitScript({path: join(HERE, 'mock-claude.js')});
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  return {ctx, page, errors};
}
export function check(results, name, ok, detail){ results.push({name, ok:!!ok, detail:detail || ''}); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); }
