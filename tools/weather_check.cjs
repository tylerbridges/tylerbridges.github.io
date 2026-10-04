const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../wx-archive.js'), O = require('../wx-outlook.js');
const H = 3600000, start = Date.UTC(2026, 0, 1), end = start + 24 * H;
const props = { typetext: 'SNOW', unit: 'Inch', magnitude: '6', valid: new Date(end).toISOString(), lat: 45, lon: -93, qualifier: 'M', remark: '24-hour snowfall total.' };
const report = A.report(props);
const forecast = { source: 'nws', lat: 45, lon: -93, issued: start - H, recordedAt: start - H, grid: { snow: [[start, 12, 2], [start + 12 * H, 12, 3]] } };
test('verifies only forecasts issued and saved before the observed event', () => {
  assert.equal(A.match(forecast, report), 5);
  assert.equal(A.match({ ...forecast, issued: start + H }, report), null);
  assert.equal(A.match({ ...forecast, recordedAt: start + H }, report), null);
});
test('does not estimate missing, overlapping or partial forecast blocks', () => {
  assert.equal(A.total([[start, 24, 5]], start + H, end), null);
  assert.equal(A.total([[start, 12, 2]], start, end), null);
  assert.equal(A.total([[start, 24, null]], start, end), null);
  assert.equal(A.total([[start, 24, 5], [start, 24, 5]], start, end), null);
  assert.equal(A.total([[start, 24, 0]], start, end), 0);
});
test('keeps nearby, estimated and duration-unknown reports out of verification', () => {
  assert.equal(A.match({ ...forecast, lon: -93.1 }, report), null);
  assert.equal(A.match(forecast, A.report({ ...props, qualifier: 'E' })), null);
  assert.equal(A.report({ ...props, remark: 'Storm total.' }).start, null);
  assert.equal(A.report({ ...props, remark: '24-hour snowfall total; 2 inches in the last 6 hours.' }).start, null);
  assert.equal(A.report({ ...props, typetext: 'SLEET' }), null);
  assert.equal(A.report({ ...props, unit: 'Feet' }), null);
  assert.equal(A.report({ ...props, lat: null, lon: null }), null);
});
test('model verification requires identical accumulation periods and measurement', () => {
  const f = { ...forecast, source: 'hrrr', kind: 'snow', start, end, value: 7 };
  assert.equal(A.match(f, report), 7);
  assert.equal(A.match({ ...f, start: start - H }, report), null);
  assert.equal(A.match({ ...f, kind: 'rain' }, report), null);
});
test('rainfall alone does not verify total precipitation that could include snow or ice water', () => {
  const r = { ...report, kind: 'rain' }, f = { ...forecast, grid: { qpf: [[start, 24, 1]], snow: [[start, 24, 2]], ice: [[start, 24, 0]] } };
  assert.equal(A.match(f, r), null);
  assert.equal(A.match({ ...f, grid: { ...f.grid, snow: [[start, 24, 0]] } }, r), 1);
  assert.equal(A.match(f, { ...r, liquidEquivalent: true }), 1);
  const m = { ...f, source: 'gfs', kind: 'rain', value: 1, start, end };
  assert.equal(A.match(m, r), null);
  assert.equal(A.match(m, { ...r, liquidEquivalent: true }), 1);
});
test('winter timeline preserves overlapping types, breaks gaps and excludes missing temperatures', () => {
  const g = { start, n: 5, s: { snow: [1, 1, 0, 1, 0], fzra: [0, 1, 1, 0, 0], t: [34, 32, null, 28, 35], wg: [null, 30, 35, 0, 0] } };
  const rows = O.events(g, start);
  assert.equal(rows.filter(r => r.label === 'Snow possible').length, 2);
  assert.equal(rows.find(r => r.label === 'Freezing rain possible').end, start + 3 * H);
  assert.equal(rows.filter(r => r.param === 't2').length, 2);
  assert.equal(rows.find(r => r.param === 'gust').end, start + 3 * H);
});
test('normalizer preserves unknown amounts and precipitation-type coverage', () => {
  const { normalize } = require('../wx-normalize.js');
  const layer = value => ({ values: [{ validTime: new Date(start).toISOString() + '/PT24H', value }] });
  const d = normalize({ now: start, lat: 45, lon: -93, points: { properties: {} }, forecast: { properties: { periods: [] } },
    grid: { properties: { temperature: layer(-2), snowfallAmount: layer(null), quantitativePrecipitation: layer(0) } } });
  assert.equal(d.grid.snow[0][2], null);
  assert.equal(d.grid.qpf[0][2], 0);
  assert.ok(d.grid.s.wxKnown.every(v => v === false));
});
test('rain easing requires three known low-chance hours and does not hide storms', () => {
  const s = { rain: [1, 1, 0, 0, 0, 0], pop: [80, 70, 10, 10, 10, 10], wxKnown: [true, true, true, true, true, true] };
  const rows = O.events({ start, n: 6, s }, start);
  assert.equal(rows.find(r => r.label === 'Rain possible').end, start + 2 * H);
  assert.equal(rows.find(r => r.label === 'Rain chances ease').start, start + 2 * H);
  assert.equal(O.events({ start, n: 6, s: { ...s, wxKnown: [true, true, true, false, true, true] } }, start).some(r => r.label === 'Rain chances ease'), false);
  assert.equal(O.events({ start, n: 6, s: { ...s, thp: [null, null, 40, 40, 40, 0] } }, start).some(r => r.label === 'Rain chances ease'), false);
});
test('thunderstorms use thunder probability separately from precipitation chance', () => {
  const rows = O.events({ start, n: 4, s: { thp: [0, 30, 60, null], pop: [80, 80, 80, 80] } }, start);
  const storm = rows.find(r => r.label === 'Thunderstorms possible');
  assert.equal(storm.chance, 60);
  assert.equal(storm.start, start + H);
  assert.equal(storm.end, start + 3 * H);
  assert.equal(rows.some(r => r.label === 'Rain possible'), false);
});
test('wettest block compares published block averages without splitting or prorating', () => {
  const g = { start, n: 12, s: {}, qpf: [[start, 6, 1.2], [start + 6 * H, 1, 0.3], [start + 7 * H, 1, null]] };
  const row = O.events(g, start).find(r => r.label === 'Wettest NWS block');
  assert.equal(row.start, start + 6 * H);
  assert.equal(row.end, start + 7 * H);
  assert.match(row.detail, /0.30 in/);
  assert.equal(O.events({ ...g, qpf: [[start - H, 6, 10]] }, start).some(r => r.label === 'Wettest NWS block'), false);
});

test('archive waits for data normalized with missing-value coverage instead of saving older cached zeros', () => {
  const d = { via: 'live', loc: { lat: 45, lon: -93 }, updated: { grid: Date.now() - H }, grid: { snow: [[Date.now(), 24, 0]] } };
  const count = A.read().forecasts.length;
  A.capture(d); assert.equal(A.read().forecasts.length, count);
  A.capture({ ...d, grid: { ...d.grid, s: { wxKnown: [true] } } });
  assert.equal(A.read().forecasts.length, count + 1);
});
