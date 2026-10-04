/* Issued forecasts saved on this device; comparisons require explicit observed windows. */
(function (root) {
  "use strict";
  var H = 3600000, KEY = "wx-issued-v1", memory = null, storageOK = true;
  function read() {
    if (memory) return memory;
    try { var v = JSON.parse(root.localStorage.getItem(KEY)); memory = v && v.v === 1 && Array.isArray(v.forecasts) && Array.isArray(v.reports) ? v : null; } catch (e) { storageOK = false; }
    return memory || (memory = { v: 1, forecasts: [], reports: [] });
  }
  function write() {
    var a = read(), cut = Date.now() - 14 * 24 * H;
    a.forecasts = a.forecasts.filter(function (x) { return x.recordedAt >= cut; }).slice(-240);
    a.reports = a.reports.filter(function (x) { return x.end >= cut; }).slice(-300);
    try { root.localStorage.setItem(KEY, JSON.stringify(a)); storageOK = true; } catch (e) { storageOK = false; }
  }
  function allowed() { return !root.location || !/[?&](?:nostore=1|test=)/.test(root.location.search); }
  function capture(d) {
    if (!allowed() || d.via !== "live" || !d.grid || !d.grid.s || !Array.isArray(d.grid.s.wxKnown) || !d.updated || !Number.isFinite(d.updated.grid)) return;
    var a = read(), key = ["nws", d.loc.lat, d.loc.lon, d.updated.grid].join(":");
    if (a.forecasts.some(function (x) { return x.id === key; })) return;
    a.forecasts.push({ id: key, source: "nws", label: "NWS point forecast", lat: d.loc.lat, lon: d.loc.lon,
      issued: d.updated.grid, recordedAt: Date.now(), grid: { snow: d.grid.snow, qpf: d.grid.qpf, ice: d.grid.ice } }); write();
  }
  function captureModels(rows, l, label) {
    if (!allowed()) return;
    var a = read();
    rows.filter(function (r) { return r.state === "available"; }).forEach(function (r) {
      var key = [r.model, r.param, r.run, r.start, r.end, l.lat, l.lon].join(":");
      if (a.forecasts.some(function (x) { return x.id === key; })) return;
      a.forecasts.push({ id: key, source: r.model, label: r.model.toUpperCase() + " · " + label, lat: l.lat, lon: l.lon,
        issued: r.run, recordedAt: Date.now(), kind: /^(sn10|snv|nsn)$/.test(r.param) ? "snow" : r.param === "qpf" ? "rain" : "ice",
        method: r.param, start: r.start, end: r.end, value: r.value });
    }); write();
  }
  function report(p, coords) {
    var ty = String(p.typetext || p.type_text || p.type || "").toUpperCase();
    var kind = /^(SNOW|SNOWFALL|S)$/.test(ty) ? "snow" : /^(RAIN|HEAVY RAIN|R)$/.test(ty) ? "rain" : null;
    if (!kind || !/^inch(?:es)?$/i.test(p.unit || "")) return null;
    var remark = String(p.remark || p.remarks || ""), durations = [], duration;
    [/(?:past|last)\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi, /\b(\d+(?:\.\d+)?)\s*[- ]\s*(?:hours?|hrs?)\s+(?:snowfall|rainfall|total|accumulation)/gi].forEach(function (re) {
      while ((duration = re.exec(remark))) durations.push(+duration[1]);
    });
    var hours = durations.length && durations.every(function (h) { return h === durations[0]; }) ? durations[0] : null;
    var end = Date.parse(p.valid || p.utc_valid || ""), value = Number(p.magnitude != null ? p.magnitude : p.magf != null ? p.magf : p.mag);
    var la = p.lat != null ? p.lat : coords && coords[1], lo = p.lon != null ? p.lon : coords && coords[0];
    if (la == null || lo == null || p.magnitude == null && p.magf == null && p.mag == null) return null;
    var lat = +la, lon = +lo;
    if (!Number.isFinite(end) || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(value) || value < 0) return null;
    var start = hours > 0 && hours <= 72 ? end - hours * H : null;
    return { id: [p.product_id, kind, lat, lon, end, value, remark].join(":"), kind: kind, start: start, end: end,
      value: value, lat: lat, lon: lon, city: p.city || "Reported location", estimated: p.qualifier === "E", measured: p.qualifier === "M",
      liquidEquivalent: /liquid[- ]equivalent|total precipitation|precipitation total/i.test(remark), remark: remark };
  }
  function reports(features) {
    if (!allowed()) return;
    var a = read();
    features.forEach(function (f) { var r = report(f.properties || {}, f.geometry && f.geometry.coordinates); if (r && !a.reports.some(function (x) { return x.id === r.id; })) a.reports.push(r); }); write();
  }
  function distance(a, b) {
    var rad = Math.PI / 180, x = Math.sin((a.lat - b.lat) * rad / 2), y = Math.sin((a.lon - b.lon) * rad / 2);
    return 7917.6 * Math.asin(Math.sqrt(Math.min(1, x * x + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * y * y)));
  }
  // A block's internal distribution is unknown: sum complete, contiguous blocks only.
  function total(blocks, start, end) {
    var selected = (blocks || []).filter(function (b) { return b[0] < end && b[0] + b[1] * H > start; }).sort(function (a, b) { return a[0] - b[0]; });
    var cursor = start, value = 0;
    for (var i = 0; i < selected.length; i++) {
      var b = selected[i], until = b[0] + b[1] * H;
      if (b[0] !== cursor || until > end || !(until > cursor) || !Number.isFinite(b[2]) || b[2] < 0) return null;
      value += b[2]; cursor = until;
    }
    return cursor === end && end > start ? value : null;
  }
  function match(f, r) {
    if (!r.start || !r.measured || r.estimated || distance(f, r) > 1 || !(f.issued <= r.start) || !(f.recordedAt <= r.start)) return null;
    if (r.kind === "rain" && !r.liquidEquivalent && (f.source !== "nws" || total(f.grid.snow, r.start, r.end) !== 0 || total(f.grid.ice, r.start, r.end) !== 0)) return null;
    if (f.source === "nws") return total(f.grid[r.kind === "snow" ? "snow" : r.kind === "rain" ? "qpf" : "unsupported"], r.start, r.end);
    return f.kind === r.kind && f.start === r.start && f.end === r.end && Number.isFinite(f.value) ? f.value : null;
  }
  var api = { capture: capture, captureModels: captureModels, reports: reports, read: read, distance: distance, match: match, report: report, total: total,
    persistent: function () { return storageOK; }, exportJSON: function () { return JSON.stringify(read(), null, 2); } };
  root.WXArchive = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
