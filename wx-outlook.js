(function (root) {
  "use strict";
  var H = 3600000, context = null, options = {}, oddsKey = "", oddsAt = 0, oddsGen = 0, odds = null;
  var activeTool = "timing", toolsOpener = null;
  var timingRows = [], compareRows = [], compareGen = 0, compareLocation = "", reportState = { key: "", state: "loading" };
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(t, o) { return Number.isFinite(t) ? options.fmt ? options.fmt(t, o) : new Date(t).toLocaleString("en-US", o) : "time unavailable"; }
  function period(a, b) { return fmt(a, { weekday: "short", hour: "numeric", timeZoneName: "short" }) + " – " + fmt(b, { weekday: "short", hour: "numeric", timeZoneName: "short" }); }
  function stamp(t) { return fmt(t, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }); }
  function renderOdds() {
    var host = document.getElementById("winter-odds"); if (!host || !odds) return;
    if (!odds.covered) { host.innerHTML = "<p>WPC winter probability maps cover the contiguous U.S. Local NWS forecasts remain available for this location.</p>"; return; }
    host.innerHTML = '<p>Official WPC regional probability bands near ' + esc(context.loc.label) + '. These are chances of exceeding a threshold, not predicted inches or exact point probabilities.</p>' + [1, 2].map(function (day) {
      var rows = odds.rows.filter(function (r) { return r.day === day; }), first = rows.filter(function (r) { return r.state === "available" && r.end > Date.now(); })[0];
      return '<div class="odds-day"><b>Day ' + day + (first ? " · " + esc(period(first.start, first.end)) : " · period unavailable") + '</b><div class="odds-grid">' + rows.map(function (r) {
        var label = r.k === "snow" ? r.threshold + '″+ snow' : '0.25″+ ice', available = r.state === "available" && r.end > Date.now();
        var extra = available && first ? (r.start !== first.start || r.end !== first.end ? period(r.start, r.end) + " · " : "") + "Issued " + stamp(r.issue) : "";
        return '<button type="button" data-weather-odds="' + odds.rows.indexOf(r) + '"' + (available ? "" : " disabled") + ' title="' + esc(available ? "NWS issued " + stamp(r.issue) + " · " + period(r.start, r.end) : "No current probability data") + '"><span>' + label + '</span><b>' + esc(available ? r.chance : r.state === "expired" || r.end && r.end <= Date.now() ? "Expired" : "Unavailable") + '</b>' + (extra ? '<span>' + esc(extra) + '</span>' : "") + '</button>';
      }).join("") + "</div></div>";
    }).join("") + '<p>Tap a threshold to open its map. <a href="https://www.wpc.ncep.noaa.gov/wwd/winter_wx.shtml" target="_blank" rel="noopener">NWS winter outlook</a></p>';
  }
  function loadOdds() {
    var l = context.loc, key = l.lat.toFixed(4) + "," + l.lon.toFixed(4), host = document.getElementById("winter-odds");
    if (!host || !root.WXOfficial || !root.WXOfficial.probabilities) return;
    if (oddsKey === key && odds && Date.now() - oddsAt < 30 * 60000) { renderOdds(); return; }
    if (oddsKey === key && !odds && oddsAt) return;
    oddsKey = key; oddsAt = Date.now(); odds = null; var g = ++oddsGen;
    host.innerHTML = "<p>Checking official winter probabilities…</p>";
    root.WXOfficial.probabilities(l).then(function (r) { if (g !== oddsGen) return; odds = r; renderOdds(); }, function () { if (g !== oddsGen) return; oddsAt = 0; host.innerHTML = "<p>Winter probabilities are unavailable right now.</p>"; });
  }
  function events(g, now) {
    var out = [], s = g.s || {}, first = Math.max(0, Math.floor((now - g.start) / H)), last = Math.min(g.n, Math.ceil((now + 48 * H - g.start) / H));
    function add(label, param, predicate, probability, chanceLabel) {
      var current = null;
      for (var i = first; i < last; i++) {
        if (!predicate(i)) { current = null; continue; }
        if (!current) { current = { label: label, param: param, start: g.start + i * H, end: g.start + (i + 1) * H, chance: null, chanceLabel: chanceLabel || "Precipitation chance" }; out.push(current); }
        else current.end = g.start + (i + 1) * H;
        var p = probability && probability[i]; if (Number.isFinite(p) && p > 0) current.chance = Math.max(current.chance || 0, p);
      }
    }
    add("Rain possible", "ptype", function (i) { return !!(s.rain || [])[i]; }, s.pop);
    add("Thunderstorms possible", "ptype", function (i) { return !!(s.thunder || [])[i] || Number.isFinite((s.thp || [])[i]) && s.thp[i] >= 20; }, s.thp, "Thunderstorm chance");
    [["snow", "Snow possible"], ["sleet", "Sleet possible"], ["fzra", "Freezing rain possible"]].forEach(function (k) {
      add(k[1], "ptype", function (i) { return !!(s[k[0]] || [])[i]; }, s.pop);
    });
    add("Gusts ≥25 mph", "gust", function (i) { return Number.isFinite((s.wg || [])[i]) && s.wg[i] >= 25; });
    var wet = (g.qpf || []).filter(function (b) { return b[0] >= now && b[0] + b[1] * H <= now + 48 * H && b[1] > 0 && Number.isFinite(b[2]) && b[2] > 0; }).sort(function (a, b) { return b[2] / b[1] - a[2] / a[1] || a[0] - b[0]; })[0];
    if (wet) out.push({ label: "Wettest NWS block", param: "qpf", start: wet[0], end: wet[0] + wet[1] * H, detail: wet[2].toFixed(2) + " in liquid equivalent over " + wet[1] + " hr" });
    for (var i = first; i < last; i++) {
      var before = (s.t || [])[i - 1], after = (s.t || [])[i];
      if (Number.isFinite(before) && Number.isFinite(after) && (before > 32 && after <= 32 || before <= 32 && after > 32)) out.push({ label: after <= 32 ? "Air temperature falls to ≤32°F" : "Air temperature rises above 32°F", param: "t2", start: g.start + i * H, end: g.start + (i + 1) * H });
      if ((s.rain || [])[i - 1] && i + 2 < last && [i, i + 1, i + 2].every(function (j) {
        return (s.wxKnown || [])[j] && !(s.rain || [])[j] && !(s.thunder || [])[j] && !(s.snow || [])[j] && !(s.sleet || [])[j] && !(s.fzra || [])[j] && Number.isFinite((s.pop || [])[j]) && s.pop[j] < 20 && (!Number.isFinite((s.thp || [])[j]) || s.thp[j] < 20);
      })) out.push({ label: "Rain chances ease", param: "ptype", start: g.start + i * H, end: g.start + (i + 3) * H, detail: "Below 20% for at least 3 forecast hours" });
    }
    return out.sort(function (a, b) { return a.start - b.start; });
  }
  function timingButton(r, i) {
    return '<button type="button" data-weather-time="' + i + '"><b>' + esc(r.label) + '</b>' +
      '<span class="timing-period">' + esc(period(r.start, r.end)) + '</span>' +
      (r.chance != null ? '<span class="timing-chance">' + (r.chanceLabel === "Thunderstorm chance" ? "Thunder" : "Precip") + ' up to ' + r.chance + '%</span>' : "") +
      (r.detail ? '<span class="timing-detail">' + esc(r.detail) + '</span>' : "") + '</button>';
  }
  function renderAlerts() {
    var host = document.getElementById("weather-alerts"); if (!host || !context) return;
    var now = context.via === "test" ? context.fetchedAt : Date.now();
    var alerts = (context.alerts || []).filter(function (a) { var end = a.ends || a.expires; return !end || end > now; });
    host.innerHTML = alerts.map(function (a) { return '<p class="outlook-hazard"><b>' + esc(a.event) + '</b>' + (a.onset && (a.ends || a.expires) ? '<br>' + esc(period(a.onset, a.ends || a.expires)) : "") + '</p>'; }).join("") +
      (alerts.length ? '<button type="button" class="text-action" id="weather-alert-details">Read NWS alert details ›</button>' : "") +
      (context.alerts == null ? '<p>Current NWS alerts could not be checked.</p>' : "");
  }
  function renderTiming() {
    var host = document.getElementById("weather-alerts"), full = document.getElementById("weather-timing-full"), g = context.grid;
    if (!host) return;
    if (!g || !g.s) { timingRows = []; if (full) full.innerHTML = '<p>Hourly forecast timing is unavailable.</p>'; renderAlerts(); return; }
    var now = context.via === "test" ? context.fetchedAt : Date.now(), first = Math.max(0, Math.floor((now - g.start) / H)), last = Math.min(g.n, Math.ceil((now + 48 * H - g.start) / H));
    timingRows = events(g, now);
    var unknown = !g.s.wxKnown || !g.s.wxKnown.slice(first, last).length || g.s.wxKnown.slice(first, last).some(function (v) { return !v; });
    var issued = '<p class="outlook-issued">' + (context.via === "test" ? "Sample NWS timeline · live model maps" : "NWS timing") + ' · issued ' + esc(stamp(g.updated || (context.updated || {}).grid)) + '</p>';
    var warning = unknown || g.start + g.n * H < now + 48 * H ? '<p>Some forecast hours are unavailable.</p>' : "";
    var empty = !timingRows.length ? '<p>No rain, storms, winter precipitation or gusts ≥25 mph flagged in the available hours.</p>' : "";
    renderAlerts();
    if (full) full.innerHTML = issued + '<div class="weather-timeline">' + timingRows.map(timingButton).join("") + '</div>' + empty + warning + '<p>Precip = overall precipitation chance; Thunder = thunderstorm chance. Percentages show the highest chance within each period.</p>';
    var notes = document.getElementById("weather-source-notes");
    if (notes) notes.innerHTML = '<p>NWS hourly timing and model output are separate forecasts. Timing is approximate; the wettest block is a published average, not an instantaneous rainfall peak. Storm potential does not confirm hail or tornadoes, and air temperature alone does not establish surface icing. Missing hours do not establish dry or safe conditions.</p>' +
      (context.hwo && (!context.hwo.expires || context.hwo.expires > now) && (context.hwo.day1 || context.hwo.days27) ?
        '<h3>NWS hazardous weather outlook</h3><p>Issued ' + esc(stamp(context.hwo.issued)) + '</p>' + [context.hwo.day1, context.hwo.days27].filter(Boolean).map(function (x) { return '<p>' + esc(x) + '</p>'; }).join("") : "");
  }
  function selectTool(name) {
    var dialog = document.getElementById("forecast-tools"), tab = document.getElementById("tool-tab-" + name); if (!dialog || !tab) return;
    activeTool = name;
    dialog.querySelectorAll("[data-tool-tab]").forEach(function (b) {
      var selected = b.dataset.toolTab === name; b.setAttribute("aria-selected", String(selected)); b.tabIndex = selected ? 0 : -1;
      document.getElementById(b.getAttribute("aria-controls")).hidden = !selected;
    });
    if (options.onTool) options.onTool(name);
    if (name === "compare") updateCompare();
    var panel = document.getElementById("tool-" + name); if (panel) panel.scrollTop = 0;
  }
  function openTools(name, opener) {
    var dialog = document.getElementById("forecast-tools"); toolsOpener = opener;
    selectTool(name);
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0; document.getElementById("tool-tab-" + name).focus({ preventScroll: true });
  }
  function closeTools() {
    var dialog = document.getElementById("forecast-tools"); if (dialog && dialog.open) dialog.close();
  }
  var KINDS = {
    qpf: { param: "qpf", models: ["hrrr", "nam", "nam12", "rap", "gfs", "nbm"], label: "Precipitation · liquid equivalent" },
    snow10: { param: "sn10", models: ["hrrr", "nam", "nam12", "rap", "gfs"], label: "Snowfall · 10:1" },
    native: { param: "snv", models: ["hrrr", "rap"], label: "Snowfall · native" },
    nbm: { param: "nsn", models: ["nbm"], label: "Snowfall · NBM" },
    frz: { param: "frz", models: ["hrrr", "nam", "nam12", "rap", "gfs"], label: "Freezing-rain liquid" },
    accretion: { param: "frz", models: ["nbm"], label: "Ice accretion · NBM" }
  };
  function compareControls() {
    var host = document.getElementById("weather-compare"); if (!host || host.querySelector("#compare-kind")) return;
    host.innerHTML = '<div class="compare-controls"><label>Product<select id="compare-kind">' + Object.keys(KINDS).map(function (k) { return '<option value="' + k + '">' + KINDS[k].label + '</option>'; }).join("") +
      '</select></label><label>Compare<select id="compare-mode"><option value="models">Across models</option><option value="trends">Run trends</option></select></label><label>Duration<select id="compare-hours"><option value="6">6 hours</option><option value="24" selected>24 hours</option><option value="48">48 hours</option></select></label><label>Start<select id="compare-start"><option value="0">Next shared time</option><option value="6">6 hours later</option><option value="12">12 hours later</option><option value="24">24 hours later</option></select></label><label id="compare-trend-label" hidden>Model<select id="compare-model"></select></label></div><button type="button" class="chip" id="compare-refresh">Update comparison</button><div id="compare-results" role="status"></div>';
  }
  function updateCompare() {
    if (!context || !root.WXModels) return; compareControls();
    var $ = function (id) { return document.getElementById(id); }, kind = KINDS[$("compare-kind").value], trend = $("compare-mode").value === "trends";
    var modelSel = $("compare-model"), old = modelSel.value;
    modelSel.innerHTML = kind.models.map(function (m) { return '<option value="' + m + '"' + (m === old ? " selected" : "") + '>' + root.WXModels.MODELS[m].name + '</option>'; }).join("");
    $("compare-trend-label").hidden = !trend;
    var start = Math.ceil(Date.now() / (6 * H)) * 6 * H + +$("compare-start").value * H, end = start + +$("compare-hours").value * H;
    var g = ++compareGen, locationKey = context.loc.lat + "," + context.loc.lon;
    $("compare-results").innerHTML = '<p>' + esc(period(start, end)) + ' · checking published runs…</p>';
    root.WXModels.compareWindow({ start: start, end: end, param: kind.param, models: trend ? [modelSel.value] : kind.models, trend: trend }).then(function (rows) {
      if (g !== compareGen || locationKey !== context.loc.lat + "," + context.loc.lon) return;
      compareRows = rows; if (root.WXArchive) { root.WXArchive.captureModels(rows, context.loc, kind.label); renderHistory(); }
      $("compare-results").innerHTML = '<p><b>' + esc(period(start, end)) + '</b><br>' + esc(context.loc.label) + ' · ' + esc(kind.label) + '. Every available row uses this exact period, inches and the selected method category. Models still use different physics.</p>' +
        rows.map(function (r, i) {
          var model = root.WXModels.MODELS[r.model], name = model ? model.name : r.model, available = r.state === "available";
          var run = r.run ? stamp(r.run) + " run · " + Math.max(0, Math.floor((Date.now() - r.run) / H)) + " hr old" : "";
          return '<div class="compare-row"><div><b>' + esc(name) + '</b><small>' + esc(run || r.reason || "No exact-window data") + '</small></div>' +
            (available ? '<button type="button" data-compare-map="' + i + '">' + r.value.toFixed(2) + ' in · Map</button>' : '<span>Unavailable</span>') + '</div>';
        }).join("") + '<p>Modeled grid estimates near the forecast location. Map buttons preserve the view and lock the period. Differences are model spread, not a calibrated probability. An unavailable run is not a zero forecast.</p>';
    }, function () { if (g === compareGen) $("compare-results").innerHTML = "<p>Comparison data couldn't load. Open Models first, then try again.</p>"; });
  }
  function renderHistory() {
    var host = document.getElementById("weather-verification"), A = root.WXArchive; if (!host || !A || !context) return;
    var a = A.read(), forecasts = a.forecasts.filter(function (f) { return A.distance(f, context.loc) <= 1; });
    var reports = a.reports.filter(function (r) { return A.distance(r, context.loc) <= 40; }).sort(function (a, b) { return b.end - a.end; });
    var checked = reportState.key === context.loc.lat.toFixed(2) + "," + context.loc.lon.toFixed(2) ? reportState.state : "loading";
    host.innerHTML = '<p>' + forecasts.length + ' issued forecast' + (forecasts.length === 1 ? "" : "s") + ' saved near ' + esc(context.loc.label) + '. ' +
      (A.persistent() ? 'Saved on this device for up to 14 days, starting with your visits today.' : 'Device storage is unavailable; these records last for this session.') + '</p>' +
      '<p>Snowfall and rainfall reports from NWS Local Storm Reports, via Iowa Environmental Mesonet. New reports cover the past 72 hours; saved reports remain for 14 days. Ice-thickness reports are not scored against modeled ice accretion.</p>' +
      (checked !== "available" ? '<p>' + (checked === "loading" ? 'Checking recent reports…' : 'Recent reports could not be checked. Saved records remain below.') + '</p>' : "") +
      reports.slice(0, 12).map(function (r) {
        var matches = forecasts.map(function (f) { return { f: f, value: A.match(f, r) }; }).filter(function (x) { return x.value !== null; });
        return '<div class="history-report"><b>' + r.value.toFixed(2) + ' in ' + r.kind + ' · ' + esc(r.city) + '</b><small>' + A.distance(r, context.loc).toFixed(1) + ' mi away · ' +
          esc(r.start ? period(r.start, r.end) : stamp(r.end) + ' · measurement duration unspecified') + (r.estimated ? ' · estimated' : !r.measured ? ' · measurement status unspecified' : '') + '</small>' +
          (matches.length ? matches.slice(-8).map(function (m) { return '<p>' + esc(m.f.label) + ' · issued ' + esc(stamp(m.f.issued)) + '<br>Forecast ' + m.value.toFixed(2) + ' in · observed ' + r.value.toFixed(2) + ' in · difference ' + (m.value - r.value >= 0 ? '+' : '') + (m.value - r.value).toFixed(2) + ' in</p>'; }).join("") : '<p>No saved forecast qualifies for this report’s period, measurement and location.</p>') + '</div>';
      }).join("") + (!reports.length && checked === "available" ? '<p>No compatible snowfall or rainfall reports are available nearby. No report does not mean zero accumulation.</p>' : "") +
      '<p>A comparison requires a measured report within 1 mile, an explicit accumulation period, and a forecast issued and saved before that period began. NWS totals must cover full published blocks; partial blocks are not estimated. Rainfall is compared with total precipitation only when frozen precipitation is ruled out, or the report explicitly measures liquid equivalent. One report does not establish overall accuracy.</p><button type="button" class="chip" id="weather-export">Export saved records</button>';
  }
  function show(doc, o) {
    context = doc; options = o || {}; loadOdds(); renderTiming(); renderHistory();
    var key = doc.loc.lat + "," + doc.loc.lon;
    if (compareLocation !== key) {
      compareLocation = key; compareGen++; compareRows = []; var host = document.getElementById("weather-compare"); if (host) host.innerHTML = "";
      if (document.getElementById("forecast-tools").open && activeTool === "compare") setTimeout(function () { if (compareLocation === key) updateCompare(); }, 0);
    }
  }
  function setReports(features, state, l) {
    reportState = { key: l.lat.toFixed(2) + "," + l.lon.toFixed(2), state: state };
    if (state === "available" && root.WXArchive) root.WXArchive.reports(features); renderHistory();
  }
  if (typeof document !== "undefined") {
    document.getElementById("forecast-tools").addEventListener("close", function () { if (toolsOpener && toolsOpener.isConnected) toolsOpener.focus({ preventScroll: true }); });
    document.querySelector(".forecast-tools-tabs").addEventListener("keydown", function (e) {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); var tabs = Array.from(this.querySelectorAll("[data-tool-tab]")), i = tabs.indexOf(document.activeElement);
      var next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectTool(tabs[next].dataset.toolTab); tabs[next].focus({ preventScroll: true });
    });
    document.addEventListener("change", function (e) { if (/^compare-/.test(e.target.id)) updateCompare(); });
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-weather-odds],[data-weather-time],[data-compare-map],#compare-refresh,#model-window-clear,#weather-export,#weather-alert-details,[data-forecast-tool],[data-tool-tab],#forecast-tools-close"); if (!b) return;
      if (b.dataset.forecastTool) { openTools(b.dataset.forecastTool, b); return; }
      if (b.dataset.toolTab) { selectTool(b.dataset.toolTab); return; }
      if (b.id === "forecast-tools-close") { closeTools(); return; }
      if (b.dataset.weatherOdds != null && odds && options.onOdds) { closeTools(); options.onOdds(odds.rows[+b.dataset.weatherOdds]); document.getElementById("offq").scrollIntoView({ block: "start", behavior: "auto" }); }
      else if (b.dataset.weatherTime != null && options.onTime) { closeTools(); options.onTime(timingRows[+b.dataset.weatherTime]); }
      else if (b.dataset.compareMap != null && compareRows[+b.dataset.compareMap]) {
        if (root.WXModels.useWindow(compareRows[+b.dataset.compareMap])) { closeTools(); document.getElementById("mmap").scrollIntoView({ block: "start", behavior: "auto" }); }
      } else if (b.id === "compare-refresh") updateCompare();
      else if (b.id === "model-window-clear") root.WXModels.clearWindow();
      else if (b.id === "weather-alert-details" && options.onDaily) { closeTools(); options.onDaily(); }
      else if (b.id === "weather-export") {
        var url = URL.createObjectURL(new Blob([root.WXArchive.exportJSON()], { type: "application/json" })), link = document.createElement("a");
        link.href = url; link.download = "weather-issued-forecasts.json"; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }
    });
  }
  var api = { show: show, events: events, capture: function (d) { if (root.WXArchive) root.WXArchive.capture(d); }, setReports: setReports };
  root.WXOutlook = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
