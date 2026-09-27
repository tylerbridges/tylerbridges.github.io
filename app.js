(function () {
  "use strict";
  var H = 3600000, PX = 16, GL = 38; // GL: left gutter so the first hours (and the now line) sit clear of the axis labels
  var tab = "now", doc = null, db = null, lastCheck = 0, busy = false, selIdx = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var TZ = "America/Chicago";
  // Intl.DateTimeFormat objects are slow to build (this was ~70% of drawing the Hourly graphs), so reuse one per zone + options
  var FMTS = {};
  function fmt(ms, o) {
    var k = TZ + JSON.stringify(o || {}), f = FMTS[k];
    try { if (!f) f = FMTS[k] = new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: TZ }, o)); return f.format(ms); } catch (e) { return new Date(ms).toLocaleString(); }
  }
  var tm = function (ms) { return fmt(ms, { hour: "numeric", minute: "2-digit" }); };
  var dtm = function (ms) { return fmt(ms, { weekday: "short", hour: "numeric", minute: "2-digit" }); };
  var hr = function (ms) { return fmt(ms, { hour: "numeric" }).replace(" AM", "a").replace(" PM", "p"); };
  var hourNum = function (ms) { return +fmt(ms, { hour: "numeric", hourCycle: "h23" }); };
  var C = function (f) { return f == null ? "–" : Math.round((f - 32) * 5 / 9); };
  var ago = function (ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + " min ago";
    var h = Math.floor(m / 60); return h + " hr" + (m % 60 ? " " + (m % 60) + " min" : "") + " ago";
  };
  var COMPASS = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");
  var cmp = function (d) { return d == null ? "" : COMPASS[Math.round(d / 22.5) % 16]; };
  var cssv = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };

  // ---------- icons ----------
  var FOG = '<svg class="fogi" viewBox="0 0 32 32" width="1em" height="1em" aria-label="Fog"><path d="M9 17.5a5.5 5.5 0 0 1 .6-11 7 7 0 0 1 13.2 2.1A4.5 4.5 0 0 1 23 17.5Z" fill="#C9D3DD" stroke="#8C99A6" stroke-width="1.2"/>' +
    '<g stroke="var(--fogl)" stroke-width="2.4" stroke-linecap="round"><path d="M5 21.5h17"/><path d="M9 25.5h18"/><path d="M5 29.5h14"/></g></svg>';
  function emo(code, day) {
    var c = code || "";
    if (/tornado/.test(c)) return "🌪️";
    if (/hurricane|tropical/.test(c)) return "🌀";
    if (/tsra/.test(c)) return "⛈️";
    if (/blizzard|snow$|^snow|snow_showers/.test(c) && !/fzra|sleet|ra_sn|rain_snow/.test(c)) return "🌨️";
    if (/fzra|sleet|ra_sn|rain_snow|snow_fzra|snow_sleet|rain_sleet|rain_fzra/.test(c)) return "🧊";
    if (/rain|ra$|shra|minus_ra/.test(c)) return "🌧️";
    // fog/mist: custom icon (the 🌫️ emoji is a flat grey blob that disappears in dark mode)
    if (/fog|haze|smoke|dust/.test(c)) return FOG;
    if (/wind/.test(c)) return "💨";
    if (/hot/.test(c)) return "🌡️";
    if (/cold/.test(c)) return "🥶";
    if (/ovc/.test(c)) return "☁️";
    if (/bkn/.test(c)) return day ? "🌥️" : "☁️";
    if (/sct/.test(c)) return day ? "⛅" : "☁️";
    if (/few|skc/.test(c)) return day ? "☀️" : "🌙";
    return day ? "🌤️" : "🌙";
  }
  function iconHtml(icon, day) {
    if (!icon || !icon.length) return emo("", day);
    var a = emo(icon[0].c, day), b = icon[1] ? emo(icon[1].c, day) : a;
    return a === b ? a : '<span style="font-size:.7em">' + a + "</span>→<span style=\"font-size:.7em\">" + b + "</span>";
  }
  function isDay(ms) { var h = hourNum(ms); return h >= 7 && h < 19; }

  // ---------- freshness ----------
  function renderFresh() {
    if (!doc) { $("ftxt").textContent = "No data yet"; $("fdot").className = "dot crit"; return; }
    var age = Date.now() - doc.fetchedAt;
    $("fdot").className = "dot" + (age > 3 * H ? " crit" : age > 75 * 60000 ? " warn" : "");
    $("ftxt").textContent = "Updated " + ago(doc.fetchedAt);
    $("ftxt").title = "NWS data pulled " + dtm(doc.fetchedAt) + "";
  }

  // ---------- warnings / outlooks: subcards inside the Now card ----------
  function firstSent(t, max) {
    t = String(t || "").replace(/\s+/g, " ").replace(/^\* ?/, "").trim();
    var m = /^(.{20,}?[.!?])(\s|$)/.exec(t); t = m ? m[1] : t;
    return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
  }
  // NWS text comes hard-wrapped at ~69 columns: rejoin lines inside each paragraph (words unchanged) so it reflows on a phone
  function reflow(t) { return String(t || "").replace(/\r/g, "").trim().split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, " ").trim(); }).join("\n\n"); }
  function hazHtml() {
    var a = (doc && doc.alerts) || [], h = doc && doc.hwo, out = [];
    var sev = { Extreme: "var(--sev-ext)", Severe: "var(--sev-sev)", Moderate: "var(--sev-mod)", Minor: "var(--sev-min)" };
    a.forEach(function (x) {
      var what = /WHAT\.\.\.([\s\S]*?)(\n\n|\n\*|$)/.exec(x.desc || "");
      var brief = firstSent(what ? what[1] : (x.desc || x.headline || ""), 170);
      var when = x.ends ? "Until " + dtm(x.ends) : x.onset ? "From " + dtm(x.onset) : "";
      out.push('<details class="haz" style="--sev:' + (sev[x.severity] || "var(--sev-mod)") + '"><summary><div class="hz-t">' + esc(x.event) + '<span class="hz-when">' + esc(when) + '</span></div>' +
        '<div class="hz-b">' + esc(brief) + '</div><span class="hz-more"><span class="hz-o">Details ▾</span><span class="hz-c">Hide details ▴</span></span></summary>' +
        // expanded: the alert verbatim (headline, description, NWS's own action heading and instructions, areas)
        '<div class="hz-body">' + (x.headline ? "<b>" + esc(x.headline) + "</b>\n\n" : "") + esc(reflow(x.desc)) + (x.instr ? "\n\n<b>PRECAUTIONARY/PREPAREDNESS ACTIONS...</b>\n\n" + esc(reflow(x.instr)) : "") +
        (x.area ? '\n\n<span class="hz-area">' + esc(x.area) + "</span>" : "") + "</div></details>");
    });
    if (h && h.hazard) {
      var parts = [];
      if (h.day1 && !/^No hazardous/i.test(h.day1)) parts.push(["Today and tonight", h.day1]);
      if (h.days27 && !/^No hazardous/i.test(h.days27)) parts.push(["Next 7 days", h.days27]);
      out.push('<details class="haz hwo" style="--sev:var(--sev-min)"><summary><div class="hz-t">Hazardous Weather Outlook<span class="hz-when">NWS ' + esc(doc.loc.office || "") + " · " + esc(dtm(h.issued)) + '</span></div>' +
        '<div class="hz-b">' + esc(firstSent(parts[0][1], 170)) + '</div><span class="hz-more"><span class="hz-o">Details ▾</span><span class="hz-c">Hide details ▴</span></span></summary>' +
        // expanded: the outlook verbatim (section headers like ".DAY ONE..." in bold); older cached data falls back to its two sections
        '<div class="hz-body">' + (h.text ? reflow(h.text).split("\n\n").map(function (p) { return /^\.[A-Z]/.test(p) ? p.replace(/^(\.[A-Z][^.]*(?:\.\.\.)?)(.*)$/, function (m, hd, rest) { return "<b>" + esc(hd) + "</b>" + esc(rest); }) : esc(p); }).join("\n\n")
          : parts.map(function (p) { return "<b>" + p[0] + "</b>\n" + esc(p[1]); }).join("\n\n")) + "</div></details>");
    }
    return out.length ? '<div class="hazs">' + out.join("") + (a.length ? '<div class="hz-note">NWS alert text as issued. Alerts can change quickly: confirm at weather.gov or NOAA Weather Radio.</div>' : "") + "</div>" : "";
  }

  // today's high: today's daytime forecast period if still ahead, else the highest reading observed today
  function todayHigh(ms) {
    var p = (doc && doc.periods) || [], D = { year: "numeric", month: "numeric", day: "numeric" }, today = fmt(ms || Date.now(), D);
    var dayP = p.filter(function (x) { return x.day && fmt(x.s, D) === today; })[0];
    if (dayP) return dayP.temp;
    var obsT = ((doc && doc.obs) || []).filter(function (o) { return o.t != null && fmt(o.ms, D) === today; }).map(function (o) { return o.t; });
    return obsT.length ? Math.max.apply(null, obsT) : null;
  }
  // high/low pair for a period: a day pairs with the night after it; a night with the day before it
  function hiLo(p, i) {
    var x = p[i];
    if (x.day) return [x.temp, p[i + 1] && !p[i + 1].day ? p[i + 1].temp : null];
    return [p[i - 1] && p[i - 1].day ? p[i - 1].temp : i === 0 ? todayHigh(hourNum(x.s) < 6 ? x.s - 6 * H : x.s) : null, x.temp];
  }

  // compact period card contents (name, icon, high/low, precip chance, amounts); used as the left column of the Daily detail rows
  function ccardInner(p, i, bare) {
    var x = p[i], anyAmt = p.some(function (y) { return textAmounts(y.detail).length; });
    var nm = x.name.replace(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/, function (m) { return WD[m]; }).replace("This Afternoon", "Today").replace("Overnight", "Overnt");
    return (bare ? "" : '<span class="cn">' + esc(nm) + "</span>") + '<span class="ci">' + iconHtml(x.icon, x.day) + "</span>" + (bare ? "" : '<span class="ct num">' + hlHtml(hiLo(p, i), "", "") + "</span>") + // in the Daily rows (bare) empty lines are dropped so the card shrinks to what it has
      (bare && !x.pop && !x.popTrend ? "" : '<span class="cp">' + popTxt(x) + "</span>") +
      (bare ? (amtHtml(x) ? '<span class="ca">' + amtHtml(x) + "</span>" : "") : anyAmt ? '<span class="ca">' + (amtHtml(x) || "&nbsp;") + "</span>" : "");
  }
  // EPA UV stamps look like "Sep/27/2026 06 AM" (local time)
  function uvKey(ms) { return fmt(ms, { month: "short" }) + "/" + fmt(ms, { day: "2-digit" }) + "/" + fmt(ms, { year: "numeric" }) + " " + fmt(ms, { hour: "2-digit", hour12: true }); }
  function uvCat(v) { return v <= 2 ? "Low" : v <= 5 ? "Moderate" : v <= 7 ? "High" : v <= 10 ? "Very high" : "Extreme"; }
  function uvAt(ms) {
    var uv = doc && doc.uv, k = uvKey(ms), hit = uv && (uv.hourly || []).filter(function (h) { return h[0] === k; })[0];
    return hit ? hit[1] : null;
  }
  function popTxt(x) { return x.popTrend ? x.popTrend[0] + "% → " + x.popTrend[1] + "%" : x.pop ? x.pop + "%" : "&nbsp;"; }
  function hlHtml(hl, a, b) {
    return (hl[0] != null ? '<span class="hiT">' + a + hl[0] + "°F</span>" : "") + (hl[1] != null ? '<span class="loT">' + b + hl[1] + "°F</span>" : "");
  }

  // ---------- current ----------
  function renderNow() {
    var c = doc && doc.cur, st = (doc && doc.station) || {};
    renderLs();
    if (!doc) { $("nowcard").innerHTML = '<div class="empty">Loading from weather.gov…</div>'; return; }
    if (!c) { $("nowcard").innerHTML = hazHtml() + '<div class="empty">Observation not available right now.</div>'; return; }
    // today's high: the daytime forecast period if today's is still ahead, else the highest reading observed today; low: tonight's forecast low
    // same high/low as the first day card in the forecast
    var p = doc.periods || [], g0 = groupDays(p)[0], hl0 = g0 ? dayHL(p, g0) : [null, null], hiT = hl0[0], loT = hl0[1];
    // gusts: the station's reported gust; the station only reports one when gusting, so otherwise use the NWS forecast gust for this hour
    var gg = doc.grid, gi = gg ? Math.floor((Date.now() - gg.start) / H) : -1;
    var gust = c.wg || (gg && gi >= 0 && gi < gg.n && gg.s.wg[gi] != null ? gg.s.wg[gi] : null);
    var rows = [];
    if (hiT != null || loT != null) rows.push(["High / Low", '<span class="hiT">' + (hiT != null ? hiT + "°F" : "–") + '</span> / <span class="loT">' + (loT != null ? loT + "°F" : "–") + "</span>", 1]);
    var p0 = p[0]; if (p0) rows.push(["Precip chance", (p0.popTrend ? p0.popTrend[0] + "% → " + p0.popTrend[1] + "%" : (p0.pop || 0) + "%") + " " + p0.name.toLowerCase().replace(/^this /, "")]);
    // EPA's daily UV forecast is for one calendar day: label it with the day when it isn't today (late evening it's already tomorrow's)
    var uv = doc.uv, uvD = uv && uv.date ? new Date(uv.date.replace(/\//g, " ")) : null, todayD = new Date(fmt(Date.now(), { year: "numeric", month: "short", day: "numeric" }));
    var uvOff = uvD ? Math.round((uvD - todayD) / 864e5) : null;
    // UV right now (EPA hourly forecast for this hour; 0 overnight)
    var nowUV = uvAt(Date.now());
    if (nowUV == null && uv && uv.hourly && uv.hourly.length && !isDay(Date.now())) nowUV = 0;
    if (nowUV != null) rows.push(["UV index", nowUV + " · " + uvCat(nowUV) + (uv && uv.alert ? " · UV alert" : "")]);
    rows.push(["Humidity", c.rh != null ? c.rh + "%" : "–"],
      ["Wind / Gusts", (c.ws == null ? "–" : c.ws) + " / " + (gust == null ? "–" : gust) + " mph"],
      ["Visibility", c.vis != null ? (c.vis >= 10 ? "10.00" : c.vis.toFixed(2)) + " mi" : "–"]);
    if (c.wc != null && c.t != null && c.wc < c.t) rows.push(["Wind chill", c.wc + "°F"]);
    if (c.hi != null && c.t != null && c.hi > c.t) rows.push(["Heat index", c.hi + "°F"]);
    var d0 = groupDays(p)[0];
    $("nowtitle").textContent = fmt(d0 ? d0.s : Date.now(), { weekday: "long", month: "short", day: "numeric" });
    $("nowcard").innerHTML =
      // one line, all at the title's size: icon, condition, then temperature
      '<div class="now-line"><span class="now-ico">' + iconHtml(c.icon, isDay(c.ms)) + '</span><span class="now-desc">' + esc(c.desc || "—") + '</span><span class="now-t num">' + (c.t == null ? "–" : c.t) + "°F</span></div>" + hazHtml() +
      '<dl class="kv num">' + rows.map(function (r) { return "<div><dt>" + r[0] + "</dt><dd>" + (r[2] ? r[1] : esc(r[1])) + "</dd></div>"; }).join("") + "</dl>" +
      '<div id="nowday"></div>';
  }

  // ---------- 7-day ----------

  // ---------- amounts NWS spells out in the period text ("New rainfall amounts between a tenth and quarter of an inch possible") ----------
  var WORDNUM = { "a tenth": 0.1, "tenth": 0.1, "a quarter": 0.25, "quarter": 0.25, "a half": 0.5, "half": 0.5, "three quarters": 0.75, "an inch": 1, "one inch": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10 };
  function wnum(s) {
    s = s.trim().toLowerCase().replace(/ of an inch| inch(es)?/g, "").trim();
    if (/^[\d.]+$/.test(s)) return +s;
    return WORDNUM[s] != null ? WORDNUM[s] : null;
  }
  function fmtIn(v) { return v % 1 === 0 ? String(v) : v.toFixed(2); }
  function textAmounts(txt) {
    var out = [], re = /(rainfall|precipitation|snow|ice) (?:amounts?|accumulations?) (?:of |between )?(.*?) (?:possible|expected)/gi, m;
    while ((m = re.exec(txt || ""))) {
      var kind = /rain|precip/i.test(m[1]) ? "rain" : /snow/i.test(m[1]) ? "snow" : "ice", ph = m[2].toLowerCase(), v = null, r;
      if (/little or no|^no /.test(ph)) continue;
      if ((r = /^(.*?) (?:and|to) (.*)$/.exec(ph))) { var a = wnum(r[1]), b = wnum(r[2]); if (a != null && b != null) v = fmtIn(a) + "–" + fmtIn(b); }
      else if ((r = /^(?:less than|under) (.*)$/.exec(ph))) { a = wnum(r[1]); if (a != null) v = "<" + fmtIn(a); }
      else if ((r = /^(?:around|about|near) (.*)$/.exec(ph))) { a = wnum(r[1]); if (a != null) v = "~" + fmtIn(a); }
      else { a = wnum(ph); if (a != null) v = fmtIn(a); }
      if (v) out.push({ k: kind, t: v + "\u2033" });
    }
    return out;
  }
  function amtHtml(x) {
    var a = textAmounts(x.detail); if (!a.length) return "";
    var ico = { rain: "\ud83d\udca7", snow: "\u2744\ufe0f", ice: "\ud83e\uddca" };
    return a.map(function (z) { return '<span class="amt amt-' + z.k + '">' + ico[z.k] + z.t + "</span>"; }).join("");
  }
  // ---------- day/night pairing ----------
  var WD = { Sunday: "Sun", Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat" };
  function dayGroups(p) {
    var g = [], by = {};
    p.forEach(function (x, i) {
      var key = fmt(x.s - 6 * H, { year: "numeric", month: "numeric", day: "numeric" }); // overnight periods belong to the prior day
      var d = by[key];
      if (!d) { d = by[key] = { key: key, ms: x.s - (x.day ? 0 : 6 * H), day: null, night: null }; g.push(d); }
      if (x.day && !d.day) d.day = x; else if (!x.day && !d.night) d.night = x;
    });
    var today = fmt(Date.now(), { year: "numeric", month: "numeric", day: "numeric" });
    g.forEach(function (d, i) {
      var wk = fmt(d.ms, { weekday: "long" });
      d.label = d.key === today ? (d.day ? "Today" : "Tonight") : wk;
      d.short = d.key === today ? d.label : WD[wk] || wk;
      d.date = fmt(d.ms, { month: "numeric", day: "numeric" });
    });
    return g;
  }
  // Shorten general wording only. Any sentence with an amount, accumulation or a percentage is kept word for word.
  var DIRS = [["Northeast", "NE"], ["Northwest", "NW"], ["Southeast", "SE"], ["Southwest", "SW"], ["North", "N"], ["South", "S"], ["East", "E"], ["West", "W"]];
  function trimText(t) {
    return (t || "").split(/(?<=\.)\s+/).map(function (s) {
      if (/%|amount|accumulat|inch|possible/i.test(s)) return s; // verbatim
      var o = s.replace(/, with a (high|low) (near|around)/g, ", $1 $2").replace(/^With a (high|low)/, "$1");
      DIRS.forEach(function (d) { o = o.replace(new RegExp("\\b" + d[0] + " wind", "g"), d[1] + " wind").replace(new RegExp("\\b" + d[0].toLowerCase() + " wind", "g"), d[1] + " wind"); });
      o = o.replace(/,? with gusts as high as (\d+) mph/g, ", gusts to $1 mph").replace(/(\d+) to (\d+) mph/g, "$1–$2 mph")
        .replace(/ becoming /g, " → ").replace(/Chance of precipitation is/g, "Precip chance");
      return o;
    }).join(" ");
  }
  function half(x, cls) {
    if (!x) return "";
    return '<span class="' + cls + (x.day ? " dh" : " nh") + '"><span class="hi-ic">' + iconHtml(x.icon, x.day) + '</span><span class="num ' + (x.day ? "hiT" : "loT") + ' h-t">' + x.temp + '°</span><span class="h-p">' + (x.pop ? x.pop + "%" : "&nbsp;") + "</span>" +
      '<span class="h-a">' + (amtHtml(x) || "") + "</span></span>";
  }
  function renderWeek() {
    var p = (doc && doc.periods) || [];
    $("fcissued").textContent = doc && doc.updated ? "Issued " + dtm(doc.updated.forecast) : "";
    var anyAmt = p.some(function (x) { return textAmounts(x.detail).length; });
    $("strip").innerHTML = p.map(function (x, i) {
      return '<button type="button" class="pcard' + (x.day ? "" : " night") + '" data-i="' + i + '"><span class="pn">' + esc(x.name) + '</span><span class="pi">' + iconHtml(x.icon, x.day) +
        '</span><span class="pp">' + (x.pop ? x.pop + "%" : "") + '</span>' + (anyAmt ? '<span class="pa">' + amtHtml(x) + "</span>" : "") + '<span class="ps">' + esc(x.short) + '</span><span class="pt num">' + hlHtml(hiLo(p, i), "High ", "Low ") + "</span></button>";
    }).join("");
    $("strip2").innerHTML = p.map(function (x, i) { return '<button type="button" class="ccard' + (x.day ? "" : " night") + '" data-i="' + i + '">' + ccardInner(p, i) + "</button>"; }).join("");
    // if any period shows a split (A→B) icon, widen every compact card equally so it fits
    var split = p.some(function (x) { return x.icon && x.icon[1] && emo(x.icon[0].c, x.day) !== emo(x.icon[1].c, x.day); });
    $("strip2").classList.toggle("wide", split);
    activeCard = -1; syncStrip();
    $("fcissued2").textContent = $("fcissued").textContent;
  }
  var DG = [];
  // every card gets the width of the widest one, so day and night always fit side by side
  function equalize() {
    if (!document.querySelector("#strip .halves, #strip2 .halves")) return; // period cards use fixed widths
    // equal day and night halves: every half gets the width of the widest half in the row (split icons, chips),
    // and every card gets the same total width, so dividers and icons line up across the row
    ["strip", "strip2"].forEach(function (id) {
      var s = $(id); if (!s || !s.offsetParent) return;
      var cs = s.children, k, maxH = 0, maxN = 0;
      s.classList.add("measuring");
      for (k = 0; k < cs.length; k++) cs[k].style.width = "";
      s.querySelectorAll(".hf").forEach(function (h) { maxH = Math.max(maxH, h.getBoundingClientRect().width); });
      s.querySelectorAll(".dn").forEach(function (d) { maxN = Math.max(maxN, d.getBoundingClientRect().width); });
      s.classList.remove("measuring");
      if (!cs.length) return;
      var st = getComputedStyle(cs[0]), gap = id === "strip" ? 10 : 7;
      var pad = parseFloat(st.paddingLeft) + parseFloat(st.paddingRight) + parseFloat(st.borderLeftWidth) + parseFloat(st.borderRightWidth);
      var inner = Math.max(2 * Math.ceil(maxH) + 2 * gap + 1, Math.ceil(maxN));
      s.style.setProperty("--halfw", Math.ceil(maxH) + "px"); s.style.setProperty("--hgap", gap + "px");
      for (k = 0; k < cs.length; k++) cs[k].style.width = Math.ceil(inner + pad) + "px";
    });
  }

  // one card per calendar day, with the day and night periods as subheads inside it
  function groupDays(p) {
    var days = [], cur = null;
    p.forEach(function (x, i) {
      // an overnight period (starts after midnight, before 6am) is the tail of the previous evening, so it goes with that day
      var ref = !x.day && hourNum(x.s) < 6 ? x.s - 6 * H : x.s;
      var k = fmt(ref, { year: "numeric", month: "numeric", day: "numeric" });
      if (!cur || cur.k !== k) { cur = { k: k, s: ref, rows: [] }; days.push(cur); }
      cur.rows.push(i);
    });
    return days;
  }
  // a day's high and the low of the night that follows it (as weather.gov pairs them)
  function dayHL(p, d) {
    var hl = hiLo(p, d.rows[0]), dy = d.rows.filter(function (i) { return p[i].day; })[0], nt = d.rows.filter(function (i) { return !p[i].day; }).pop();
    return [dy != null ? p[dy].temp : hl[0], nt != null && (dy == null || nt > dy) ? p[nt].temp : dy != null && p[dy + 1] && !p[dy + 1].day ? p[dy + 1].temp : hl[1]];
  }
  function renderDetail() {
    var p = (doc && doc.periods) || [], notes = {}, days = groupDays(p); // forecast-discussion notes removed at Tyler's request
    function dayCard(d, k, copy) {
      var hl = dayHL(p, d);
      // copy = the Now tab's version: no header (the date and high/low are already at the top of that card)
      return (copy ? '<div class="dday nowfc" data-go="d' + k + '" role="link" tabindex="0">' : '<div class="card dday" id="d' + k + '"><div class="gt">' + esc(fmt(d.s, { weekday: "long", month: "short", day: "numeric" })) +
        '<span class="dhl3 num"><span class="hiT">' + (hl[0] != null ? hl[0] + "°F" : "–") + '</span> / <span class="loT">' + (hl[1] != null ? hl[1] + "°F" : "–") + "</span></span></div>") + d.rows.map(function (i) {
        var x = p[i], nt = notes[i] ? '<div class="afdnote"><span>From the forecast discussion</span>' + notes[i].map(esc).join(" ") + "</div>" : "";
        var sub = /^(Today|Tonight|This Afternoon|Overnight|Late Afternoon)$/.test(x.name) ? x.name : x.day ? "Day" : "Night";
        return '<div class="drow"' + (copy ? "" : ' id="p' + i + '"') + '><div class="ccard dc' + (x.day ? "" : " night") + '">' + ccardInner(p, i, true) + '</div><div><div class="dsub">' + esc(sub) + '</div><p>' + esc(x.detail) + "</p>" + nt + "</div></div>";
      }).join("") + "</div>";
    }
    $("det").innerHTML = days.map(function (d, k) { return dayCard(d, k, false); }).join("") || '<div class="card empty">Forecast not available.</div>';
    // Now tab: the current day's card, identical to the Daily one; tapping it opens that card on the Daily tab
    var nd = $("nowday"); if (nd) nd.innerHTML = days.length ? dayCard(days[0], 0, true) : "";
  }


  // ---------- hourly graph ----------
  var G = null;
  function lanes() {
    return [["rain", "Rain"], ["thunder", "Thunder"], ["snow", "Snow"], ["fzra", "Freezing rain"], ["sleet", "Sleet"], ["fog", "Fog"]];
  }
  function blockAt(arr, t) { for (var i = 0; i < arr.length; i++) if (t >= arr[i][0] && t < arr[i][0] + arr[i][1] * H) return arr[i]; return null; }

  function renderGraph() {
    var g = doc && doc.grid; var gin = $("gin");
    if (!g || !g.n) { gin.innerHTML = '<div class="empty">Hourly data not available.</div>'; return; }

    var s = g.s, n = g.n, W = n * PX, start = g.start;
    var X = function (i) { return i * PX + PX / 2; };
    var nowI = Math.max(0, Math.min(n - 1, Math.floor((Date.now() - start) / H)));
    var mids = []; for (var i = 0; i < n; i++) if (hourNum(start + i * H) === 0) mids.push(i);
    var out = [];
    function path(arr, y) {
      var d = "", pen = false;
      for (var i = 0; i < arr.length; i++) { var v = arr[i]; if (v == null) { pen = false; continue; } d += (pen ? "L" : "M") + X(i).toFixed(1) + " " + y(v).toFixed(1); pen = true; }
      return d;
    }
    // returns [lines, label]: the day dividers and the now line sit over the gridlines but under the data; the time label goes on top
    function vlines(h, topY, d0) {
      // day dividers: gridline weight, from the top gridline all the way down to the x-axis tick
      var o = mids.map(function (i) { return '<line x1="' + X(i) + '" x2="' + X(i) + '" y1="' + (d0 == null ? 0 : d0) + '" y2="' + h + '" stroke="var(--daydiv)" stroke-width="1"/>'; }).join("");
      var nx = Math.max(1, Math.min(W - 1, (Date.now() - start) / H * PX)); // exact current minute
      var lbl = fmt(Date.now(), { hour: "numeric", minute: "2-digit" }).replace(" AM", "a").replace(" PM", "p");
      var ty = (topY == null ? 8 : topY) + 13;
      return [o + '<g class="nowg"><line x1="' + nx.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y1="0" y2="' + h + '" stroke="var(--nowg)" stroke-width="1.25"/></g>',
        '<g class="nowg"><text x="' + (nx + 5).toFixed(1) + '" y="' + ty.toFixed(1) + '" font-size="11" font-weight="700" fill="var(--nowtxt)" stroke="var(--surface)" stroke-width="3" paint-order="stroke" stroke-linejoin="round">' + lbl + "</text></g>"];
    }
    function hgrid(ticks, y, h) { return ticks.map(function (t) { return '<line x1="0" x2="' + W + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--grid)" stroke-width="1"/>'; }).join(""); }
    function yax(ticks, y, h, suf) { return '<div class="yax" style="height:' + h + "px;margin-bottom:-" + h + 'px">' + ticks.map(function (t) { return '<span style="top:' + y(t).toFixed(1) + 'px">' + t + (suf || "") + "</span>"; }).join("") + "</div>"; }
    // each graph is its own card: title on top, the scrolling plot + time row, legend underneath
    var MARKS = [];
    function wrap(title, legend, axis, svg, marks, topY, off) {
      MARKS.push({ list: marks || [], top: topY == null ? 8 : topY, off: off || 0 });
      return '<div class="pan"><div class="gt">' + title + '</div><div class="gsc"><div class="gin2" style="width:' + (W + GL) + 'px">' + axis + svg + timeRow() +
        '<div class="cursor" hidden></div><svg class="mk" width="' + W + '" height="200" hidden></svg></div></div><div class="gread" hidden></div><div class="lg">' + legend + "</div></div>";
    }
    // line graphs get a 16px strip above the top gridline for the time label, so it never sits on the data
    function panel(title, legend, h, ticks, y, suf, body, marks) {
      var HD = 16, H2 = h + HD, yT = ticks ? y(ticks[ticks.length - 1]) : 8, yo = function (v) { return y(v) + HD; };
      return wrap(title, legend, ticks ? yax(ticks, yo, H2, suf) : "",
        '<svg class="gsvg plot" width="' + W + '" height="' + H2 + '" viewBox="0 0 ' + W + " " + H2 + '">' + (function (v) { return '<g transform="translate(0,' + HD + ')">' + (ticks ? hgrid(ticks, y, h) : "") + "</g>" + v[0] +
          '<g transform="translate(0,' + HD + ')">' + body + "</g>" + v[1] + nowVals(marks, HD, yT + HD - 18, H2); })(vlines(H2, yT + HD - 18, yT + HD)) + "</svg>", marks, yT + HD - 18, HD);
    }
    // current values printed next to the now line (right side), stacked so labels never collide; hidden while scrubbing
    function nowVals(marks, off, topY, h) {
      var fi = (Date.now() - start) / H - 0.5, i0 = Math.max(0, Math.min(n - 1, Math.floor(fi))), i1 = Math.min(n - 1, i0 + 1), f = Math.max(0, Math.min(1, fi - i0));
      var nx = Math.max(1, Math.min(W - 1, (Date.now() - start) / H * PX)), pts = [];
      (marks || []).forEach(function (m) {
        var a = m.a[i0], b = m.a[i1]; if (a == null) return; if (b == null) b = a;
        var v = a + (b - a) * f; pts.push({ v: Math.round(v), yy: m.y(v) + off, m: m });
      });
      if (!pts.length) return "";
      // y range each series covers under the label's footprint (about 30px right of the now line)
      var k0 = Math.max(0, Math.floor(nx / PX - 0.5)), k1 = Math.min(n - 1, Math.ceil((nx + 34) / PX - 0.5));
      var spans = (marks || []).map(function (m) {
        var lo = Infinity, hi = -Infinity;
        for (var k = k0; k <= k1; k++) { var v = m.a[k]; if (v == null) continue; var yy = m.y(v) + off; lo = Math.min(lo, yy); hi = Math.max(hi, yy); }
        return [lo, hi];
      }).filter(function (r) { return isFinite(r[0]); });
      // a label box [top, bottom] is clear if no series line crosses it
      function clear(top, bot) { return spans.every(function (r) { return r[1] < top - 1 || r[0] > bot + 1; }); }
      var placed = [], o = "", minTop = topY + 20;
      pts.forEach(function (q) {
        var own = spans.length ? null : null, lo = Infinity, hi = -Infinity;
        for (var k = k0; k <= k1; k++) { var v = q.m.a[k]; if (v == null) continue; var yy = q.m.y(v) + off; lo = Math.min(lo, yy); hi = Math.max(hi, yy); }
        if (!isFinite(lo)) { lo = hi = q.yy; }
        // try just above its own line, then just below, then step outward until the box is clear of every line and label
        var cands = [];
        for (var d = 0; d < 60; d += 4) { cands.push(lo - 4 - d); cands.push(hi + 13 + d); }
        var ly = null;
        for (var c = 0; c < cands.length; c++) {
          var base = cands[c], top = base - 10, bot = base + 2;
          if (top < minTop || base > h - 2) continue;
          if (!clear(top, bot)) continue;
          if (placed.some(function (b) { return !(bot < b[0] - 1 || top > b[1] + 1); })) continue;
          ly = base; break;
        }
        if (ly == null) ly = Math.max(minTop + 10, Math.min(h - 3, q.yy - 5));
        placed.push([ly - 10, ly + 2]);
        o += '<circle cx="' + nx.toFixed(1) + '" cy="' + q.yy.toFixed(1) + '" r="3.2" fill="' + q.m.c + '" stroke="var(--surface)" stroke-width="1.5"/>' +
          // a label that lands inside a shaded area (e.g. under the cloud-cover line) turns white with a grey outline so it stays readable
          (q.m.area && ly - 5 > lo ? '<text x="' + (nx + 7).toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="11.5" font-weight="700" fill="#FFFFFF">'
            : '<text x="' + (nx + 7).toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="11.5" font-weight="700" fill="' + q.m.c + '" stroke="var(--surface)" stroke-width="3" paint-order="stroke" stroke-linejoin="round">') + q.v + q.m.u + "</text>";
      });
      return '<g class="nowg">' + o + "</g>";
    }

    function nice(lo, hi, step) { var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step; if (a === b) b += step; var t = []; for (var v = a; v <= b; v += step) t.push(v); return t; }
    function scale(ticks, h, pad) { var a = ticks[0], b = ticks[ticks.length - 1]; return function (v) { return pad + (h - 2 * pad) * (1 - (v - a) / (b - a)); }; }
    var li = function (col, cls, label) { return '<span style="white-space:nowrap"><i class="' + (cls || "") + '" style="border-color:' + col + ";background:" + (cls === "blk" || cls === "dotm" ? col : "transparent") + '"></i>' + label + "</span>"; };

    // time axis under every panel: 3-hour labels with hourly ticks; midnight is labeled with the day instead of "12a"
    var trow = "";
    for (var q = 0; q < n; q++) {
      var tq = start + q * H, hq = hourNum(tq);
      trow += '<line x1="' + X(q) + '" x2="' + X(q) + '" y1="0" y2="' + (hq % 3 === 0 ? 4 : 3) + '" stroke="var(--muted)" stroke-width="1"/>';
      if (hq === 0) trow += '<text x="' + X(q) + '" y="12" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink)" dy="2">' + esc(fmt(tq, { weekday: "short" })) + "</text>";
      else if (hq % 3 === 0) trow += '<text x="' + X(q) + '" y="12" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ink)" dy="2">' + hr(tq) + "</text>";
    }
    function timeRow() { return '<svg class="gsvg trow" width="' + W + '" height="20">' + trow + "</svg>"; }

    // time header
    var th = 34, head = "";
    for (i = 0; i < n; i++) {
      var t = start + i * H, hn = hourNum(t);
      if (hn % 3 === 0) head += '<text x="' + X(i) + '" y="29" text-anchor="middle" font-size="10" fill="var(--muted)">' + hr(t) + "</text>";
    }
    mids.forEach(function (i) { head += '<text x="' + (i * PX + 4) + '" y="12" font-size="11" font-weight="600" fill="var(--ink)">' + esc(fmt(start + i * H, { weekday: "short", month: "numeric", day: "numeric" })) + "</text>"; });
    if (!mids.length || mids[0] > 6) head = '<text x="4" y="12" font-size="11" font-weight="600" fill="var(--ink)">' + esc(fmt(start, { weekday: "short", month: "numeric", day: "numeric" })) + "</text>" + head;

    // 1 temperature
    var tv = s.t.concat(s.wc, s.hi).filter(function (v) { return v != null; });
    var tt = nice(Math.min.apply(null, tv), Math.max.apply(null, tv), 10), h1 = 150, y1 = scale(tt, h1, 8);
    var hasWc = s.wc.some(function (v) { return v != null; }), hasHi = s.hi.some(function (v) { return v != null; });
    out.push(panel("Temperature (°F)", li("var(--t)", "", "Temp") + (hasWc ? li("var(--wc)", "", "Wind chill") : "") + (hasHi ? li("var(--hi)", "", "Heat index") : ""), h1, tt, y1, "°",
      (hasWc ? '<path d="' + path(s.wc, y1) + '" fill="none" stroke="var(--wc)" stroke-width="2"/>' : "") +
      (hasHi ? '<path d="' + path(s.hi, y1) + '" fill="none" stroke="var(--hi)" stroke-width="2"/>' : "") +
      '<path d="' + path(s.t, y1) + '" fill="none" stroke="var(--t)" stroke-width="2.75"/>',
      [{ a: s.t, y: y1, c: "var(--t)", u: "°", n: "Temp" }, { a: s.wc, y: y1, c: "var(--wc)", u: "°", n: "Wind chill" }, { a: s.hi, y: y1, c: "var(--hi)", u: "°", n: "Heat index" }]));

    // 1b UV index (EPA hourly forecast; it covers about the next day only)
    var uvA = []; for (i = 0; i < n; i++) uvA.push(uvAt(start + i * H));
    if (false) { // UV graph removed at Tyler's request (EPA data covers only ~1 day)
      var um = Math.max.apply(null, uvA.filter(function (v) { return v != null; })), ut = nice(0, Math.max(6, um), um > 8 ? 3 : 2), hu = 90, yu = scale(ut, hu, 6);
      var ua = path(uvA, yu), segs = "", run = [];
      // shaded area under each continuous run
      for (i = 0; i <= n; i++) {
        if (i < n && uvA[i] != null) { run.push(i); continue; }
        if (run.length) { segs += '<path d="M' + X(run[0]) + " " + yu(0) + run.map(function (k) { return "L" + X(k) + " " + yu(uvA[k]).toFixed(1); }).join("") + "L" + X(run[run.length - 1]) + " " + yu(0) + 'Z" fill="var(--uv)" fill-opacity=".18"/>'; run = []; }
      }
      out.push(panel("UV Index", li("var(--uv)", "", "UV index (EPA forecast)"), hu, ut, yu, "", segs + '<path d="' + ua + '" fill="none" stroke="var(--uv)" stroke-width="2.25"/>',
        [{ a: uvA, y: yu, c: "var(--uv)", u: "" }]));
    }

    // 2 wind
    var wmax = Math.max(20, Math.max.apply(null, s.wg.concat(s.ws).filter(function (v) { return v != null; })));
    var wt = nice(0, wmax, wmax > 40 ? 20 : 10), h2 = 110, y2 = scale(wt, h2, 6);
    out.push(panel("Wind (mph)", li("var(--wind)", "", "Sustained") + li("var(--gust)", "", "Gusts"), h2, wt, y2, "",
      '<path d="' + path(s.wg, y2) + '" fill="none" stroke="var(--gust)" stroke-width="2.25"/>' +
      '<path d="' + path(s.ws, y2) + '" fill="none" stroke="var(--wind)" stroke-width="2.25"/>',
      [{ a: s.ws, y: y2, c: "var(--wind)", u: " mph", n: "Sustained" }, { a: s.wg, y: y2, c: "var(--gust)", u: " mph", n: "Gusts" }]));

    // 3 Precipitation: one card for how likely (chance line on a 0-100% scale with the NWS wording bands), what kind
    //   (hourly bars coloured by type, split when types mix; thunder/fog as marks along the top) and how much (amount
    //   boxes per NWS time block, one row each for liquid, snow and ice).
    var COVW = { SChc: "slight chance", Chc: "chance", Lkly: "likely", Ocnl: "occasional", Iso: "isolated", Patchy: "patchy", Sct: "scattered", Areas: "areas",
      Num: "numerous", Wide: "widespread", Pds: "periods", Inter: "intermittent", Brf: "brief", Def: "definite", Frq: "frequent" };
    var PT = [["rain", "Rain"], ["snow", "Snow"], ["fzra", "Freezing rain"], ["sleet", "Sleet"]], MKT = [["thunder", "Thunder"], ["hail", "Hail"], ["fog", "Fog"]].filter(function (t) { return s[t[0]]; }); // hail: older cached data has none
    var frozen = ["snow", "ice"].some(function (k) { return (g[k] || []).some(function (b) { return b[2] > 0; }); });
    var AMT = [["qpf", frozen ? "Liquid" : "Rain", "rain", 2], ["snow", "Snow", "snow", 1], ["ice", "Ice", "fzra", 2]].filter(function (a) { return (g[a[0]] || []).some(function (b) { return b[2] > 0; }); });
    var LVP = [20, 50, 70, 100]; // top of each NWS wording band: slight chance 10-20%, chance 30-50%, likely 60-70%, definite/occasional 80-100%
    var pTop = 34, pH = 108, pBase = pTop + pH, yP = function (v) { return pBase - pH * v / 100; };
    var rowY = function (k) { return pBase + 6 + k * 20; }, pHH = pBase + (AMT.length ? 6 + AMT.length * 20 : 6);
    var pg = "", pb = "";
    // wording bands (the SChc/Chc/Lkly/Ocnl scale) behind everything
    [[10, 20], [30, 50], [60, 70], [80, 100]].forEach(function (r) { pg += '<rect x="0" y="' + yP(r[1]) + '" width="' + W + '" height="' + (yP(r[0]) - yP(r[1])) + '" fill="var(--grid)" fill-opacity=".55"/>'; });
    pg += '<line x1="0" x2="' + W + '" y1="' + pBase + '" y2="' + pBase + '" stroke="var(--line)"/>';
    var used = {};
    for (i = 0; i < n; i++) {
      var here = PT.filter(function (t) { return s[t[0]][i]; });
      here.forEach(function (t, k) {
        var v = s[t[0]][i], top = yP(LVP[Math.min(4, v[0]) - 1]), w = (PX - 4) / here.length; used[t[0]] = 1;
        pb += '<rect x="' + (i * PX + 2 + k * w).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (pBase - top).toFixed(1) + '" fill="var(--' + t[0] + ')" fill-opacity=".85"/>';
      });
      MKT.forEach(function (t, k) {
        var v = s[t[0]][i]; if (!v) return; used[t[0]] = 1;
        pb += '<rect x="' + (i * PX + 1) + '" y="' + (16 + k * 6) + '" width="' + (PX - 2) + '" height="5" rx="1.5" fill="var(--' + t[0] + ')" fill-opacity="' + (0.35 + 0.16 * Math.min(4, v[0])) + '"/>';
      });
    }
    // exact chance of precipitation on top of the bars
    pb += '<path d="' + path(s.pop, yP) + '" fill="none" stroke="var(--ink2)" stroke-width="2"/>';
    AMT.forEach(function (a, k) {
      (g[a[0]] || []).forEach(function (b) {
        if (!(b[2] > 0)) return;
        var x0 = Math.max(0, (b[0] - start) / H) * PX, x1 = Math.min(n, (b[0] - start) / H + b[1]) * PX; if (x1 - x0 < 8) return;
        pb += '<rect x="' + (x0 + 1) + '" y="' + rowY(k) + '" width="' + (x1 - x0 - 2) + '" height="16" rx="3" fill="var(--surface)" stroke="var(--' + a[2] + ')" stroke-width="1.25"/>' +
          '<text x="' + ((x0 + x1) / 2) + '" y="' + (rowY(k) + 12) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">' + b[2].toFixed(a[3]) + ' in</text>';
      });
    });
    var pAxis = '<div class="yax" style="height:' + pHH + "px;margin-bottom:-" + pHH + 'px">' +
      [["SChc", 15], ["Chc", 40], ["Lkly", 65], ["Ocnl", 90]].map(function (l) { return '<span style="top:' + yP(l[1]) + 'px">' + l[0] + "</span>"; }).join("") +
      AMT.map(function (a, k) { return '<span style="top:' + (rowY(k) + 8) + 'px">' + (a[1] === "Liquid" ? "Liq" : a[1]) + "</span>"; }).join("") + "</div>";
    var pLegend = li("var(--ink2)", "", "Precip chance") + PT.concat(MKT).filter(function (t) { return used[t[0]]; }).map(function (t) { return li("var(--" + t[0] + ")", "blk", t[1]); }).join("") +
      (AMT.length ? li("var(--line)", "box", "Amount per NWS time block") : "") + '<span style="white-space:nowrap;color:var(--muted)">Bands: slight chance · chance · likely · definite</span>';
    var pMarks = [{ a: s.pop, y: yP, c: "var(--ink2)", u: "%", n: "Precip chance" }];
    var PK = out.length; // this card leads the Hourly tab
    out.push(wrap("Precipitation", pLegend, pAxis, '<svg class="gsvg plot" width="' + W + '" height="' + pHH + '">' +
      (function (v) { return pg + v[0] + pb + v[1] + nowVals(pMarks, 0, 0, pHH); })(vlines(pHH, 0, pTop)) + "</svg>",
      // holding: a compact stack under the time (chance, then the types with their wording, then this block's amounts)
      [{ txt: function (i) {
        var o = [s.pop[i] == null ? "Chance: –" : s.pop[i] + "% chance"];
        var ty = PT.concat(MKT).filter(function (t) { return s[t[0]][i]; }).map(function (t, k) { var w = COVW[s[t[0]][i][1]] || s[t[0]][i][1].toLowerCase(); return (k ? t[1].toLowerCase() : t[1]) + " " + w; });
        for (var q = 0; q < ty.length; q += 2) { var ln = ty.slice(q, q + 2).join(", "); o.push(ln.charAt(0).toUpperCase() + ln.slice(1)); }
        // a liquid block with no snow or ice in it is plain rain
        var am = AMT.map(function (a) {
          var b = blockAt(g[a[0]] || [], start + i * H); if (!(b && b[2])) return null;
          var nm = a[1] === "Liquid" && !["snow", "ice"].some(function (k) { var x = blockAt(g[k] || [], start + i * H); return x && x[2] > 0; }) ? "Rain" : a[1];
          return nm + " " + b[2].toFixed(a[3]) + '"';
        }).filter(Boolean);
        return o.concat(am);
        return o;
      } }], 0));
    var WXK = [PK];

    // 4 cloud cover
    var pt = [0, 25, 50, 75, 100], h3 = 90, y3 = scale(pt, h3, 6);
    var sky = path(s.sky, y3); var skyA = sky ? sky + "L" + X(n - 1) + " " + y3(0) + "L" + X(0) + " " + y3(0) + "Z" : "";
    var CLOUDK = out.length; // right under Precipitation, above Temperature
    out.push(panel("Cloud Cover (%)", li("var(--sky)", "blk", "Sky cover (cloud %)"), h3, pt, y3, "",
      '<path d="' + skyA + '" fill="var(--sky)" fill-opacity=".28" stroke="var(--sky)" stroke-width="1"/>',
      [{ a: s.sky, y: y3, c: "var(--sky)", u: "%", area: true, n: "Sky cover" }]));

    // All cards share ONE native horizontal scroller (.gall), so sideways scrolling runs on the browser's compositor at the
    //   display's full refresh rate with no script keeping cards in step. Card backgrounds sit in a fixed layer behind it
    //   (.gbg); titles, legends and y-axes stay put with position:sticky.
    gin.innerHTML = '<div class="gbg"></div><div class="gall"><div class="gwide" style="width:' + (W + GL) + 'px">' + out.join("") + "</div></div>";
    // order: Precipitation, Cloud Cover, then Temperature and Wind (CSS order, so the DOM order that MARKS is indexed by stays put)
    gin.querySelectorAll(".pan").forEach(function (pn, k) { var r = WXK.indexOf(k); pn.style.order = r >= 0 ? r - 100 : k === CLOUDK ? -50 : k; });
    gLayout();
    G = { start: start, n: n, nowI: nowI, mids: mids, marks: MARKS, W: W };

    // day chips
    var dh = '<button type="button" class="chip on" data-x="' + Math.max(0, nowI - 6) + '">Now</button>';
    mids.forEach(function (i) { dh += '<button type="button" class="chip" data-x="' + i + '">' + esc(fmt(start + i * H, { weekday: "short", day: "numeric" })) + "</button>"; });
    $("days").innerHTML = dh;
    if (selIdx == null || selIdx >= n) selIdx = nowI;
    select(selIdx, null, false);
    requestAnimationFrame(function () { scrollAll(Math.max(0, GL + ((Date.now() - start) / H) * PX - firstSc().clientWidth * 0.3)); });
  }


  function extremaLabels(arr, y) {
    // daily high and low right on the temperature line, with a halo so they read over the other lines
    var o = "", n = arr.length, day = {};
    for (var i = 0; i < n; i++) {
      if (arr[i] == null) continue;
      var k = fmt(doc.grid.start + i * H, { month: "numeric", day: "numeric" });
      var d = day[k] || (day[k] = { hi: i, lo: i });
      if (arr[i] > arr[d.hi]) d.hi = i; if (arr[i] < arr[d.lo]) d.lo = i;
    }
    var lab = function (i, dy) {
      return '<text x="' + (i * PX + PX / 2) + '" y="' + (y(arr[i]) + dy) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--ink)" stroke="var(--surface)" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">' + arr[i] + "°</text>";
    };
    Object.keys(day).forEach(function (k) {
      var d = day[k];
      o += lab(d.hi, -8);
      if (d.lo !== d.hi) o += lab(d.lo, -8);
    });
    return o;
  }

  function firstSc() { return $("gin").querySelector(".gall") || $("gin"); }
  function scrollAll(x, smooth) { firstSc().scrollTo({ left: x, behavior: smooth ? "smooth" : "auto" }); }
  // size sticky titles/legends to the visible width and draw each card's box behind its panel
  function gLayout() {
    var gin = $("gin"), all = gin.querySelector(".gall"), bg = gin.querySelector(".gbg"); if (!all || !bg) return;
    all.style.setProperty("--vw", all.clientWidth + "px");
    var pans = gin.querySelectorAll(".pan"), boxes = [];
    for (var k = 0; k < pans.length; k++) boxes.push('<div style="top:' + pans[k].offsetTop + "px;height:" + pans[k].offsetHeight + 'px"></div>');
    bg.innerHTML = boxes.join("");
  }
  if (window.ResizeObserver) new ResizeObserver(function () { requestAnimationFrame(gLayout); }).observe($("gin"));
  function select(i, host, show) {
    if (!G) return; selIdx = i;
    var s = doc.grid.s, t = G.start + i * H;
    var cur = [];
    $("gin").querySelectorAll(".gin2").forEach(function (g2) {
      var c = g2.querySelector(".cursor"), sv = g2.querySelector("svg.plot"); if (!c || !sv) return;
      cur.push([c, sv.offsetTop, sv.getAttribute("height")]);
    });
    cur.forEach(function (x) { var c = x[0]; c.hidden = !show; c.style.left = (GL + i * PX + PX / 2) + "px"; c.style.top = x[1] + "px"; c.style.height = x[2] + "px"; });
    var scv = firstSc(), sFlip = GL + i * PX + PX / 2 - scv.scrollLeft > scv.clientWidth * 0.55 || i * PX + PX / 2 > G.W - 70;
    $("gin").querySelectorAll(".pan").forEach(function (pn, k) {
      var mk = pn.querySelector("svg.mk"), sv = pn.querySelector("svg.plot"); if (!mk) return;
      var mm = (G.marks && G.marks[k]) || { list: [], top: 8 }, ms = mm.list;
      if (!show) { mk.setAttribute("hidden", ""); return; }
      mk.setAttribute("height", sv.getAttribute("height"));
      var x = i * PX + PX / 2, o = "", pts = [], TX = 'font-weight="700" fill="var(--nowtxt)" stroke="var(--surface)" stroke-width="3" paint-order="stroke" stroke-linejoin="round"';
      var flip = sFlip; // labels go to the left of the cursor once it's past the middle of the screen
      var tl = fmt(t, { hour: "numeric", minute: "2-digit" }).replace(" AM", "a").replace(" PM", "p");
      // time of the scrubbed hour, same spot and style as the current-time label
      o += '<text x="' + (flip ? x - 5 : x + 5) + '" y="' + (mm.top + 13) + '"' + (flip ? ' text-anchor="end"' : "") + ' font-size="11" ' + TX + ">" + (i === G.nowI ? "Now · " : "") + fmt(t, { weekday: "short" }) + " " + tl + "</text>";
      var off = mm.off || 0;
      ms.forEach(function (m) {
        if (m.txt) { m.txt(i).forEach(function (line, j) { o += '<text x="' + (flip ? x - 5 : x + 5) + '" y="' + (mm.top + 28 + j * 14) + '"' + (flip ? ' text-anchor="end"' : "") + ' font-size="11.5" ' + TX + ">" + esc(line) + "</text>"; }); return; }
        var v = m.a[i]; if (v != null) pts.push({ v: v, yy: m.y(v) + off, m: m });
      });
      pts.sort(function (a, b) { return a.yy - b.yy; });
      var last = mm.top + 16;
      pts.forEach(function (q) {
        var ly = Math.max(q.yy + 4, last + 13); last = ly;
        o += '<circle cx="' + x + '" cy="' + q.yy.toFixed(1) + '" r="4" fill="' + q.m.c + '" stroke="var(--surface)" stroke-width="2"/>' +
          '<text x="' + (flip ? x - 8 : x + 8) + '" y="' + ly.toFixed(1) + '"' + (flip ? ' text-anchor="end"' : "") + ' font-size="11.5" ' + TX + ">" + q.v + q.m.u + (q.m.n ? '<tspan dx="4" font-size="10" font-weight="600" fill="' + q.m.c + '">' + q.m.n + "</tspan>" : "") + "</text>";
      });
      mk.innerHTML = o; mk.removeAttribute("hidden");
    });
    $("gin").querySelectorAll(".gread").forEach(function (r) { r.hidden = true; });
    $("gin").classList.toggle("scrubbing", !!show);
    return; // values are drawn right on the graphs; no table below
    var v = function (a, suf) { return a[i] == null ? "–" : a[i] + (suf || ""); };
    var wx = lanes().filter(function (l) { return s[l[0]][i]; }).map(function (l) { return l[1] + " " + s[l[0]][i][1]; });
    var amt = [];
    [["qpf", "Rain", 2], ["snow", "Snow", 2], ["ice", "Ice", 2]].forEach(function (a) {
      var b = blockAt(doc.grid[a[0]] || [], t); if (b && b[2]) amt.push(a[1] + " " + b[2].toFixed(a[2]) + " in (" + hr(b[0]) + "–" + hr(b[0] + b[1] * H) + ")");
    });
    var rows = [["Temp", v(s.t, "°")], s.wc[i] != null ? ["Wind chill", s.wc[i] + "°"] : s.hi[i] != null ? ["Heat index", s.hi[i] + "°"] : null,
      ["Wind", s.ws[i] == null ? "–" : cmp(s.wd[i]) + " " + s.ws[i] + " mph" + (s.wg[i] ? ", gusts " + s.wg[i] : "")],
      ["Precip chance", v(s.pop, "%")], ["Sky cover", v(s.sky, "%")], ["Thunder", v(s.thp, "%")]];
    rows = rows.filter(Boolean);
    if (wx.length) rows.push(["Weather", wx.join(", ")]);
    amt.forEach(function (a) { rows.push(["Amount", a]); });
    var r = host.querySelector(".gread");
    r.innerHTML = '<div class="gr-t">' + esc(fmt(t, { weekday: "long", hour: "numeric" })) + (i === G.nowI ? " · now" : "") + '</div><dl class="num">' +
      rows.map(function (x) { return "<div><dt>" + x[0] + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("") + "</dl>";
    r.hidden = false;
  }


  // ---------- storm totals ----------
  function sumRange(arr, a, b) {
    var t = 0; (arr || []).forEach(function (x) { var s0 = x[0], e0 = x[0] + x[1] * H, ov = (Math.min(e0, b) - Math.max(s0, a)) / H; if (ov > 0 && x[2]) t += x[2] * ov / x[1]; }); return t;
  }
  function renderTotals() {
    var g = doc && doc.grid; if (!g) { $("tot").innerHTML = '<div class="empty">Not available.</div>'; return; }
    var now = Math.max(Date.now(), g.start), end = g.start + g.n * H;
    var cols = [["Next 24 hr", 24], ["48 hr", 48], ["72 hr", 72], ["All", null]];
    var rows = [["Rain", "qpf", 2], ["Snow", "snow", 2], ["Ice", "ice", 2]];
    var any = false;
    var body = rows.map(function (r) {
      var vals = cols.map(function (c) { var v = sumRange(g[r[1]], now, c[1] ? now + c[1] * H : end); if (v >= (r[1] === "snow" ? 0.05 : 0.005)) any = true; return v; });
      return { r: r, vals: vals, show: vals[3] >= (r[1] === "snow" ? 0.05 : 0.005) };
    });
    // events: contiguous blocks with liquid >= 0.01 or snow > 0
    var qb = (g.qpf || []).filter(function (b) { return b[0] + b[1] * H > now; }), ev = [], curE = null;
    qb.forEach(function (b) {
      var sn = sumRange(g.snow, b[0], b[0] + b[1] * H), wet = b[2] >= 0.01 || sn >= 0.1;
      if (wet) { if (!curE) { curE = { s: b[0], e: 0 }; ev.push(curE); } curE.e = b[0] + b[1] * H; } else curE = null;
    });
    var html = "";
    if (!any) html = '<div class="empty" style="padding:2px 0">No measurable rain, snow, or ice in the forecast through ' + esc(fmt(end, { weekday: "short", hour: "numeric" })) + ".</div>";
    else html = '<table class="tt num"><thead><tr><th></th>' + cols.map(function (c) { return "<th>" + c[0] + "</th>"; }).join("") + "</tr></thead><tbody>" +
      body.filter(function (b) { return b.show; }).map(function (b) { return "<tr><td>" + b.r[0] + "</td>" + b.vals.map(function (v) { return "<td>" + v.toFixed(b.r[2]) + " in</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>";
    if (ev.length) html += '<div class="ev-list">' + ev.slice(0, 4).map(function (e) {
      var q = sumRange(g.qpf, e.s, e.e), sn = sumRange(g.snow, e.s, e.e), ic = sumRange(g.ice, e.s, e.e);
      return '<div class="evt num"><b>' + esc(dtm(Math.max(e.s, now)).replace(":00", "")) + " – " + esc(dtm(e.e).replace(":00", "")) + "</b><span>" +
        [q >= 0.01 ? q.toFixed(2) + " in rain" : null, sn >= 0.1 ? sn.toFixed(2) + " in snow" : null, ic >= 0.01 ? ic.toFixed(2) + " in ice" : null].filter(Boolean).join(" · ") + "</span></div>";
    }).join("") + "</div>";
    $("tot").innerHTML = html;
  }

  // ---------- observations ----------
  function renderObs() {
    var o = (doc && doc.obs) || [], st = (doc && doc.station) || {};
    $("obsstn").textContent = st.id ? st.id + " · last 24 hr" : "";
    if (!o.length) { $("obscard").innerHTML = '<div class="empty">No recent observations.</div>'; return; }
    var pts = o.slice().reverse().filter(function (x) { return x.t != null; });
    var w = 600, h = 64, mn = Math.min.apply(null, pts.map(function (p) { return p.t; })), mx = Math.max.apply(null, pts.map(function (p) { return p.t; }));
    if (mx === mn) mx = mn + 1;
    var t0 = pts[0].ms, t1 = pts[pts.length - 1].ms || t0 + 1;
    var xy = function (p) { return [((p.ms - t0) / Math.max(1, t1 - t0)) * (w - 40) + 6, 10 + (h - 22) * (1 - (p.t - mn) / (mx - mn))]; };
    var d = pts.map(function (p, i) { var c = xy(p); return (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1); }).join("");
    var last = xy(pts[pts.length - 1]);
    var spark = '<div class="spark"><svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" style="overflow:visible"><path d="' + d + 'L' + last[0] + " " + (h - 4) + "L6 " + (h - 4) + 'Z" fill="var(--t)" fill-opacity=".08"/><path d="' + d + '" fill="none" stroke="var(--t)" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.5" fill="var(--t)"/></svg>' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)" class="num"><span>' + esc(dtm(t0)) + "</span><span>24-hr range " + mn + "° – " + mx + "°F</span><span>" + esc(tm(t1)) + "</span></div></div>";
    // compact rows so everything fits on one line: short time, with a day row whenever the date changes
    var lastDay = null;
    var rows = o.map(function (x) {
      var dname = fmt(x.ms, { weekday: "long", month: "short", day: "numeric" }), sep = "";
      if (dname !== lastDay) { sep = '<tr class="oday"><td colspan="5">' + esc(dname) + "</td></tr>"; lastDay = dname; }
      return sep + "<tr><td>" + esc(tm(x.ms).replace(" AM", "a").replace(" PM", "p")) + "</td><td>" + esc(x.desc) + "</td><td>" + (x.t == null ? "–" : x.t + "°") + 
        "</td><td>" + (x.ws == null ? "–" : x.ws === 0 ? "Calm" : (x.wd || "") + " " + x.ws + (x.wg ? " G" + x.wg : "")) + "</td><td>" + (x.vis == null ? "–" : x.vis) + "</td></tr>";
    }).join("");
    $("obscard").innerHTML = spark + '<div class="tscroll"><table class="ot num"><thead><tr><th>Time</th><th>Weather</th><th>Temp</th><th>Wind</th><th>Vis</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  // ---------- forecaster notes: plain-language lines from the Area Forecast Discussion, pinned to the day they mention ----------
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var STOP = /^(the|and|with|that|this|will|should|from|into|over|near|more|some|than|then|there|their|have|been|being|through|around|remain|remains|expected|forecast|conditions|also|very|most|much|only|each|when|which|while|would|could|about|after|before|again|across|region|area|areas|possible|chance|chances)$/;
  var ACRO = /\b[A-Z]{3,}s?\b|\bH\d{3}\b/;
  var JARGON = /percentile|guidance|ensemble|deterministic|forcing|synoptic|shortwave|trough|vort|isentropic|advection|omega|frontogenesis|\bmodel|\bPoPs?\b|\bQPF\b|\bCAMs?\b|thermodynamic|kinematic|\bj\/kg|\bkts?\b|aforementioned|\bflow\b/i;
  function words(t) { return (String(t).toLowerCase().match(/[a-z]{4,}/g) || []).filter(function (w) { return !STOP.test(w); }); }
  function afdNotes() {
    var a = doc && doc.afd, p = (doc && doc.periods) || [];
    if (!a || !a.text || !p.length) return {};
    var txt = a.text.replace(/\r/g, ""), cands = [];
    var km = /\.KEY MESSAGES\.\.\.\s*([\s\S]*?)\n&&/.exec(txt);
    if (km) km[1].split(/\n\s*-\s+/).forEach(function (b) { b = b.replace(/^\s*-\s*/, "").replace(/\s+/g, " ").trim(); if (b) cands.push({ t: b, k: 1 }); });
    var ds = /\.(?:DISCUSSION|SHORT TERM|LONG TERM)[^\n]*\.\.\.\s*([\s\S]*?)\n&&/g, m;
    while ((m = ds.exec(txt))) {
      m[1].split(/\n\s*\n/).forEach(function (para) {
        para = para.replace(/\s+/g, " ").trim();
        if (!para || /^Issued at/i.test(para)) return;
        var hd = /^([A-Z][^.:]{3,60}):\s*(.{3,90})$/.exec(para);
        if (hd) { hd[2].split(/\s+-\s+|;\s*/).forEach(function (f) { cands.push({ t: f.replace(/[.\s]+$/, "") + ".", k: 2 }); }); return; }
        (para.match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).forEach(function (sn) { cands.push({ t: sn.trim(), k: 3 }); });
      });
    }
    // periods by weekday (first occurrence of each name); notes go on the daytime period, or the night one when the text says "<day> night"
    var byDay = {}, issuedDay = fmt(a.issued, { weekday: "long" });
    p.forEach(function (x, i) {
      var d = fmt(x.s, { weekday: "long" });
      if (byDay[d] && byDay[d].closed) return;
      if (!byDay[d]) { Object.keys(byDay).forEach(function (k) { byDay[k].closed = true; }); byDay[d] = { idx: i, night: null, text: "" }; }
      if (x.day) byDay[d].idx = i; else byDay[d].night = i;
      byDay[d].text += " " + (x.detail || "");
    });
    var ORD = { 1: 0, 3: 1, 2: 2 }, reDay = new RegExp("\\b(" + DAYS.join("|") + ")( night)?\\b", "i"), reToday = /\b(today|this afternoon)\b|\b(tonight|this evening)\b/i;
    var notes = {}, used = {};
    cands.sort(function (x, y) { return ORD[x.k] - ORD[y.k]; }).forEach(function (c) {
      var t = c.t.replace(/\s+/g, " ").trim();
      if (t.length < 8 || t.length > 240 || used[t] || ACRO.test(t) || JARGON.test(t)) return;
      var d, night = false, mm = reDay.exec(t), mt;
      if (mm) { d = mm[1].charAt(0).toUpperCase() + mm[1].slice(1).toLowerCase(); night = !!mm[2]; }
      else if ((mt = reToday.exec(t))) { d = issuedDay; night = !!mt[2]; }
      else return;
      var bd = byDay[d]; if (!bd) return;
      var idx = night && bd.night != null ? bd.night : (p[bd.idx] ? bd.idx : bd.night);
      if (idx == null) return;
      // skip it when the NWS period text already says the same thing
      var w = words(t), have = words(bd.text), hit = w.filter(function (x) { return have.indexOf(x) >= 0; }).length;
      if (w.length && hit / w.length > 0.6) return;
      var l = notes[idx] || (notes[idx] = []);
      if (c.k === 2 && l.length) return; // section headlines only when nothing better is there
      if (l.length >= 2 || l.join(" ").length + t.length > 300) return;
      l.push(t.charAt(0).toUpperCase() + t.slice(1)); used[t] = 1;
    });
    return notes;
  }

  // safety / liability notice, on every tab (plain text: no outbound links)
  var NOTICE = '<p class="notice"><b>Not an official warning source.</b> Forecasts, alerts and maps come from the National Weather Service ' +
    "and NOAA and are shown as published, but they can be delayed, incomplete or out of date here, and this site can fail to load or update. " +
    "Don't rely on it for decisions that affect life or property. For emergencies and the latest official warnings, use weather.gov, " +
    "NOAA Weather Radio, Wireless Emergency Alerts on your phone and local officials. This is an independent site, not affiliated with or " +
    "endorsed by NWS or NOAA, provided as-is without warranty of any kind; you use it at your own risk.</p>";
  function renderFoot() {
    if (!doc) { $("foot").innerHTML = NOTICE; return; }
    var l = doc.loc;
    var link = "https://forecast.weather.gov/MapClick.php?lat=" + l.lat + "&lon=" + l.lon;
    $("plabel").textContent = l.label || HOME.label;
    document.title = (l.label || HOME.label) + " Weather";
    if (false) $("psub").textContent = "NWS " + l.office + " · grid " + l.grid + " · " + l.lat.toFixed(4) + "°N " + Math.abs(l.lon).toFixed(4) + "°W" + (l.elevFt ? " · " + l.elevFt + " ft" : "");
    $("foot").innerHTML = NOTICE;
  }

  function renderAll() {
    if (doc && doc.loc && doc.loc.tz) TZ = doc.loc.tz;
    renderFresh(); renderNow(); renderWeek(); if (tab === "hourly") renderGraph(); else G = null; renderTotals(); renderDetail(); renderObs(); renderFoot(); if (tab === "maps") renderMaps();
    activeCard = -1; if (tab === "daily") requestAnimationFrame(syncStrip);
  }

  // ---------- data ----------
  function accept(d) {
    if (!d || !d.v || !d.grid) return false;
    doc = d; renderAll(); return true;
  }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  // Every refresh pulls live from weather.gov for the current location (about 2-3 s).
  function refresh(manual) {
    if (busy) return Promise.resolve(false); busy = true;
    var b = $("rbtn"); b.classList.add("spin"); $("ftxt").textContent = "Refreshing…";
    var t0 = Date.now();
    return (TEST ? WXScenario.load(TEST, curLoc(), doc || store("wx-cache")) : WXLive.load(curLoc())).then(function (d) {
      accept(d); lastCheck = Date.now(); if (!TEST) saveCache(d);
      if (manual) toast(TEST ? "Test scenario regenerated" : "Updated from weather.gov");
      return true;
    }).catch(function (e) {
      console.error(e);
      toast(doc ? "Couldn't reach weather.gov · showing the last loaded data" : "Couldn't reach weather.gov · tap refresh to try again");
      return false;
    }).then(function (ok) {
      setTimeout(function () { busy = false; b.classList.remove("spin"); renderFresh(); }, Math.max(0, 400 - (Date.now() - t0)));
      return ok;
    });
  }

  // ---------- interactions ----------
  $("rbtn").addEventListener("click", function () { refresh(true); });
  function stripClick(e) {
    var c = e.target.closest("[data-i]"); if (!c) return;
    showTab("daily");
    var r = $("p" + c.dataset.i); if (!r) return;
    tapLock = +c.dataset.i; activeCard = -1; syncStrip();
    // target = where the pinned card row sits once stuck (its sticky top + height), not where it is right now
    function target() {
      var d = $("daily"), stuck = parseFloat(getComputedStyle(d).top) || 0;
      return Math.max(0, Math.round(r.getBoundingClientRect().top + window.scrollY - (stuck + d.offsetHeight)));
    }
    setTimeout(function () {
      window.scrollTo({ top: target(), behavior: "smooth" });
      // settle: correct any drift after the smooth scroll (iOS can stop short or be interrupted)
      setTimeout(function () { var t = target(); if (Math.abs(window.scrollY - t) > 2) window.scrollTo(0, t); }, 650);
    }, 30);
  }
  $("strip").addEventListener("click", stripClick);
  $("nowcard").addEventListener("click", function (e) {
    var c = e.target.closest("[data-go]"); if (!c) return;
    showTab("daily");
    var t = $(c.dataset.go); if (!t) return;
    requestAnimationFrame(function () { window.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top + window.scrollY - document.querySelector(".top").offsetHeight - 12), behavior: "auto" }); });
  });
  $("strip2").addEventListener("click", stripClick);

  // Daily: compact strip stays pinned and follows the paragraph being read
  var activeCard = -1, syncQueued = false, tapLock = null;
  // a tapped card stays the highlighted one until the viewer scrolls by hand again
  ["touchstart", "wheel", "keydown"].forEach(function (ev) { window.addEventListener(ev, function (e) { if (tapLock != null && !(e.target.closest && e.target.closest("#strip2"))) { tapLock = null; } }, { passive: true }); });
  function stickyBottom() { var d = $("daily"); return d.hidden ? document.querySelector(".top").getBoundingClientRect().bottom : d.getBoundingClientRect().bottom; }
  function syncStrip() {
    syncQueued = false;
    if (tab !== "daily") return;
    var rows = document.querySelectorAll("#det .drow"); if (!rows.length) return;
    // the period directly under the pinned strip is the one being read
    // switch a little before the next period reaches the pinned row, so the highlight leads
    var line = stickyBottom() + 64, cur = 0;
    for (var k = 0; k < rows.length; k++) { if (rows[k].getBoundingClientRect().top <= line) cur = k; else break; }
    if (tapLock != null) cur = tapLock;
    if (cur === activeCard) return;
    activeCard = cur;
    // no row highlighting: every period looks the same while scrolling
    var cards = $("strip2").children, s = $("strip2");
    for (k = 0; k < cards.length; k++) cards[k].classList.toggle("on", k === cur);
    var c = cards[cur];
    if (c) s.scrollTo({ left: c.offsetLeft - (s.clientWidth - c.offsetWidth) / 2, behavior: "smooth" });
  }
  window.addEventListener("scroll", function () { if (!syncQueued) { syncQueued = true; requestAnimationFrame(syncStrip); } }, { passive: true });
  function setTopH() { document.documentElement.style.setProperty("--toph", document.querySelector(".top").offsetHeight + "px"); }
  setTopH(); window.addEventListener("resize", setTopH);
  function showTab(t) {
    if (t === "totals") t = "obs"; // old tab name
    if (!$("nav").querySelector('[data-tab="' + t + '"]')) t = "now";
    var changed = t !== tab; tab = t;
    document.querySelectorAll("#nav .chip").forEach(function (c) { c.classList.toggle("on", c.dataset.tab === t); });
    document.querySelectorAll("section[data-tab]").forEach(function (s) {
      s.hidden = s.dataset.tab !== t;
    });
    if (t === "hourly" && doc && (!G || changed)) renderGraph();
    if (t === "maps") renderMaps(); else mStop();
    requestAnimationFrame(equalize);
    if (changed) window.scrollTo(0, 0);
    if (t === "daily") { activeCard = -1; setTopH(); requestAnimationFrame(syncStrip); }
    try { localStorage.setItem("wx-tab", t); } catch (e) {}
  }
  $("nav").addEventListener("click", function (e) { var c = e.target.closest("[data-tab]"); if (c) showTab(c.dataset.tab); });
  $("days").addEventListener("click", function (e) {
    var c = e.target.closest(".chip"); if (!c) return;
    document.querySelectorAll("#days .chip").forEach(function (x) { x.classList.toggle("on", x === c); });
    scrollAll(+c.dataset.x * PX, true);
  });
  function idxFrom(e) { var sc = (e.target.closest && e.target.closest(".gsc")) || firstSc(), r = sc.getBoundingClientRect(); return Math.max(0, Math.min(G.n - 1, Math.floor((e.clientX - r.left + sc.scrollLeft - GL) / PX))); }
  function hideCur() { $("gin").querySelectorAll(".cursor").forEach(function (c) { c.hidden = true; }); $("gin").querySelectorAll(".gread").forEach(function (r) { r.hidden = true; }); }
  // Scrub: press and hold ~0.3 s on a graph, then slide left/right to read each hour in real time.
  // Lifting the finger clears everything and the graphs go back to the current time.
  var sc0 = null, scrubbing = false;
  function idxAt(sc, clientX) { var r = sc.getBoundingClientRect(); return Math.max(0, Math.min(G.n - 1, Math.floor((clientX - r.left + sc.scrollLeft - GL) / PX))); }
  function scrubStart(target, x, y) {
    if (!G) return; var sc = target.closest && target.closest(".gsc"); if (!sc) return;
    clearTimeout(sc0 && sc0.t);
    sc0 = { sc: sc, host: target.closest(".pan"), x0: x, y0: y, x: x, t: setTimeout(function () { scrubbing = true; firstSc().classList.add("scrub"); gin.addEventListener("touchmove", holdStill, { passive: false }); select(idxAt(sc0.sc, sc0.x), sc0.host, true); }, 300) };
  }
  function scrubMove(x, y, ev) {
    if (!sc0) return;
    sc0.x = x;
    if (scrubbing) {
      if (!scrubMove.q) { scrubMove.q = true; requestAnimationFrame(function () { scrubMove.q = false; if (!sc0 || !scrubbing) return; var i = idxAt(sc0.sc, sc0.x); if (i !== selIdx || sc0.host.querySelector(".gread").hidden) select(i, sc0.host, true); }); }
      return;
    }
    if (Math.hypot(x - sc0.x0, y - sc0.y0) > 8) { clearTimeout(sc0.t); sc0 = null; } // it's a swipe, let the graph scroll
  }
  function scrubEnd() {
    if (sc0) clearTimeout(sc0.t);
    firstSc().classList.remove("scrub"); gin.removeEventListener("touchmove", holdStill, { passive: false });
    if (scrubbing) { scrubbing = false; select(G ? G.nowI : 0, null, false); }
    sc0 = null;
  }
  var gin = $("gin");
  gin.addEventListener("touchstart", function (e) { if (e.touches.length === 1) scrubStart(e.target, e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  gin.addEventListener("touchmove", function (e) { if (e.touches.length === 1) scrubMove(e.touches[0].clientX, e.touches[0].clientY, e); }, { passive: true });
  // while holding to read values, stop the page from scrolling (a blocking listener only for that time)
  function holdStill(e) { if (e.cancelable) e.preventDefault(); }
  gin.addEventListener("touchend", scrubEnd); gin.addEventListener("touchcancel", scrubEnd);
  gin.addEventListener("mousedown", function (e) { scrubStart(e.target, e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { if (sc0) scrubMove(e.clientX, e.clientY, e); });
  window.addEventListener("mouseup", function () { if (sc0 || scrubbing) scrubEnd(); });
  gin.addEventListener("contextmenu", function (e) { if (e.target.closest(".gsc")) e.preventDefault(); });

  // Block the browser's own pull-to-refresh (iOS Safari ignores overscroll-behavior for it): a downward drag that
  //   starts with the page already at the top is cancelled. Sideways drags (graphs, maps) and scrollable panels are left alone.
  var pt0 = null;
  window.addEventListener("touchstart", function (e) { pt0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  function noPull(e) {
    if (!pt0 || e.touches.length !== 1 || window.scrollY > 0) return;
    var dx = e.touches[0].clientX - pt0.x, dy = e.touches[0].clientY - pt0.y;
    if (dy <= 0 || Math.abs(dy) < Math.abs(dx)) return;
    for (var el = e.target; el && el !== document.body; el = el.parentElement) if (el.scrollTop > 0) return; // an inner panel scrolling back up
    if (e.cancelable) e.preventDefault();
  }
  // A blocking (non-passive) touch listener makes every scroll wait on script, so it's only attached while the page
  //   sits at the very top, where a pull-to-refresh could start; everywhere else touch scrolling stays fully native.
  var noPullOn = false;
  function guardTop() {
    var want = window.scrollY <= 0;
    if (want === noPullOn) return; noPullOn = want;
    if (want) window.addEventListener("touchmove", noPull, { passive: false }); else window.removeEventListener("touchmove", noPull, { passive: false });
  }
  window.addEventListener("scroll", guardTop, { passive: true }); guardTop();

  document.addEventListener("visibilitychange", function () { if (!document.hidden && Date.now() - lastCheck > 5 * 60000) refresh(false); });
  setInterval(renderFresh, 30000);
  // phones fire resize whenever the address bar slides in/out while scrolling; only redraw the graphs when the width changes
  var rw, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastW) return; lastW = window.innerWidth;
    clearTimeout(rw); rw = setTimeout(function () { if (doc && tab === "hourly") renderGraph(); }, 200);
  });

  // ---------- forecast maps ----------
  // Public-domain NWS/NOAA map images. "Local" maps are the NWS forecast office's own sector (from the location's
  //   office code); the WPC/CPC maps are national. Each product is a list of frames stepped like a model viewer.
  var WPC = "https://www.wpc.ncep.noaa.gov/", CPC = "https://www.cpc.ncep.noaa.gov/products/predictions/";
  // Frame labels are real days/times in the location's time zone, worked out when shown (products
  //   roll forward on their own schedule). The exact valid time is still printed on each map.
  var D24 = 24 * H;
  function wd(ms) { return fmt(ms, { weekday: "short" }); }
  function dayKey(ms) { return fmt(ms, { year: "numeric", month: "numeric", day: "numeric" }); }
  function rel(ms) { var k = dayKey(ms); return k === dayKey(Date.now()) ? "Today" : k === dayKey(Date.now() + D24) ? "Tomorrow" : wd(ms); }
  function span(a, b) { return wd(a) + " " + hr(a) + "–" + (dayKey(a) === dayKey(b) ? "" : wd(b) + " ") + hr(b); }
  function md(ms) { return fmt(ms, { month: "short", day: "numeric" }); }
  function mdRange(a, b) { return md(a) + "–" + (fmt(a, { month: "short" }) === fmt(b, { month: "short" }) ? fmt(b, { day: "numeric" }) : md(b)); }
  // WPC day 1 starts at its latest 00Z/12Z cycle (allowing ~4 h for it to be issued); day N follows in 24-hour steps
  function wpcDay(d) { var c = Math.floor((Date.now() - 4 * H) / (12 * H)) * 12 * H + (d - 1) * D24; return span(c, c + D24); }
  // NDFD 6-hour periods end at 00/06/12/18Z; frame 1 is the period in progress
  function six(i) { var e = Math.ceil((Date.now() + 1) / (6 * H)) * 6 * H + (i - 1) * 6 * H; return span(e - 6 * H, e); }
  // CPC outlooks are issued each afternoon Eastern time and count days from the issue date
  function cpc(a, b) { var et = +new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()); var t = Date.now() - (et < 15 ? D24 : 0); return mdRange(t + a * D24, t + b * D24); }
  function highs(i) { return rel(Date.now() + (hourNum(Date.now()) >= 18 ? i : i - 1) * D24); }
  function lows(i) { var early = hourNum(Date.now()) < 7; if (early && i === 1) return "This morning"; var t = Date.now() + (early ? i - 2 : i - 1) * D24, r = rel(t); return r === "Today" ? "Tonight" : (r === "Tomorrow" ? wd(t) : r) + " night"; }
  // NDFD temperature images step every 3 hours for the first days (approximate, so marked ≈)
  function three(i) { var t = Math.ceil(Date.now() / (3 * H)) * 3 * H + (i - 1) * 3 * H; return "≈ " + wd(t) + " " + hr(t); }
  function lab(fr) { return typeof fr.l === "function" ? fr.l() : fr.l; }
  function ndfd(el, name, note, n, lb, src) {
    var f = []; for (var i = 1; i <= (n || 12); i++) f.push({ l: (lb || six).bind(null, i), u: el + i });
    return { id: "ndfd-" + el, name: name, area: true, el: el, frames: f, src: src || "NWS National Digital Forecast Database (official forecast, 6-hour amounts)", note: note,
      link: function (a) { return "https://graphical.weather.gov/sectors/" + a + ".php?element=" + el; } };
  }
  function days(name, pat, n0, n1, src, link, pre) {
    var f = []; for (var d = n0; d <= n1; d++) f.push({ l: wpcDay.bind(null, d), u: pat.replace("{d}", d) });
    return { id: pat, name: name, frames: f, src: src, link: link };
  }
  function grp(g, p) { p.g = g; return p; }
  var MCATS = [
    { id: "precip", name: "Precipitation", prods: [
      grp("Totals", { id: "wpc-qpf", name: "Precip totals, 1–7 days", src: "NWS Weather Prediction Center (liquid equivalent, rain + melted snow)", link: WPC + "qpf/qpf2.shtml",
        frames: [{ l: wpcDay.bind(null, 1), u: WPC + "qpf/fill_94qwbg.gif" }, { l: wpcDay.bind(null, 2), u: WPC + "qpf/fill_98qwbg.gif" }, { l: wpcDay.bind(null, 3), u: WPC + "qpf/fill_99qwbg.gif" },
          { l: "Next 2 days", u: WPC + "qpf/d12_fill.gif" }, { l: "Next 5 days", u: WPC + "qpf/p120i.gif" }, { l: "Next 7 days", u: WPC + "qpf/p168i.gif" }] }),
      grp("Totals", ndfd("QPF", "6-hr precip forecast", "Each frame is 6 hours of liquid precipitation; the valid time is printed on the map.")),
      grp("Snow", ndfd("SnowAmt", "6-hr snowfall forecast", "Each frame is 6 hours of snow; the valid time is printed on the map.")),
      grp("Snow", days("Chance of 4\"+ snow", WPC + "wwd/day{d}_psnow_gt_04_conus.gif", 1, 3, "NWS Weather Prediction Center (24-hour periods)", WPC + "wwd/winter_wx.shtml")),
      grp("Snow", days("Chance of 8\"+ snow", WPC + "wwd/day{d}_psnow_gt_08_conus.gif", 1, 3, "NWS Weather Prediction Center (24-hour periods)", WPC + "wwd/winter_wx.shtml")),
      grp("Snow", days("Chance of 12\"+ snow", WPC + "wwd/day{d}_psnow_gt_12_conus.gif", 1, 3, "NWS Weather Prediction Center (24-hour periods)", WPC + "wwd/winter_wx.shtml")),
      grp("Snow", days("Days 4–7 snow outlook", WPC + "wwd/pwpf_d47/gif/prbww_sn25_DAY{d}.gif", 4, 7, "NWS Weather Prediction Center: chance of 0.25\"+ liquid as snow/sleet", WPC + "wwd/pwpf_d47/pwpf_medr.php")),
      grp("Ice", ndfd("IceAccum", "6-hr ice forecast", "Each frame is 6 hours of freezing rain ice; the valid time is printed on the map.")),
      grp("Ice", days("Chance of 0.25\"+ ice", WPC + "wwd/day{d}_pice_gt_25_conus.gif", 1, 3, "NWS Weather Prediction Center (24-hour periods)", WPC + "wwd/winter_wx.shtml")),
      grp("Snow & ice", days("Snow & ice odds, days 1–3", WPC + "wwd/day{d}_composite_conus.gif", 1, 3, "NWS Weather Prediction Center: 4/8/12\" snow and 0.25\" ice chances", WPC + "wwd/winter_wx.shtml"))
    ] },
    { id: "temp", name: "Temperature", prods: [
      ndfd("MaxT", "Daytime highs", "The date is printed on the map.", 7, highs, "NWS National Digital Forecast Database (official forecast)"),
      ndfd("MinT", "Overnight lows", "The date is printed on the map.", 7, lows, "NWS National Digital Forecast Database (official forecast)"),
      ndfd("T", "Temperature by time", "Frames step forward in time; the valid time is printed on the map.", 24, three, "NWS National Digital Forecast Database (official forecast)"),
      ndfd("ApparentT", "Feels-like temperature", "Wind chill or heat index. Frames step forward in time; the valid time is printed on the map.", 24, three, "NWS National Digital Forecast Database (official forecast)"),
      { id: "cpc-t", name: "6–14 day outlook", src: "NOAA Climate Prediction Center: chance of above/below normal", link: "https://www.cpc.ncep.noaa.gov/",
        frames: [{ l: cpc.bind(null, 6, 10), u: CPC + "610day/610temp.new.gif" }, { l: cpc.bind(null, 8, 14), u: CPC + "814day/814temp.new.gif" }] }
    ] },
    { id: "outlook", name: "Outlooks", prods: [
      { id: "cpc-p", name: "6–14 day precip outlook", src: "NOAA Climate Prediction Center", link: "https://www.cpc.ncep.noaa.gov/",
        frames: [{ l: cpc.bind(null, 6, 10), u: CPC + "610day/610prcp.new.gif" }, { l: cpc.bind(null, 8, 14), u: CPC + "814day/814prcp.new.gif" }] },
      { id: "cpc-snow", name: "Week 2 heavy snow risk", src: "NOAA Climate Prediction Center", link: "https://www.cpc.ncep.noaa.gov/products/predictions/threats/threats.php",
        frames: [{ l: cpc.bind(null, 8, 14), u: CPC + "threats/snow_probhazards_d8_14_contours.png" }] }
    ] }
  ];
  var winterNow = [10, 11, 0, 1, 2, 3].indexOf(new Date().getMonth()) >= 0;
  var M = store("wx-map") || { cat: "precip", id: winterNow ? "ndfd-SnowAmt" : "wpc-qpf", area: "local" };
  if (M.cat === "winter") M.cat = "precip";
  M.f = 0; var mTimer = null, mPre = {};
  function mCat() { return MCATS.filter(function (c) { return c.id === M.cat; })[0] || MCATS[0]; }
  function mProd() { var c = mCat(); return c.prods.filter(function (p) { return p.id === M.id; })[0] || c.prods[0]; }
  function mOffice() { var o = doc && doc.loc && doc.loc.office; return o ? String(o).toLowerCase() : null; }
  function mSector(p) { return p.area && M.area === "local" && mOffice() ? mOffice() : "conus"; }
  function mUrl(p, fr) {
    var bust = "?t=" + Math.floor(Date.now() / 9e5); // new images every 15 min at most
    if (p.el) { var s = mSector(p); return "https://graphical.weather.gov/images/" + s + "/" + fr.u + "_" + s + ".png" + bust; }
    return fr.u + bust;
  }
  var PLAY = '<svg class="fill" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>', PAUSE = '<svg class="fill" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  function mStop() { clearInterval(mTimer); mTimer = null; if ($("mplay")) { $("mplay").innerHTML = PLAY; $("mplay").setAttribute("aria-label", "Play"); } }
  function mSave() { store("wx-map", { cat: M.cat, id: M.id, area: M.area }); }
  function renderMaps() {
    if (!$("maps")) return;
    if (!mTimer) $("mplay").innerHTML = PLAY;
    $("mtotloc").textContent = (doc && doc.loc && doc.loc.label) || "";
    var c = mCat(), p = mProd(); M.id = p.id;
    if (M.f >= p.frames.length) M.f = 0;
    $("mcats").innerHTML = MCATS.map(function (x) { return '<button type="button" class="chip' + (x.id === c.id ? " on" : "") + '" data-mcat="' + x.id + '">' + x.name + "</button>"; }).join("");
    // one dropdown of maps, grouped like Pivotal Weather's parameter menu
    var gs = []; c.prods.forEach(function (x) { var k = x.g || ""; if (!gs.length || gs[gs.length - 1].k !== k) gs.push({ k: k, l: [] }); gs[gs.length - 1].l.push(x); });
    var opt = function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === p.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; };
    $("msel").innerHTML = gs.map(function (gr) { return gr.k ? '<optgroup label="' + esc(gr.k) + '">' + gr.l.map(opt).join("") + "</optgroup>" : gr.l.map(opt).join(""); }).join("");
    var off = mOffice();
    $("marea").hidden = !p.area || !off;
    $("marea").innerHTML = p.area && off ? '<button type="button" data-marea="local" class="chip' + (M.area === "local" ? " on" : "") + '" title="NWS ' + off.toUpperCase() + ' forecast office area">Local</button>' +
      '<button type="button" data-marea="conus" class="chip' + (M.area !== "local" ? " on" : "") + '">US</button>' : "";
    $("mctl").hidden = p.frames.length < 2;
    $("mrange").max = p.frames.length - 1;
    var lk = typeof p.link === "function" ? p.link(mSector(p)) : p.link;
    var who = p.el ? "NWS official forecast" : /wpc\./.test(lk) ? "NWS Weather Prediction Center" : "NOAA Climate Prediction Center";
    $("msrc").title = p.src + (p.note ? ". " + p.note : "");
    $("msrc").innerHTML = esc(who) + ' · <a href="' + esc(lk) + '" target="_blank" rel="noopener">Source</a>';
    mShow();
  }
  function mShow() {
    var p = mProd(), fr = p.frames[M.f], img = $("mimg"), url = mUrl(p, fr);
    $("mrange").value = M.f;
    $("mfr").textContent = lab(fr);
    // warm the next and previous frames (all of them while playing) so stepping doesn't flash, without downloading
    //   every frame of every product up front
    (mTimer ? p.frames : [p.frames[M.f + 1], p.frames[M.f - 1]]).forEach(function (f2) { if (f2 && !mPre[mUrl(p, f2)]) { mPre[mUrl(p, f2)] = 1; new Image().src = mUrl(p, f2); } });
    img.alt = p.name + ", " + lab(fr);
    if (img.getAttribute("src") === url) return;
    $("mmsg").hidden = true; img.classList.add("ld");
    img.onload = function () { img.classList.remove("ld"); };
    img.onerror = function () { img.classList.remove("ld"); $("mmsg").hidden = false; $("mmsg").textContent = "This map isn't available right now. Try another time step or open the source."; };
    img.src = url;
  }
  function mStep(d) { var n = mProd().frames.length; M.f = (M.f + d + n) % n; mShow(); }
  $("maps").addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-mcat]"))) { mStop(); M.cat = b.dataset.mcat; M.id = null; M.f = 0; renderMaps(); mSave(); return; }
    if ((b = e.target.closest("[data-marea]"))) { M.area = b.dataset.marea; mSave(); renderMaps(); return; }
    if (e.target.closest("#mprev")) { mStop(); mStep(-1); return; }
    if (e.target.closest("#mnext")) { mStop(); mStep(1); return; }
    if (e.target.closest("#mplay")) {
      if (mTimer) { mStop(); mShow(); return; }
      $("mplay").innerHTML = PAUSE; $("mplay").setAttribute("aria-label", "Pause");
      mTimer = setInterval(function () { mStep(1); }, 900); mShow(); return;
    }
    if (e.target.closest("#mimgbox") && $("mmsg").hidden) { $("mfimg").src = $("mimg").src; $("mfimg").alt = $("mimg").alt; $("mfsc").classList.remove("z"); $("mfull").hidden = false; }
  });
  $("msel").addEventListener("change", function () { mStop(); M.id = this.value; M.f = 0; mSave(); renderMaps(); });
  $("mrange").addEventListener("input", function () { mStop(); M.f = +this.value; mShow(); });
  // full-screen viewer: tap zooms to 2.5x centred on where you tapped (local maps are centred on the forecast office)
  $("mfimg").addEventListener("click", function (e) {
    var sc = $("mfsc"), im = this, r = im.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    sc.classList.toggle("z");
    if (sc.classList.contains("z")) { sc.scrollLeft = fx * im.clientWidth - sc.clientWidth / 2; sc.scrollTop = fy * im.clientHeight - sc.clientHeight / 2; }
  });
  $("mfx").addEventListener("click", function () { $("mfull").hidden = true; });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("mfull").hidden) { $("mfull").hidden = true; return; }
    if (tab !== "maps" || !$("locsheet").hidden || /INPUT|TEXTAREA/.test((e.target.tagName || "")) && e.target.type !== "range") return;
    if (e.key === "ArrowLeft") { mStop(); mStep(-1); } else if (e.key === "ArrowRight") { mStop(); mStep(1); }
  });

  // ---------- location ----------
  // Location comes from the URL (?q=Duluth MN or ?lat=46.78&lon=-92.1), else the last one used on this device, else Minneapolis.
  var HOME = { lat: 44.9778, lon: -93.2650, label: "Minneapolis, MN" };
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  var loc = store("wx-loc") || HOME, recents = store("wx-recents") || [HOME], favs = store("wx-favs") || [];
  function curLoc() { return loc; }
  function saveCache(d) { store("wx-cache", d); }
  function same(a, b) { return a && b && Math.abs(a.lat - b.lat) < 0.02 && Math.abs(a.lon - b.lon) < 0.02; }
  function isFav(l) { return favs.some(function (f) { return same(f, l); }); }
  function toggleFav(l) {
    favs = isFav(l) ? favs.filter(function (f) { return !same(f, l); }) : favs.concat([{ lat: l.lat, lon: l.lon, label: l.label || null }]);
    store("wx-favs", favs); renderLs();
  }
  function setUrl() {
    try {
      var u = new URL(location.href);
      if (same(loc, HOME)) { u.searchParams.delete("lat"); u.searchParams.delete("lon"); u.searchParams.delete("q"); }
      else { u.searchParams.delete("q"); u.searchParams.set("lat", loc.lat); u.searchParams.set("lon", loc.lon); }
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (e) {}
  }
  function useLoc(l) {
    loc = { lat: +l.lat, lon: +l.lon, label: l.label || null };
    recents = [loc].concat(recents.filter(function (r) { return r && !same(r, loc); })).slice(0, 6);
    store("wx-loc", loc); store("wx-recents", recents); setUrl();
    $("plabel").textContent = loc.label || "Loading…";
    return refresh(false);
  }
  function lsOpen() { $("locsheet").hidden = false; renderLs(); setTimeout(function () { try { $("lsq").focus(); } catch (e) {} }, 50); }
  function lsClose() { $("locsheet").hidden = true; lsStatus(""); }
  function lsStatus(msg, err) { var e = $("lsstat"); e.hidden = !msg; e.textContent = msg || ""; e.classList.toggle("err", !!err); }
  var STAR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m12 3 2.6 5.85 6.4.62-4.85 4.3 1.4 6.28L12 16.9l-5.55 3.15 1.4-6.28-4.85-4.3 6.4-.62Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function renderLs() {
    var favWrap = $("lsfavwrap"), rows = [];
    function row(r) {
      var i = rows.push(r) - 1, f = isFav(r), name = esc(r.label || (r.lat + ", " + r.lon));
      return '<div class="ls-row"><button type="button" class="ls-go" data-r="' + i + '">' + name + (same(r, loc) ? "<small>Showing now</small>" : "") + "</button>" +
        (favWrap ? '<button type="button" class="ls-star' + (f ? " on" : "") + '" data-fav="' + i + '" aria-pressed="' + f + '" aria-label="' + (f ? "Remove " + name + " from favorites" : "Add " + name + " to favorites") + '">' + STAR + "</button>" : "") + "</div>";
    }
    var rec = recents.filter(function (r) { return r && !isFav(r); });
    if (!isFav(HOME) && !rec.some(function (r) { return same(r, HOME); })) rec.push(HOME);
    if (favWrap) { favWrap.hidden = !favs.length; $("lsfav").innerHTML = favs.map(row).join(""); }
    $("lsrec").innerHTML = rec.map(row).join("");
    if ($("lsreclbl")) $("lsreclbl").hidden = !rec.length;
    renderLs.rows = rows;
    if ($("lstest") && window.WXScenario) $("lstest").innerHTML = WXScenario.list.map(function (x) {
      return '<div class="ls-row"><button type="button" class="ls-go" data-test="' + x.id + '"><span>' + esc(x.name) + '<span class="d">' + esc(x.desc) + "</span></span>" + (TEST === x.id ? "<small>Showing now</small>" : "") + "</button></div>";
    }).join("");
    $("psub").textContent = (doc && doc.station && doc.station.id) || ""; $("psub").hidden = false;
  }
  function busyLs(on) { $("lsgo").disabled = on; if ($("lsgps")) $("lsgps").disabled = on; }
  function go(l) {
    if (TEST) setTest(null);
    busyLs(true); lsStatus("Loading " + (l.label || "location") + " from weather.gov…");
    useLoc(l).then(function (ok) { busyLs(false); if (ok) lsClose(); else lsStatus("Couldn't load that location from weather.gov. Try again.", true); });
  }
  function search(q) {
    busyLs(true); lsStatus("Finding " + q + "…");
    return WXLive.geocode(q).then(function (hit) {
      if (!hit) { lsStatus("No US location found for \"" + q + "\"", true); busyLs(false); return; }
      return WXLive.covers(hit.lat, hit.lon).then(function (ok) {
        if (!ok) { lsStatus("weather.gov has no forecast for " + hit.label, true); busyLs(false); return; }
        go(hit);
      });
    }).catch(function () { lsStatus("Location search failed. Check your connection and try again.", true); busyLs(false); });
  }
  // one-time lookup of the phone's position; it's then kept like any other location
  function gps() {
    if (!navigator.geolocation) { lsStatus("This browser can't share your location.", true); return; }
    busyLs(true); lsStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(function (p) {
      var lat = +p.coords.latitude.toFixed(4), lon = +p.coords.longitude.toFixed(4);
      WXLive.place(lat, lon).then(function (label) {
        if (label === false) { lsStatus("weather.gov has no forecast for your location.", true); busyLs(false); return; }
        go({ lat: lat, lon: lon, label: label || "Current location" });
      });
    }, function (err) {
      busyLs(false);
      lsStatus(err && err.code === 1 ? "Location access is blocked. Allow it for this site in your browser or phone settings, then try again." : "Couldn't get your location. Try again.", true);
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  }
  // ---------- test scenarios: built-in sample weather (wx-scenarios.js) so every tab can be checked in any season ----------
  var TEST = null;
  function setTest(id) {
    TEST = id && window.WXScenario && WXScenario.has(id) ? id : null;
    var sc = TEST && WXScenario.list.filter(function (x) { return x.id === TEST; })[0];
    $("testbar").hidden = !sc; $("testname").textContent = sc ? sc.name : "";
    try { var u = new URL(location.href); if (TEST) u.searchParams.set("test", TEST); else u.searchParams.delete("test"); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (e) {}
  }
  $("testx").addEventListener("click", function () {
    setTest(null); var c = store("wx-cache");
    if (c && c.loc && same(c.loc, loc)) accept(c);
    refresh(false);
  });
  $("placebtn").addEventListener("click", lsOpen);
  if ($("lsgps")) $("lsgps").addEventListener("click", gps);
  $("locsheet").addEventListener("click", function (e) {
    if (e.target.closest("[data-close]")) { lsClose(); return; }
    var s = e.target.closest("[data-fav]"); if (s) { toggleFav(renderLs.rows[+s.dataset.fav]); return; }
    var tb = e.target.closest("[data-test]");
    if (tb) { setTest(tb.dataset.test); lsClose(); (function go2() { if (busy) return setTimeout(go2, 300); refresh(false).then(function (ok) { if (ok) toast("Showing test scenario: " + $("testname").textContent); }); })(); return; }
    var b = e.target.closest("[data-r]"); if (!b) return;
    var r = renderLs.rows[+b.dataset.r];
    if (same(r, loc) && !TEST) { lsClose(); return; }
    go(r);
  });
  $("lsform").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("lsq").value.trim(); if (q.length >= 2) search(q);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("locsheet").hidden) lsClose(); });

  // ---------- boot ----------
  var startTab = "now";
  try { startTab = (location.hash || "").replace("#", "") || localStorage.getItem("wx-tab") || "now"; } catch (e) {}
  // paint the last data this device saw right away (if it's for the same place), then pull live
  var cached = store("wx-cache");
  var qs = new URLSearchParams(location.search), qLat = parseFloat(qs.get("lat")), qLon = parseFloat(qs.get("lon")), qQ = qs.get("q");
  if (isFinite(qLat) && isFinite(qLon)) {
    var known = [loc].concat(favs, recents).filter(function (r) { return r && r.label && same(r, { lat: qLat, lon: qLon }); })[0];
    loc = { lat: qLat, lon: qLon, label: qs.get("label") || (known && known.label) || null };
  }
  if (qs.get("test")) setTest(qs.get("test"));
  if (cached && cached.loc && same(cached.loc, loc) && !TEST) doc = cached;
  renderAll(); showTab(startTab);
  if (qQ) {
    WXLive.geocode(qQ).then(function (hit) { if (hit) useLoc(hit); else { toast("No US location found for \"" + qQ + "\""); useLoc(loc); } }).catch(function () { useLoc(loc); });
  } else useLoc(loc);
})();
