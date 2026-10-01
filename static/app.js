(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const nowS = () => Math.floor(Date.now() / 1000);

  // ---------------------------------------------------------------- icons (Lucide paths, as in the design)
  const P = (d) => ["path", { d }];
  const IC = {
    sun: [["circle", { cx: 12, cy: 12, r: 4 }], ...["M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"].map(P)],
    cloudSun: ["M12 2v2", "m4.93 4.93 1.41 1.41", "M20 12h2", "m19.07 4.93-1.41 1.41", "M15.947 12.65a4 4 0 0 0-5.925-4.128", "M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"].map(P),
    cloud: [P("M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z")],
    rain: ["M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242", "M16 14v6", "M8 14v6", "M12 16v6"].map(P),
    moon: [P("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")],
    home: [P("M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"), P("M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")],
    battery: [["rect", { x: 2, y: 7, width: 16, height: 10, rx: 2 }], P("M22 11v2"), P("M11 9.5 8.5 12h3L9 14.5")],
    grid: ["M12 2v20", "M2 5h20", "M3 3v2", "M7 3v2", "M17 3v2", "M21 3v2", "m19 5-7 7-7-7"].map(P),
    car: [P("M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"), ["circle", { cx: 7, cy: 17, r: 2 }], P("M9 17h6"), ["circle", { cx: 17, cy: 17, r: 2 }]],
    chart: ["M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9", "M13 17V5", "M8 17v-3"].map(P),
    layout: [["rect", { x: 3, y: 3, width: 7, height: 9, rx: 1 }], ["rect", { x: 14, y: 3, width: 7, height: 5, rx: 1 }], ["rect", { x: 14, y: 12, width: 7, height: 9, rx: 1 }], ["rect", { x: 3, y: 16, width: 7, height: 5, rx: 1 }]],
    settings: [P("M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"), ["circle", { cx: 12, cy: 12, r: 3 }]],
    check: [P("M20 6 9 17l-5-5")],
    storm: [P("M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"), P("m13 12-3 5h4l-3 5")],
    dollar: [["circle", { cx: 12, cy: 12, r: 10 }], P("M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"), P("M12 18V6")],
    chevL: [P("m15 18-6-6 6-6")],
    chevR: [P("m9 18 6-6-6-6")],
    download: [P("M12 15V3"), P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), P("m7 10 5 5 5-5")],
    pin: [P("M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"), ["circle", { cx: 12, cy: 10, r: 3 }]],
    pulse: [P("M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2")],
  };
  const icon = (name, size = 22) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:none">` +
    IC[name].map(([t, p]) => `<${t} ${Object.entries(p).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("") + `</svg>`;

  // ---------------------------------------------------------------- formatting (en-AU, 24 h)
  const kW = (w) => (w == null || isNaN(w) ? "—" : `${(Math.abs(w) / 1000).toFixed(1)} kW`);
  const kWnum = (w) => (w == null || isNaN(w) ? "—" : (Math.abs(w) / 1000).toFixed(1));
  const kWh = (v) => (v == null || isNaN(v) ? "—" : `${v.toFixed(1)} kWh`);
  const money = (v) => (v == null || isNaN(v) ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`);
  const pct = (v) => (v == null || isNaN(v) ? "—" : `${Math.round(v)}%`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const timeFmt = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hhmm = (ts) => timeFmt.format(new Date(ts * 1000));
  // The design uses three-letter months and no commas; en-AU writes "Sept" and adds commas.
  const tidy = (fmt) => ({ format: (d) => fmt.format(d).replace(/\bSept\b/, "Sep").replace(/,/g, "") });
  const midDay = tidy(new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long" }));
  const shortDay = tidy(new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" }));
  const dateLine = tidy(new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
  const monthShort = tidy(new Intl.DateTimeFormat("en-AU", { month: "short" }));
  const monthYear = tidy(new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric" }));
  const weekdayShort = new Intl.DateTimeFormat("en-AU", { weekday: "short" });
  const tz = (() => {
    try { return new Intl.DateTimeFormat("en-AU", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value; }
    catch (_) { return ""; }
  })();
  const dur = (secs) => { const m = Math.max(0, Math.round(secs / 60)), h = Math.floor(m / 60), r = m % 60; return h ? `${h} h ${r} min` : `${r} min`; };
  const midnight = (ts) => { const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
  const addDays = (ts, n) => { const d = new Date(ts * 1000); d.setDate(d.getDate() + n); return d.getTime() / 1000; };
  const sameDay = (a, b) => midnight(a) === midnight(b);
  const dateKey = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const ON = 50; // W: below this a flow counts as idle

  // ---------------------------------------------------------------- shared state
  const S = {
    status: null,
    forecast: undefined, // undefined = not loaded, null = unavailable
    hy: null, hyYear: null, hyPick: null, hySel: null, hyMetric: "gen", hyDay: null,
  };
  const sys = () => (S.status && S.status.system) || {};
  const snap = () => (S.status && S.status.snapshot) || null;
  const fresh = () => {
    const st = S.status;
    return !!(st && st.last_success && nowS() - st.last_success < (st.poll_interval || 60) * 3);
  };
  let toastT;
  const toast = (msg) => { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2400); };

  // ---------------------------------------------------------------- shared calculations
  function energyToday(p) {
    if (!p) return null;
    const pv = p.daily_pv, imp = p.daily_import, exp = p.daily_export;
    const chg = p.daily_charge || 0, dis = p.daily_discharge || 0;
    if (pv == null || imp == null || exp == null) return null;
    return { pv, imp, exp, chg, dis, home: Math.max(0, pv + imp - exp + dis - chg) };
  }

  // Today's costs come from the server, priced at the rate in force for each 5 minutes.
  let costsFetchedAt = 0, costsBusy = false;
  async function loadCostsToday(force = false) {
    if (costsBusy || (!force && S.costsToday && nowS() - costsFetchedAt < 50)) return;
    costsBusy = true;
    try {
      const r = await (await fetch(`/api/costs?start=${midnight(nowS())}`)).json();
      const today = dateKey(nowS());
      S.costsToday = r.days.find((d) => d.date === today) || null;
      costsFetchedAt = nowS();
      if (current === Overview) Overview.update();
    } catch (e) { console.error("costs", e); } finally { costsBusy = false; }
  }

  function fullInfo() {
    const p = snap(), s = sys(), f = S.forecast, now = nowS();
    const soc = p && p.battery_soc, bat = p && p.battery_power, cap = s.battery_kwh;
    if (bat != null && bat > ON && soc != null) {
      // Discharging: how long until the backup reserve at this rate, and when solar takes over again.
      const reserve = s.battery_reserve ?? 10, load = p.load_power;
      const secs = cap ? Math.max(0, (soc - reserve) / 100 * cap) / (bat / 1000) * 3600 : null;
      const cover = load > 0 ? Math.min(100, bat / load * 100) : null;
      const next = f && f.hours.find((h) => h.start > now && h.pv_kw > h.load_kw);
      const parts = [cover != null ? `Covering ${pct(cover)} of your home's use right now.` : "Powering your home right now."];
      if (next) parts.push(`Solar is forecast to start charging it again from about ${hhmm(next.ts)}.`);
      return {
        eyebrow: "Estimated time to reserve",
        headline: secs == null ? "—" : soc <= reserve + 0.5 ? "At reserve" : dur(secs),
        detail: (secs != null && soc > reserve + 0.5 ? `Reaches the ${pct(reserve)} backup reserve at about ${hhmm(now + secs)} ${tz} at this rate. ` : "") + parts.join(" "),
      };
    }
    if (soc != null && soc >= 99.5) return { eyebrow: "Battery status", headline: "Fully charged", detail: "Excess solar now goes to the grid." };
    if (f && f.summary.full_at && sameDay(f.summary.full_at, now)) {
      return { eyebrow: "Estimated time to full", headline: dur(f.summary.full_at - now), detail: `Full at about ${hhmm(f.summary.full_at)} ${tz}, based on forecast solar and home use.` };
    }
    if (f) {
      const endToday = addDays(midnight(now), 1);
      const sunLeft = f.hours.filter((h) => h.start < endToday && h.pv_kwh > 0.05);
      const detail = sunLeft.length ? `Forecast solar will bring the battery to ${pct(Math.max(...sunLeft.map((h) => h.soc)))} before sunset.`
        : f.summary.full_at ? `Forecast solar should fill it tomorrow at about ${hhmm(f.summary.full_at)} ${tz}.`
        : "Forecast solar will not fill the battery in the next day.";
      return { eyebrow: "Estimated time to full", headline: "Not today", detail };
    }
    if (bat != null && bat < -ON && cap && soc != null) {
      return { eyebrow: "Estimated time to full", headline: dur(((100 - soc) / 100 * cap) / (-bat / 1000) * 3600), detail: "At the current charge rate." };
    }
    return { eyebrow: "Estimated time to full", headline: "—", detail: " " };
  }

  function fcSummary() {
    const f = S.forecast, now = nowS(), p = snap();
    if (!f) return null;
    const fa = f.summary.full_at;
    const full = p && p.battery_soc >= 99.5 ? "Full now" : fa && fa < now + 86400 ? (sameDay(fa, now) ? hhmm(fa) : `Tomorrow ${hhmm(fa)}`) : "Not today";
    return [
      ["Forecast solar", kWh(f.summary.pv_kwh_24h)],
      ["Battery full at", full],
      ["Lowest battery overnight", pct(f.summary.min_soc_tonight)],
      ["Tomorrow morning", f.summary.tomorrow_morning],
    ];
  }

  // ---------------------------------------------------------------- header
  const NAV = [["overview", "Overview", "layout"], ["history", "History", "chart"], ["forecast", "Forecast", "cloudSun"], ["insights", "Insights", "pulse"], ["savings", "Savings", "dollar"], ["tesla", "Tesla", "car"]];
  let navShown = "", navKeyNow = "";
  // Tesla only gets a tab once it's connected; until then it's reached from its Overview card and Settings.
  function renderNav() {
    const items = NAV.filter(([k]) => k !== "tesla" || sys().tesla_connected), key = items.map((i) => i[0]).join();
    if (key === navShown) return;
    navShown = key;
    $("nav").classList.toggle("six", items.length > 5);
    $("nav").innerHTML = `<span class="nav-ind" id="nav-ind" aria-hidden="true"></span>` +
      items.map(([k, label, ic]) => `<a href="#/${k}" data-nav="${k}" title="${label}"${k === navKeyNow ? ' aria-current="page"' : ""}>${icon(ic, 16)}<span>${label}</span></a>`).join("");
    placeNavIndicator();
  }
  $("gear").innerHTML = icon("settings", 18);
  const fullDate = tidy(new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  const pillDate = tidy(new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" }));

  // The white pill slides under the current page's link.
  function placeNavIndicator() {
    const nav = $("nav"), ind = $("nav-ind"), cur = nav.querySelector("[aria-current]");
    if (!cur) { ind.style.opacity = "0"; return; }
    ind.style.left = `${cur.offsetLeft}px`; ind.style.width = `${cur.offsetWidth}px`; ind.style.opacity = "1";
    if (cur.offsetLeft < nav.scrollLeft || cur.offsetLeft + cur.offsetWidth > nav.scrollLeft + nav.clientWidth) cur.scrollIntoView({ block: "nearest", inline: "center" });
  }
  window.addEventListener("resize", placeNavIndicator);
  if (document.fonts) document.fonts.ready.then(placeNavIndicator);

  const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

  function renderHeader() {
    const st = S.status, now = nowS(), last = st && st.last_success;
    let state = "live", status = last ? `Live from your inverter, last reading ${hhmm(last)}` : "Connecting to your inverter";
    if (!last) state = st && st.error ? "error" : "stale";
    else if (!fresh()) { state = st.error ? "error" : "stale"; status = `No new readings since ${hhmm(last)}`; }
    $("live-dot").dataset.state = state;
    $("hp-date").textContent = pillDate.format(new Date());
    $("hp-clock").textContent = hhmm(now);
    $("hp-time").title = `${fullDate.format(new Date())}, ${hhmm(now)} ${tz}. ${status}.`;
    if (current === Overview) $("page-title").textContent = greeting();
    const err = $("error");
    if (st && st.error && !fresh()) { err.hidden = false; err.textContent = `Inverter not responding. Retrying automatically. (${st.error})`; }
    else err.hidden = true;
  }

  // ---------------------------------------------------------------- battery: last 6 hours
  let batHistAt = 0, batHistBusy = false;
  async function loadBatHist(force = false) {
    if (batHistBusy || (!force && S.batHist && nowS() - batHistAt < 55)) { renderBatHist(); return; }
    batHistBusy = true;
    const end = nowS() + 1, start = end - 6 * 3600;
    try {
      const r = await (await fetch(`/api/history?start=${start}&end=${end}&points=72&fields=battery_soc,battery_power`)).json();
      S.batHist = { start, end, ...r.series };
      batHistAt = nowS();
    } catch (e) { console.error("battery history", e); } finally { batHistBusy = false; }
    renderBatHist();
  }

  const batState = (w) => (w == null ? null : w < -ON ? "charge" : w > ON ? "discharge" : "idle");
  const B6W = 600, B6H = 150;
  const b6y = (soc) => B6H - 34 - Math.max(0, Math.min(100, soc)) / 100 * (B6H - 62);

  function renderBatHist() {
    const H = S.batHist, svg = $("b6-svg");
    if (!H || !svg) return;
    const pts = H.t.map((t, i) => ({ t, soc: H.battery_soc[i], w: H.battery_power[i] }));
    const X = (t) => (t - H.start) / (H.end - H.start) * B6W;
    $("b6-ticks").innerHTML = [6, 4, 2, 0].map((o) => `<span>${o ? hhmm(H.end - o * 3600) : "Now"}</span>`).join("");
    const have = pts.filter((p) => p.soc != null);
    if (!have.length) { svg.innerHTML = ""; $("b6-sum").textContent = "No readings yet"; S._b6 = null; return; }
    let area = "", lines = "", seg = [];
    const flush = () => {
      if (seg.length > 1) {
        area += `<path d="M${X(seg[0].t).toFixed(1)} ${B6H} ${seg.map((p) => `L${X(p.t).toFixed(1)} ${b6y(p.soc).toFixed(1)}`).join(" ")} L${X(seg[seg.length - 1].t).toFixed(1)} ${B6H} Z" fill="url(#b6fill)"/>`;
        // Blue while charging or idle, amber while discharging.
        for (let i = 1; i < seg.length; i++) {
          lines += `<line x1="${X(seg[i - 1].t).toFixed(1)}" y1="${b6y(seg[i - 1].soc).toFixed(1)}" x2="${X(seg[i].t).toFixed(1)}" y2="${b6y(seg[i].soc).toFixed(1)}" stroke="${batState(seg[i].w) === "discharge" ? "#ffb547" : "#6f8cff"}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
        }
      }
      seg = [];
    };
    for (const p of pts) { if (p.soc == null) flush(); else seg.push(p); }
    flush();
    const first = have[0], last = have[have.length - 1], reserve = sys().battery_reserve ?? 10, ry = b6y(reserve).toFixed(1);
    svg.innerHTML = `<defs><linearGradient id="b6fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f8cff" stop-opacity="0.32"/><stop offset="0.7" stop-color="#6f8cff" stop-opacity="0.06"/><stop offset="1" stop-color="#6f8cff" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="b6fadeX" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.35" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>` +
      `<mask id="b6mask"><rect x="0" y="0" width="${B6W}" height="${B6H}" fill="url(#b6fadeX)"/></mask></defs>` +
      `<g mask="url(#b6mask)">${area}${lines}<line x1="0" x2="${B6W}" y1="${ry}" y2="${ry}" stroke="rgba(255,255,255,0.1)" stroke-dasharray="3 5" vector-effect="non-scaling-stroke"/></g>`;
    let dot = $("b6-dot");
    if (!dot) { dot = Object.assign(document.createElement("span"), { id: "b6-dot", className: "b6-dot" }); $("b6").appendChild(dot); }
    dot.style.left = `${X(last.t) / B6W * 100}%`; dot.style.top = `${b6y(last.soc) / B6H * 100}%`;
    dot.style.background = batState(last.w) === "discharge" ? "#ffb547" : "#6f8cff";
    const cap = sys().battery_kwh, dk = cap ? (last.soc - first.soc) / 100 * cap : null;
    $("b6-sum").textContent = `${Math.round(first.soc)}% → ${Math.round(last.soc)}%` + (dk != null ? ` · ${dk >= 0 ? "+" : "−"}${Math.abs(dk).toFixed(1)} kWh` : "");
    S._b6 = { pts: have, X };
  }

  document.addEventListener("mousemove", (e) => {
    const plot = e.target.closest && e.target.closest("#b6"), tip = $("b6-tip"), line = $("b6-line");
    if (!tip) return;
    if (!plot || !S._b6) { tip.hidden = line.hidden = true; return; }
    const r = plot.getBoundingClientRect(), H = S.batHist, t = H.start + (e.clientX - r.left) / r.width * (H.end - H.start);
    let best = null;
    for (const p of S._b6.pts) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const lp = S._b6.X(best.t) / B6W * 100, st = batState(best.w);
    line.hidden = tip.hidden = false; line.style.left = `${lp}%`;
    tip.innerHTML = `<b>${hhmm(best.t)}</b> ${pct(best.soc)} · ${st === "charge" ? `Charging ${kW(best.w)}` : st === "discharge" ? `Discharging ${kW(best.w)}` : "Idle"}`;
    tip.style.left = lp > 60 ? "auto" : `calc(${lp}% + 8px)`; tip.style.right = lp > 60 ? `calc(${100 - lp}% + 8px)` : "auto";
  });

  // ---------------------------------------------------------------- mini power flow (every page except Overview)
  function renderDock() {
    const el = $("dock"), p = snap();
    el.hidden = current === Overview || !p;
    if (el.hidden) return;
    const pv = p.pv_power, g = p.grid_power, b = p.battery_power, l = p.load_power, soc = p.battery_soc ?? 0;
    const charging = b != null && b < -ON, discharging = b != null && b > ON;
    // A short track between two items; the dot travels in the direction power flows.
    const conn = (on, rev, color) => `<span class="dk-conn${on ? " on" : ""}${rev ? " rev" : ""}" style="--c:${color}" aria-hidden="true"></span>`;
    const item = (ic, icBg, k, v, cls = "") => `<span class="dk-item ${cls}"><span class="dk-ic" style="background:${icBg}">${ic}</span>` +
      `<span class="dk-txt"><span class="dk-k">${k}</span><span class="dk-v">${v}</span></span></span>`;
    const gridVerb = g == null ? "Grid" : g > ON ? "Importing" : g < -ON ? "Exporting" : "Grid idle";
    const batVerb = charging ? "Charging" : discharging ? "Discharging" : "Idle";
    el.innerHTML =
      item(icon("sun", 14), "#ff7a1a", "Solar", kW(pv)) +
      conn((pv || 0) > ON, false, "#ff7a1a") +
      item(icon("home", 14), "#ffffff;color:#111111", "Home", `${l != null && l < 0 ? "−" : ""}${kW(l)}`) +
      conn(g != null && Math.abs(g) > ON, g > 0, "#9a9aa3") +
      item(icon("grid", 14), "#3a3d44", gridVerb, kW(g)) +
      `<span class="dk-sep" aria-hidden="true"></span>` +
      `<span class="dk-item"><span class="dk-ic soc-ring" style="--deg:${(Math.max(0, Math.min(100, soc)) * 3.6).toFixed(1)}deg"><span>${icon("battery", 14)}</span></span>` +
      `<span class="dk-txt"><span class="dk-k">Battery ${Math.round(soc)}%</span><span class="dk-v" style="color:${charging ? "#8fa6ff" : discharging ? "#ffc777" : "rgba(255,255,255,0.75)"}">` +
      `${charging ? "↑ " : discharging ? "↓ " : ""}${charging || discharging ? kW(b) : "Idle"}</span></span></span>` +
      `<span class="dk-go" aria-hidden="true">›</span>`;
    el.setAttribute("aria-label", `Power flow now: solar ${kW(pv)}, home ${kW(l)}, ${gridVerb.toLowerCase()} ${kW(g)}, battery ${Math.round(soc)}% ${batVerb.toLowerCase()}. Open overview.`);
  }

  // ---------------------------------------------------------------- weather for the power flow drawing
  const RAIN_CODE = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82);

  // Sky and chip label from the forecast hour we're in now: sunny, cloudy, rain, storm, or night after dark.
  function liveWeather(p) {
    const now = nowS(), f = S.forecast;
    const h = f && (f.hours.find((x) => x.ts <= now && now < x.ts + 3600) || f.hours[0]);
    if (!h) return (p.pv_power || 0) > 100 ? { mode: "sunny", label: "Sunny" } : { mode: "night", label: "Night" };
    const c = h.code, t = h.temp != null ? ` · ${Math.round(h.temp)}°` : "";
    const name = c >= 95 ? "Thunderstorm" : c >= 80 ? "Showers" : c >= 61 ? "Rain" : c >= 51 ? "Drizzle" : c >= 45 ? "Fog"
      : c === 3 ? "Overcast" : c === 2 ? "Partly cloudy" : c === 1 ? "Mostly sunny" : "Sunny";
    const cover = c >= 95 ? "storm" : RAIN_CODE(c) ? "rain" : c >= 2 ? "cloudy" : "clear";
    if (!h.is_day) return { mode: "night", cover, label: (c <= 1 ? "Clear night" : c <= 3 ? "Cloudy night" : name) + t };
    return { mode: cover === "clear" ? "sunny" : cover, cover, label: name + t };
  }

  // ================================================================ OVERVIEW
  const sMoney = (v) => (v == null || isNaN(v) ? "—" : v < 0 ? `−${money(-v)}` : money(v));
  const Overview = {
    title: "Overview", sub: "Here is how your home is running right now",
    mount() {
      return `
      <div class="grid12">
        <section class="hero span12" aria-label="Power flow"><div class="house" id="house"></div><div class="hl-layer" id="hl-layer"></div></section>
        <section class="card span6 bat-card" id="bat-card" aria-labelledby="h-bat">
          <div class="card-head"><h2 id="h-bat">Battery</h2><span class="state-pill" id="bat-state">—</span></div>
          <div class="bat-row">
            <div class="ring" id="ring"></div>
            <div class="full">
              <div class="full-eyebrow" id="full-eyebrow">&nbsp;</div>
              <div class="full-headline" id="full-headline">—</div>
              <div class="full-detail" id="full-detail">&nbsp;</div>
            </div>
          </div>
          <div class="b6" id="b6">
            <svg class="b6-svg" id="b6-svg" viewBox="0 0 ${B6W} ${B6H}" preserveAspectRatio="none" aria-hidden="true"></svg>
            <div class="b6-head"><span>Last 6 hours</span><span id="b6-sum"></span></div>
            <div class="b6-ticks" id="b6-ticks"></div>
            <div class="b6-line" id="b6-line" hidden></div>
            <div class="b6-tip" id="b6-tip" hidden></div>
          </div>
        </section>
        <section class="card span6 today-card" aria-labelledby="h-today">
          <div class="card-head"><h2 id="h-today">Today so far</h2><a class="chip-btn" href="#/settings/tariffs" id="tariff-name">Rates</a></div>
          <div class="td-two">
            <div class="td-fig"><span class="td-k" id="t-cost-k">Cost today</span><span class="td-v" id="t-cost">—</span><span class="td-s" id="t-cost-sub">Including the daily supply charge</span></div>
            <div class="td-fig"><span class="td-k">Saved today</span><span class="td-v good" id="t-saved">—</span><span class="td-s" id="t-wo">&nbsp;</span></div>
          </div>
          <div class="td-split">
            <div class="td-splitbar"><div id="t-paid" style="width:0"></div><div class="rest"></div></div>
            <div class="td-splitlbl"><span><i></i><span id="t-pay"></span></span><span><span id="t-cover"></span><i class="g"></i></span></div>
          </div>
          <div class="td-table" id="t-table"></div>
        </section>
      </div>
      <div class="grid-auto">
        <section class="card" aria-labelledby="h-tesla">
          <div class="card-head"><h2 id="h-tesla">Tesla</h2><a class="link-btn" href="#/tesla/setup">Set up</a></div>
          <div class="col-start">
            <p class="body-copy">Connect your Tesla to send excess solar to the car while keeping enough for the home battery.</p>
            <a class="btn-primary" href="#/tesla/setup">Connect Tesla</a>
          </div>
        </section>
        <section class="card" aria-labelledby="h-next">
          <div class="card-head"><h2 id="h-next">Next 24 hours</h2><a class="link-btn" href="#/forecast">View forecast</a></div>
          <div class="n24-story" id="n24-story">Loading forecast</div>
          <div class="n24-body" id="n24-body">
            <div class="n24-wx" id="n24-wx"></div>
            <div class="n24-plot" id="n24-plot"></div>
            <div class="n24-ticks" id="n24-ticks"></div>
          </div>
          <div class="n24-legend">
            <span><i class="sw10 sw" style="background:rgba(255,181,71,0.5);border-radius:3px"></i>Solar</span>
            <span><i class="ln" style="border-top:1.5px solid #f5f5f5"></i>Home use</span>
            <span><i class="ln" style="border-top:2px solid #6f8cff"></i>Battery level</span>
          </div>
          <div class="n24-stats" id="n24-stats"></div>
        </section>
      </div>`;
    },
    update() {
      Overview.updateForecast();
      const p = snap(), s = sys();
      if (!p) return;
      // Power flow: live readings, drawn under the current weather.
      const wx = liveWeather(p);
      const L = { pv: (p.pv_power || 0) / 1000, grid: (p.grid_power || 0) / 1000, bat: -(p.battery_power || 0) / 1000, soc: (p.battery_soc || 0) / 100, tesla: 0, conn: false };
      const d = window.drawHouse(L, wx.mode, wx.cover), lb = d.labels, g = p.grid_power, b = p.battery_power, l = p.load_power;
      const dark = wx.mode === "night" || wx.mode === "storm";
      const wxIc = wx.mode === "night" ? { clear: "moon", cloudy: "cloud", rain: "rain", storm: "storm" }[wx.cover || "clear"]
        : { sunny: "sun", cloudy: "cloud", rain: "rain", storm: "storm" }[wx.mode];
      const gridVerb = g == null ? "Grid" : g > ON ? "Importing" : g < -ON ? "Exporting" : "Grid idle";
      const charging = b != null && b < -ON, discharging = b != null && b > ON;
      const batRate = charging ? `↑ ${kW(b)}` : discharging ? `↓ ${kW(b)}` : "0.0 kW";
      const batColor = charging ? "#8fa6ff" : discharging ? "#ffc777" : "rgba(255,255,255,0.6)";
      // Pills sit at the left or right edge, level with where their leader line starts.
      const pill = (side, pos, ic, icStyle, k, v, unit, extra = "", title = "") =>
        `<div class="hl ${side}" style="top:${pos.top}"${title ? ` title="${esc(title)}"` : ""}><div class="hl-ic" style="${icStyle}">${ic}</div>` +
        `<div class="hl-txt"><span class="hl-k">${k}</span><span class="hl-v">${v}<small>${unit}</small></span></div>${extra}</div>`;
      $("house").innerHTML = d.svg +
        `<div class="hero-head${dark ? " dark" : ""}"><div class="title-block"><h2>Power flow</h2><span class="scene-note">Live from your inverter · updated every minute</span></div>` +
        `<div class="wx-chip">${icon(wxIc, 16)}<span>${esc(wx.label)}</span></div></div>` +
        `<a class="car-btn" href="#/tesla/setup" style="--l:${d.car.left};--t:${d.car.top};--lm:${d.carMobile.left};--tm:${d.carMobile.top}">${icon("car", 24)}Connect Tesla</a>`;
      // Value pills: over the scene at its edges on wide screens, in a panel under it on phones.
      $("hl-layer").innerHTML =
        pill("right hl-solar", lb.solar, icon("sun", 18), "background:#ff7a1a", "Solar", kWnum(p.pv_power), "kW", "",
          p.pv2_power != null ? `Hybrid ${kW(p.pv1_power)} · ${(s.pv2 && s.pv2.model) || "Second inverter"} ${kW(p.pv2_power)}` : "") +
        pill("left hl-grid", lb.grid, icon("grid", 18), "background:#3a3d44", gridVerb, g == null ? "—" : kWnum(g), "kW") +
        pill("left hl-home", lb.home, icon("home", 18), "background:#ffffff;color:#111111", "Home", `${l != null && l < 0 ? "−" : ""}${kWnum(l)}`, "kW") +
        `<div class="hl right hl-bat" style="top:${lb.battery.top}"><div class="hl-ic soc-ring" style="--deg:${(L.soc * 360).toFixed(1)}deg"><div>${icon("battery", 18)}</div></div>` +
        `<div class="hl-txt"><span class="hl-k">Battery</span><span class="hl-v">${Math.round(p.battery_soc ?? 0)}<small>%</small></span></div>` +
        `<div class="hl-side"><span class="hl-k">${charging ? "Charging" : discharging ? "Discharging" : "Idle"}</span><b style="color:${batColor}">${batRate}</b></div></div>`;

      // Battery ring (the dark dot marks the backup reserve)
      const cap = s.battery_kwh || 0, soc = p.battery_soc, reserve = (s.battery_reserve ?? 10) / 100;
      const R0 = 82, C0 = 2 * Math.PI * R0, frac = Math.max(0, Math.min(1, (soc || 0) / 100));
      $("ring").innerHTML =
        `<svg viewBox="0 0 188 188" aria-hidden="true"><circle cx="94" cy="94" r="${R0}" fill="none" stroke="#26262a" stroke-width="10"/>` +
        `<circle class="ring-arc" cx="94" cy="94" r="${R0}" fill="none" stroke="${discharging ? "#ffb547" : "#6f8cff"}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C0 * frac).toFixed(1)} ${C0.toFixed(1)}" style="transition:stroke-dasharray 320ms ease"/>` +
        `<circle cx="${(94 + R0 * Math.cos(2 * Math.PI * reserve)).toFixed(1)}" cy="${(94 + R0 * Math.sin(2 * Math.PI * reserve)).toFixed(1)}" r="3" fill="#0a0a0a"/></svg>` +
        `<div class="ring-c"><div class="ring-num">${soc == null ? "—" : Math.round(soc)}<span>%</span></div><div class="ring-sub">${cap && soc != null ? `${(soc / 100 * cap).toFixed(1)} / ${cap} kWh` : ""}</div></div>`;
      $("ring").title = `Backup reserve ${pct(reserve * 100)}`;
      const pillEl = $("bat-state");
      pillEl.innerHTML = `<span class="arrow">${charging ? "↑" : discharging ? "↓" : "•"}</span>${charging ? `Charging at ${kW(b)}` : discharging ? `Discharging at ${kW(b)}` : "Idle"}`;
      pillEl.dataset.state = charging ? "charge" : discharging ? "discharge" : "idle";
      $("ring").classList.toggle("draining", discharging);
      $("bat-card").classList.toggle("discharging", discharging);
      const fi = fullInfo();
      $("full-eyebrow").textContent = fi.eyebrow; $("full-headline").textContent = fi.headline; $("full-detail").textContent = fi.detail;
      loadBatHist();

      // Today so far: cost and savings, split by rate
      loadCostsToday();
      const c = S.costsToday, t = s.tariff;
      if (!c || !t) return;
      const tou = t.type === "tou";
      $("tariff-name").textContent = tou ? "Time of use" : "Single rate";
      const wo = c.net_cost + c.saved; // what today would have cost without solar and the battery
      // In credit when feed-in is worth more than today's usage and supply charge.
      const credit = c.net_cost < 0;
      $("t-cost-k").textContent = credit ? "Credit today" : "Cost today";
      $("t-cost").textContent = money(Math.abs(c.net_cost));
      $("t-cost").classList.toggle("good", credit);
      $("t-cost-sub").textContent = credit ? "Feed-in credit covers your costs so far" : "Including the daily supply charge";
      $("t-saved").textContent = money(Math.max(0, c.saved));
      $("t-wo").textContent = `Without solar you'd pay ${money(wo)}`;
      $("t-paid").style.width = credit ? "0" : `${wo > 0 ? Math.max(2, Math.min(100, c.net_cost / wo * 100)).toFixed(1) : 2}%`;
      $("t-pay").textContent = credit ? `In credit ${money(-c.net_cost)}` : `You pay ${money(c.net_cost)}`;
      $("t-cover").textContent = `Solar and battery cover ${money(Math.max(0, c.saved))}`;
      const used = usedBands(t), nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const today = bandTable(t, [0, 6].includes(new Date().getDay()) ? "weekend" : "weekday").tab;
      const startsAt = (i) => { const m = today.findIndex((x, k) => k >= nowMin && x === i); return m < 0 ? null : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
      // savedKwh: the energy behind the saving (home use covered by solar or the battery, or kWh exported)
      const row = (dot, label, sub, kwh, cost, saved, savedOn = true, savedKwh = "") => `<div class="td-row"><span class="td-p"><i style="background:${dot}"></i><span><span>${esc(label)}</span><small>${esc(sub)}</small></span></span>` +
        `<span class="num dim">${kwh}</span><span class="num">${cost}</span><span class="num${savedOn ? " good" : " off"}">${saved}${savedKwh ? `<small>${savedKwh}</small>` : ""}</span></div>`;
      const bands = c.bands.map((b, i) => ({ ...b, i })).filter((b) => used.has(b.i) || b.import_kwh > 0 || b.home_kwh > 0).sort((x, y) => x.rate - y.rate);
      $("t-table").innerHTML = `<div class="td-row td-h"><span>Period</span><span>From grid</span><span>Cost</span><span>Saved</span></div>` +
        bands.map((b) => {
          const notYet = tou && b.home_kwh < 0.005 && !today.slice(0, nowMin).includes(b.i), at = notYet && startsAt(b.i);
          return notYet && at ? row(BAND_COLORS[b.i % BAND_COLORS.length], b.name, `Starts ${at} · ${c1(b.rate)} per kWh`, "", "–", "–", false)
            : row(tou ? BAND_COLORS[b.i % BAND_COLORS.length] : "#9a9aa3", tou ? b.name : "Single rate", `${c1(b.rate)} per kWh`, kWh(b.import_kwh), money(b.cost), money(Math.max(0, b.saved)), true, kWh(b.self_kwh));
        }).join("") +
        row("#3a3a40", "Supply charge", "Fixed daily charge", "", money(c.supply), "–", false) +
        row("#ffb547", "Solar credit", `Exported at ${c1(t.feed_in_rate)} per kWh`, "", `−${money(c.feed_in_credit)}`, money(c.feed_in_credit), true, kWh(c.export_kwh)) +
        `<div class="td-row td-total"><span>Today</span><span></span><span class="num">${sMoney(c.net_cost)}</span><span class="num good">${money(Math.max(0, c.saved))}</span></div>`;
    },
    // Next 24 hours: story, weather, solar / home use / battery chart, and totals.
    updateForecast() {
      const f = S.forecast, story = $("n24-story");
      if (!story) return;
      if (!f) { story.textContent = f === undefined ? "Loading forecast" : "Forecast unavailable. The server could not reach the Open-Meteo weather service, or the forecast is turned off."; $("n24-body").hidden = true; $("n24-stats").innerHTML = ""; return; }
      $("n24-body").hidden = false;
      const now = nowS(), end = now + 86400, p = snap(), s = sys(), t = s.tariff, reserve = s.battery_reserve ?? 10;
      const hrs = f.hours.filter((h) => h.start < end);
      if (!hrs.length) return;
      const W = 600, H = 170, X = (ts) => (Math.min(end, Math.max(now, ts)) - now) / 86400 * W;
      const mid = (h) => h.start + (h.ts + 3600 - h.start) / 2;
      const pv = [{ t: now, v: hrs[0].pv_kw }, ...hrs.map((h) => ({ t: mid(h), v: h.pv_kw })), { t: end, v: hrs[hrs.length - 1].pv_kw }];
      const load = [{ t: now, v: hrs[0].load_kw }, ...hrs.map((h) => ({ t: mid(h), v: h.load_kw })), { t: end, v: hrs[hrs.length - 1].load_kw }];
      const socPts = [{ t: now, v: p && p.battery_soc != null ? p.battery_soc : hrs[0].soc }, ...hrs.map((h) => ({ t: Math.min(end, h.ts + 3600), v: h.soc }))];
      const mx = Math.max(1, ...pv.map((x) => x.v), ...load.map((x) => x.v)) * 1.1;
      const Y = (v) => (H - 6 - v / mx * (H - 30)).toFixed(1), YS = (v) => (H - 6 - v / 100 * (H - 30)).toFixed(1);
      const path = (arr, fy) => arr.map((x, k) => `${k ? "L" : "M"}${X(x.t).toFixed(1)} ${fy(x.v)}`).join(" ");
      let night = "", n0 = null;
      hrs.forEach((h, k) => { const dark = !h.is_day; if (dark && n0 === null) n0 = h.start; if ((!dark || k === hrs.length - 1) && n0 !== null) { const x1 = dark ? end : h.start; night += `<rect x="${X(n0).toFixed(1)}" y="0" width="${(X(x1) - X(n0)).toFixed(1)}" height="${H}" fill="url(#n24night)"/>`; n0 = null; } });
      const fullAt = f.summary.full_at && f.summary.full_at < end ? f.summary.full_at : null;
      const resH = hrs.find((h) => h.soc <= reserve + 0.5 && (!fullAt || h.start > fullAt));
      const resAt = resH ? Math.min(end, resH.ts + 3600) : null;
      const marks = [fullAt && { t: fullAt, soc: 100, label: `Full ${hhmm(fullAt)}`, color: "#6f8cff" }, resAt && { t: resAt, soc: resH.soc, label: `Reserve ${hhmm(resAt)}`, color: "#8a8a90" }].filter(Boolean);
      $("n24-plot").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
        `<defs><linearGradient id="n24pv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb547" stop-opacity="0.5"/><stop offset="1" stop-color="#ffb547" stop-opacity="0.04"/></linearGradient>` +
        `<linearGradient id="n24night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f8cff" stop-opacity="0.07"/><stop offset="1" stop-color="#6f8cff" stop-opacity="0"/></linearGradient></defs>` +
        night + `<path d="${path(pv, Y)} L${W} ${H - 6} L0 ${H - 6} Z" fill="url(#n24pv)"/>` +
        `<path d="${path(pv, Y)}" fill="none" stroke="#ffb547" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` +
        `<path d="${path(load, Y)}" fill="none" stroke="#f5f5f5" stroke-opacity="0.7" stroke-width="1.25" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` +
        `<path d="${path(socPts, YS)}" fill="none" stroke="#6f8cff" stroke-width="2.25" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<line x1="0" x2="${W}" y1="${H - 6}" y2="${H - 6}" stroke="rgba(255,255,255,0.08)" vector-effect="non-scaling-stroke"/></svg>` +
        marks.map((m) => `<span class="n24-dot" style="left:${(X(m.t) / W * 100).toFixed(1)}%;top:${(YS(m.soc) / H * 100).toFixed(1)}%;background:${m.color}"></span>` +
          `<span class="n24-mark" style="left:${(X(m.t) / W * 100).toFixed(1)}%;top:${(YS(m.soc) / H * 100).toFixed(1)}%;border-color:${m.color}"><i style="background:${m.color}"></i>${m.label}</span>`).join("");
      $("n24-ticks").innerHTML = [0, 6, 12, 18, 24].map((o) => `<span style="left:${o / 24 * 100}%">${o ? hhmm(now + o * 3600) : "Now"}</span>`).join("");
      $("n24-wx").innerHTML = Array.from({ length: 8 }, (_, k) => {
        const at = now + k * 3 * 3600, h = f.hours.find((x) => x.ts <= at && at < x.ts + 3600) || hrs[Math.min(hrs.length - 1, k * 3)], ic = wxIcon(h);
        return `<div title="${hhmm(at)}"><span style="color:${ic === "sun" ? "#ffb547" : ic === "rain" ? "#9fb2ff" : "#9a9a9a"}">${icon(ic, 18)}</span><span>${h.temp != null ? Math.round(h.temp) + "°" : "–"}</span></div>`;
      }).join("");
      // Story
      const sunDrop = hrs.find((h, k) => k > 0 && h.is_day && new Date(h.ts * 1000).getHours() >= 13 && h.pv_kw < h.load_kw);
      const tm = f.summary.tomorrow_morning || "";
      const tomorrow = /^Showers /.test(tm) ? ` Showers are expected ${tm.slice(8)} tomorrow.` : tm && tm !== "No forecast" ? ` Tomorrow morning looks ${tm.toLowerCase()}.` : "";
      story.textContent = (p && p.battery_soc >= 99.5 ? "Your battery is full." : fullAt ? `Your battery should be full by ${hhmm(fullAt)}.` : "Your battery won't quite fill in the next 24 hours.") +
        (sunDrop ? ` Solar drops below home use around ${hhmm(sunDrop.ts)}` : "") +
        (sunDrop ? (resAt ? `, and the battery reaches its reserve at about ${hhmm(resAt)}.` : ", and the battery should last the night.") : resAt ? ` The battery reaches its reserve at about ${hhmm(resAt)}.` : "") + tomorrow;
      // Totals for the next 24 hours
      const kwhOf = (h, v) => v * (h.ts + 3600 - h.start) / 3600;
      const use = hrs.reduce((a, h) => a + kwhOf(h, h.load_kw), 0), imp = hrs.reduce((a, h) => a + Math.max(0, h.grid_kwh), 0);
      const cost = t ? hrs.reduce((a, h) => a + Math.max(0, h.grid_kwh) * bandAt(t, h.start).rate - Math.max(0, -h.grid_kwh) * t.feed_in_rate, 0) + t.supply_charge : null;
      $("n24-stats").innerHTML = [["Solar forecast", `${Math.round(f.summary.pv_kwh_24h)} kWh`, "#ffb547"], ["Expected use", `${Math.round(use)} kWh`, "#f5f5f5"],
        ["From the grid", kWh(imp), "#f5f5f5"], ["Expected cost", sMoney(cost), cost != null && cost < 0 ? "#3ee08f" : "#f5f5f5"]]
        .map(([l, v, fg]) => `<div><span>${l}</span><span style="color:${fg}">${v}</span></div>`).join("");
    },
  };

  // ================================================================ HISTORY
  // A year of days as a heatmap (pick what to colour by), with one day in detail underneath.
  const HY_METRICS = {
    gen: ["Solar", (d) => d.gen, (v) => `${v.toFixed(1)} kWh`, "#ffb547"],
    ss: ["Self-sufficiency", (d) => d.ss, (v) => `${Math.round(v * 100)}%`, "#3ee08f"],
    imp: ["Grid import", (d) => d.imp, (v) => `${v.toFixed(1)} kWh`, "#9aa4ff"],
    saved: ["Saved", (d) => d.saved, (v) => money(v), "#f5f5f5"],
  };
  const hyMix = (color, v) => `color-mix(in oklch, ${color} ${Math.round(12 + v * 88)}%, #1b1b1d)`;
  const longDate = tidy(new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric" }));
  const shortDate = tidy(new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }));
  const weekdayLong = new Intl.DateTimeFormat("en-AU", { weekday: "long" });
  let hyAt = 0, hyReq = 0;

  // A calendar year, January to December. Days after today are left empty.
  async function loadYear(force = false) {
    const year = S.hyYear ?? new Date().getFullYear();
    if (!force && S.hy && S.hy.year === year && nowS() - hyAt < 600) { History.render(); return; }
    const start = new Date(year, 0, 1).getTime() / 1000, end = new Date(year + 1, 0, 1).getTime() / 1000, today = midnight(nowS());
    try {
      const [rows, costs] = await Promise.all([
        fetch(`/api/daily?start=${start}&end=${end}`).then((r) => r.json()),
        fetch(`/api/costs?start=${start}&end=${end}`).then((r) => r.json()),
      ]);
      if ((S.hyYear ?? new Date().getFullYear()) !== year) return; // switched year while loading
      const byDate = Object.fromEntries(rows.map((r) => [r.date, r])), saved = Object.fromEntries(costs.days.map((d) => [d.date, d.saved]));
      const days = Array.from({ length: Math.round((end - start) / 86400) }, (_, i) => {
        const ts = addDays(start, i), key = dateKey(ts), r = byDate[key];
        if (ts > today) return { i, ts, key, future: true };
        if (!r || r.daily_pv == null || r.daily_import == null || r.daily_export == null) return { i, ts, key, none: true };
        const gen = r.daily_pv, imp = r.daily_import, exp = r.daily_export;
        const home = Math.max(0, gen + imp - exp + (r.daily_discharge || 0) - (r.daily_charge || 0));
        return { i, ts, key, gen, imp, exp, home, ss: home > 0 ? Math.max(0, Math.min(1, (home - imp) / home)) : 0, saved: saved[key] || 0, partial: ts === today };
      });
      const last = days.filter((d) => !d.future).length - 1; // today, or 31 December for past years
      S.hy = { year, start, days, last };
      if (S.hyPick === "first") S.hySel = 0;
      else if (S.hyPick === "last" || S.hySel == null || S.hySel > last) S.hySel = last;
      S.hyPick = null;
      hyAt = nowS();
    } catch (e) { console.error("history year", e); }
    if (current === History) History.render();
  }

  async function loadHyDay() {
    const d = S.hy && S.hy.days[S.hySel];
    if (!d) return;
    const req = ++hyReq, end = addDays(d.ts, 1);
    try {
      // 5-minute averages (288 a day).
      const r = await (await fetch(`/api/history?start=${d.ts}&end=${end}&points=288&fields=pv_power,load_power,battery_soc`)).json();
      if (req !== hyReq) return;
      S.hyDay = { ts: d.ts, end, ...r.series };
    } catch (e) { console.error("history day", e); }
    if (current === History) History.renderDay();
  }

  const History = {
    title: "History", sub: "Solar generation, home use, and grid activity over time",
    mount() {
      return `<div class="hy">
        <div class="hy-top"><div class="hy-year"><button class="round-btn" id="hy-yprev" aria-label="Previous year">${icon("chevL", 18)}</button><span class="hy-range" id="hy-range">&nbsp;</span><button class="round-btn" id="hy-ynext" aria-label="Next year">${icon("chevR", 18)}</button></div><div class="hy-metrics" id="hy-metrics" role="tablist"></div></div>
        <div class="hy-totals" id="hy-totals"></div>
        <div class="hy-heat">
          <div class="hy-scroll"><div class="hy-grid-wrap">
            <div class="hy-months" id="hy-months"></div>
            <div class="hy-body">
              <div class="hy-wd"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div>
              <div class="hy-cells" id="hy-cells"></div>
            </div>
          </div></div>
          <div class="hy-mgrid" id="hy-mgrid"></div>
          <div class="hy-foot"><span id="hy-note"></span><div class="hy-scale" id="hy-scale"></div></div>
        </div>
        <section class="hy-day" aria-labelledby="hy-date">
          <div class="hy-day-side">
            <div class="hy-day-top"><div class="hy-chip" id="hy-chip" hidden></div>
              <div class="hy-arrows"><button class="round-btn" id="hy-prev" aria-label="Previous day">${icon("chevL", 18)}</button><button class="round-btn" id="hy-next" aria-label="Next day">${icon("chevR", 18)}</button></div></div>
            <div class="hy-when"><span id="hy-weekday"></span><span class="hy-date" id="hy-date"></span></div>
            <div class="hy-stats" id="hy-stats"></div>
            <a class="hy-csv" id="hy-csv" href="#" download>${icon("download", 16)}Download this day as CSV</a>
          </div>
          <div class="hy-day-chart">
            <div class="hy-legend"><span><i style="background:#ffb547"></i>Solar</span><span><i style="background:#f5f5f5"></i>Home use</span><span><i style="background:#3ee08f"></i>Battery level</span></div>
            <div class="hy-plot" id="hy-plot"><div class="hover-line" id="hy-line" hidden></div><div class="tooltip" id="hy-tip" hidden></div></div>
            <div class="hy-x" id="hy-x"></div>
          </div>
        </section>
      </div>`;
    },
    bind() {
      $("hy-metrics").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) { S.hyMetric = b.dataset.m; History.render(); } });
      const pick = (e) => {
        const b = e.target.closest("[data-i]");
        if (!b) return;
        History.select(+b.dataset.i);
        // On phones the day's detail sits below the calendar: bring it into view.
        if (e.currentTarget.id === "hy-mgrid") document.querySelector(".hy-day").scrollIntoView({ behavior: "smooth", block: "start" });
      };
      $("hy-cells").addEventListener("click", pick);
      $("hy-mgrid").addEventListener("click", pick);
      $("hy-yprev").addEventListener("click", () => History.setYear(S.hy.year - 1, "last"));
      $("hy-ynext").addEventListener("click", () => History.setYear(S.hy.year + 1, "first"));
      $("hy-prev").addEventListener("click", () => History.select(S.hySel - 1));
      $("hy-next").addEventListener("click", () => History.select(S.hySel + 1));
      $("hy-plot").addEventListener("mousemove", History.hover);
      $("hy-plot").addEventListener("mouseleave", () => { $("hy-tip").hidden = $("hy-line").hidden = true; });
      loadYear();
    },
    update() {
      // Keep today's numbers moving: refresh the year every 10 minutes, and today's curve every poll.
      if (nowS() - hyAt >= 600) loadYear(true);
      else if (S.hy && S.hy.year === new Date().getFullYear() && S.hySel === S.hy.last) loadHyDay();
    },
    // Stepping past either end of the year moves into the next or previous year.
    select(i) {
      if (!S.hy) return;
      if (i < 0) return History.setYear(S.hy.year - 1, "last");
      if (i >= S.hy.days.length) return History.setYear(S.hy.year + 1, "first");
      S.hySel = Math.min(i, S.hy.last);
      History.render();
    },
    setYear(year, pick) {
      if (year > new Date().getFullYear()) return;
      S.hyYear = year; S.hyPick = pick;
      loadYear(true);
    },
    render() {
      const Y = S.hy;
      if (!Y || !$("hy-cells")) return;
      const mk = S.hyMetric || "gen", [mLabel, val, fmt, color] = HY_METRICS[mk], days = Y.days, have = days.filter((d) => !d.none && !d.future);
      const thisYear = Y.year === new Date().getFullYear();
      $("hy-range").textContent = thisYear ? `${Y.year} so far` : String(Y.year);
      $("hy-ynext").disabled = thisYear;
      $("hy-metrics").innerHTML = Object.entries(HY_METRICS).map(([k, [label, , , c]]) => `<button role="tab" data-m="${k}" aria-selected="${k === mk}"><i style="background:${c}"></i>${label}</button>`).join("");
      const sum = (k) => have.reduce((a, d) => a + d[k], 0), home = sum("home"), imp = sum("imp");
      $("hy-totals").innerHTML = [["Solar generated", Math.round(sum("gen")).toLocaleString("en-AU"), "kWh"], ["Self-sufficiency", home > 0 ? String(Math.round((home - imp) / home * 100)) : "—", "%"],
        ["Exported to grid", Math.round(sum("exp")).toLocaleString("en-AU"), "kWh"], ["Saved", `$${Math.round(sum("saved")).toLocaleString("en-AU")}`, "AUD"]]
        .map(([l, v, u]) => `<div><span>${l}</span><span>${v}<small>${u}</small></span></div>`).join("");
      // Colour by where each day sits between the year's lowest and highest (whole days only).
      const vals = have.filter((d) => !d.partial).map(val), lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
      const norm = (d) => Math.max(0, Math.min(1, (val(d) - lo) / (hi - lo || 1)));
      const lead = (new Date(Y.start * 1000).getDay() + 6) % 7;
      const cell = (d) => {
        if (d.future) return `<span class="hy-c future"></span>`;
        const dt = new Date(d.ts * 1000), label = `${dt.getDate()} ${monthShort.format(dt)}`;
        return d.none ? `<button class="hy-c none${d.i === S.hySel ? " sel" : ""}" data-i="${d.i}" title="${label}: no readings" aria-label="${label}: no readings"></button>`
          : `<button class="hy-c${d.i === S.hySel ? " sel" : ""}" data-i="${d.i}" style="background:${hyMix(color, norm(d))}" title="${label}${d.partial ? " so far" : ""}: ${fmt(val(d))}" aria-label="${label}${d.partial ? " so far" : ""}: ${fmt(val(d))}"></button>`;
      };
      const nWeeks = Math.ceil((lead + days.length) / 7);
      $("hy-cells").style.gridTemplateColumns = `repeat(${nWeeks}, minmax(0, 1fr))`;
      $("hy-cells").innerHTML = Array.from({ length: lead }, () => `<span class="hy-c pad"></span>`).join("") + days.map(cell).join("");
      // Phones: the same days flipped on their side, a row per week (Monday to Sunday across),
      // January at the top, with the month named where each month starts.
      const weeks = [];
      days.forEach((d) => { const w = Math.floor((d.i + lead) / 7); (weeks[w] = weeks[w] || Array(7).fill(null))[(d.i + lead) % 7] = d; });
      let prevMonth = null;
      $("hy-mgrid").innerHTML = `<span></span>${["M", "T", "W", "T", "F", "S", "S"].map((w) => `<span class="wd">${w}</span>`).join("")}` +
        weeks.map((wk) => {
          const latest = new Date(wk.filter(Boolean).pop().ts * 1000), month = monthShort.format(latest), fresh = month !== prevMonth;
          prevMonth = month;
          return `<span class="mo${fresh ? " start" : ""}">${fresh ? month : ""}</span>` +
            wk.map((d) => (d ? cell(d).replace('class="hy-c', `class="hy-c${fresh ? " start" : ""}`) : `<span class="hy-c pad${fresh ? " start" : ""}"></span>`)).join("");
        }).join("");
      const months = [];
      days.forEach((d) => { const dt = new Date(d.ts * 1000); if (dt.getDate() === 1 || d.i === 0) { const col = Math.floor((d.i + lead) / 7); if (col <= nWeeks - 3 && (!months.length || col - months[months.length - 1].col > 2)) months.push({ col, label: monthShort.format(dt) }); } });
      $("hy-months").innerHTML = months.map((m) => `<span style="left:${(m.col / nWeeks * 100).toFixed(2)}%">${m.label}</span>`).join("");
      $("hy-note").textContent = have.length ? `${mLabel} per day · select a day to see it hour by hour` : `No days recorded in ${Y.year}. Days fill in as your system records data.`;
      $("hy-scale").innerHTML = `Less ${[0, 0.25, 0.5, 0.75, 1].map((v) => `<i style="background:${hyMix(color, v)}"></i>`).join("")} More`;
      History.renderDaySide();
      if (!S.hyDay || S.hyDay.ts !== days[S.hySel].ts) loadHyDay(); else History.renderDay();
    },
    renderDaySide() {
      const d = S.hy.days[S.hySel], dt = new Date(d.ts * 1000);
      $("hy-weekday").textContent = (d.partial ? "Today so far · " : "") + weekdayLong.format(dt);
      $("hy-date").textContent = longDate.format(dt);
      $("hy-next").disabled = S.hy.year === new Date().getFullYear() && S.hySel === S.hy.last;
      const chip = $("hy-chip"), p = snap();
      chip.hidden = !(d.partial && p);
      if (d.partial && p) { const wx = liveWeather(p), ic = wx.mode === "night" ? "moon" : { sunny: "sun", cloudy: "cloud", rain: "rain", storm: "storm" }[wx.mode]; chip.innerHTML = `${icon(ic, 16)}${esc(wx.label)}`; }
      const st = (label, v, unit, c) => `<div><span><i style="background:${c}"></i>${label}</span><span>${v}<small>${unit}</small></span></div>`;
      $("hy-stats").innerHTML = d.none ? `<div class="hy-none">No readings were recorded on this day.</div>`
        : st("Solar generated", d.gen.toFixed(1), "kWh", "#ffb547") + st("Home use", d.home.toFixed(1), "kWh", "#f5f5f5") +
          st("Self-sufficiency", String(Math.round(d.ss * 100)), "%", "#3ee08f") + st("Saved", money(d.saved), "", "#9aa4ff");
      $("hy-csv").href = `/api/export.csv?start=${d.ts}&end=${addDays(d.ts, 1)}`;
    },
    renderDay() {
      const D = S.hyDay, plot = $("hy-plot");
      if (!D || !plot) return;
      const W = 1000, H = 240, span = D.end - D.ts;
      const rows = D.t.map((t, i) => ({ t, pv: D.pv_power[i], load: D.load_power[i], soc: D.battery_soc[i] }));
      const mx = Math.max(1000, ...rows.flatMap((r) => [r.pv, r.load]).filter((v) => v != null)) * 1.1;
      const X = (t) => ((t - D.ts) / span * W).toFixed(1), Yk = (v) => (H - Math.max(0, v) / mx * (H - 10)).toFixed(1), Ys = (v) => (H - v / 100 * (H - 10)).toFixed(1);
      const segs = (k) => { const out = []; let cur = []; for (const r of rows) { if (r[k] == null) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(r); } if (cur.length > 1) out.push(cur); return out; };
      const line = (pts, k, fy) => pts.map((r, i) => `${i ? "L" : "M"}${X(r.t)} ${fy(r[k])}`).join(" ");
      const S0 = `fill="none" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"`;
      let svg = `<defs><linearGradient id="hyPv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb547" stop-opacity="0.35"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></linearGradient></defs>`;
      for (const sg of segs("pv")) svg += `<path d="${line(sg, "pv", Yk)} L${X(sg[sg.length - 1].t)} ${H} L${X(sg[0].t)} ${H} Z" fill="url(#hyPv)"/><path d="${line(sg, "pv", Yk)}" ${S0} stroke="#ffb547" stroke-width="2"/>`;
      for (const sg of segs("load")) svg += `<path d="${line(sg, "load", Yk)}" ${S0} stroke="#f5f5f5" stroke-width="1.5"/>`;
      for (const sg of segs("soc")) svg += `<path d="${line(sg, "soc", Ys)}" ${S0} stroke="#3ee08f" stroke-width="1.5" stroke-dasharray="5 5"/>`;
      plot.querySelectorAll(".hy-gl, svg, .empty-note").forEach((n) => n.remove());
      plot.insertAdjacentHTML("afterbegin", ["0%", "33%", "66%", "100%"].map((g) => `<div class="hy-gl" style="top:${g}"></div>`).join("") +
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>` +
        (rows.some((r) => r.pv != null) ? "" : `<div class="empty-note">No readings were recorded on this day.</div>`));
      $("hy-x").innerHTML = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span style="left:${h / 24 * 100}%">${String(h).padStart(2, "0")}:00</span>`).join("");
      S._hy = { rows: rows.filter((r) => r.pv != null), ts: D.ts, span };
    },
    hover(e) {
      const D = S._hy, tip = $("hy-tip"), hl = $("hy-line");
      if (!D || !D.rows.length) return;
      const r = e.currentTarget.getBoundingClientRect(), t = D.ts + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * D.span;
      let best = null;
      for (const x of D.rows) if (!best || Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
      if (!best || Math.abs(best.t - t) > 1800) { tip.hidden = hl.hidden = true; return; }
      const lp = (best.t - D.ts) / D.span * 100;
      hl.hidden = tip.hidden = false; hl.style.left = `${lp}%`;
      tip.innerHTML = `<div class="tt-head"><span>${hhmm(best.t)}</span></div>` +
        [["Solar", kW(best.pv), "#ffb547"], ["Home", `${best.load < 0 ? "−" : ""}${kW(best.load)}`, "#f5f5f5"], ["Battery", pct(best.soc), "#3ee08f"]]
          .map(([l, v, c]) => `<div class="tt-row"><span><i class="sw" style="background:${c}"></i>${l}</span><span>${v}</span></div>`).join("");
      tip.style.left = lp > 70 ? `calc(${lp}% - 212px)` : `calc(${lp}% + 12px)`;
    },
  };

  // The forecast location's place name, or its coordinates until one has been looked up.
  const locationLabel = () => { const s = sys(); return s.location_name || (s.latitude != null ? `${Number(s.latitude).toFixed(2)}, ${Number(s.longitude).toFixed(2)}` : "your location"); };

  // ================================================================ FORECAST
  const RAIN = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
  const wxIcon = (h) => { if (RAIN(h.code)) return "rain"; if (!h.is_day) return h.code >= 3 ? "cloud" : "moon"; return h.code <= 1 ? "sun" : h.code === 2 ? "cloudSun" : "cloud"; };

  const Forecast = {
    title: "Forecast", sub: "Solar and battery forecast for the next 24 hours, based on the local weather outlook",
    mount() {
      return `<div class="fc-where"><span class="fc-pin">${icon("pin", 16)}</span><span>Outlook for <b id="fc-place"></b></span><a class="link-btn" href="#/settings/integrations">Change</a></div>
      <div class="fc-cards" id="fc-cards"></div>
      <section class="card" aria-labelledby="h-hbh">
        <div class="title-block"><h2 id="h-hbh">Hour by hour</h2><div class="sub">Forecast solar per hour and predicted battery level at the end of each hour</div></div>
        <div class="fc-scroll"><div class="fc-hours" id="fc-hours"></div></div>
        <div class="fc-legend">
          <span><i class="sw sw10" style="background:var(--digital-rust-400)"></i>Forecast solar (kWh)</span>
          <span><i class="sw sw10" style="background:var(--color-text-brand)"></i>Predicted battery level</span>
        </div>
      </section>
      <div class="foot" id="fc-foot"></div>`;
    },
    update() {
      $("fc-place").textContent = locationLabel();
      const f = S.forecast;
      if (f === undefined) return;
      const fs = fcSummary();
      $("fc-cards").innerHTML = fs ? fs.map(([l, v]) => `<div class="fc-card"><div class="lbl">${l}</div><div class="val">${esc(v)}</div></div>`).join("") : "";
      if (!f) { $("fc-hours").innerHTML = `<div class="fc-empty">Forecast unavailable. The server could not reach the Open-Meteo weather service, or the forecast is turned off.</div>`; return; }
      const hrs = f.hours.slice(0, 24), full = Math.max(f.calibration.kwh_per_kwh_m2, ...hrs.map((h) => h.pv_kwh), 0.1);
      $("fc-hours").innerHTML = hrs.map((h, i) => {
        const hr = new Date(h.ts * 1000).getHours(), ic = wxIcon(h);
        return `<div class="fc-hour${hr === 0 && i ? " midnight" : ""}"><div class="h">${i === 0 ? "Now" : `${String(hr).padStart(2, "0")}:00`}</div>` +
          `<div class="ic${ic === "sun" ? " sun" : ""}">${icon(ic, 20)}</div><div class="temp">${h.temp != null ? Math.round(h.temp) + "°" : "–"}</div>` +
          `<div class="track"><div style="height:${Math.min(100, h.pv_kwh / full * 100)}%"></div></div>` +
          `<div class="pv">${h.pv_kwh >= 0.05 ? h.pv_kwh.toFixed(1) : "–"}</div><div class="soc">${pct(h.soc)}</div></div>`;
      }).join("");
      $("fc-foot").textContent = f.calibration.fitted_hours >= 0.5
        ? `Solar forecast calibrated on ${f.calibration.fitted_hours} hours of your inverter's output.`
        : "Solar forecast not yet calibrated to your system. It needs a few daylight hours of data.";
    },
  };

  // ================================================================ INSIGHTS
  const monthLong = new Intl.DateTimeFormat("en-AU", { month: "long" });
  const ymd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d || 1); };
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  const heatShade = (v) => `rgba(245,245,245,${(0.04 + 0.84 * v).toFixed(2)})`;
  // "8, 17, and 24 September" / "30 August and 2 September"
  const listDays = (dates) => {
    const groups = [];
    for (const d of dates.map(ymd)) {
      const g = groups[groups.length - 1], m = monthLong.format(d);
      if (g && g.m === m) g.days.push(d.getDate()); else groups.push({ m, days: [d.getDate()] });
    }
    const join = (xs) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);
    return join(groups.map((g) => `${join(g.days)} ${g.m}`));
  };
  let insAt = 0, insBusy = false;
  async function loadInsights() {
    if (insBusy || (S.insights && nowS() - insAt < 300)) return;
    insBusy = true;
    try {
      const r = await fetch("/api/insights");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      S.insights = await r.json(); insAt = nowS();
    }
    catch (e) { console.error("insights", e); if (S.insights === undefined) S.insights = null; }
    finally { insBusy = false; }
    if (current === Insights) Insights.render();
  }

  const Insights = {
    title: "Insights", sub: "How well your system is performing, and where the grid still fills the gaps",
    mount() {
      return `<div class="ins-kpis" id="ins-kpis"></div>
      <div class="ins-two">
        <section class="card" aria-labelledby="h-ssm">
          <div class="title-block"><h2 id="h-ssm">Self-sufficiency by month</h2><div class="ins-sub">Share of home use covered by solar and the battery</div></div>
          <div class="ins-months" id="ins-months"></div>
          <div class="ins-mx" id="ins-mx"></div>
        </section>
        <section class="card" aria-labelledby="h-bhl">
          <div class="title-block"><h2 id="h-bhl">Battery health</h2><div class="ins-sub">Reported by your battery, with charge and discharge figures from your inverter</div></div>
          <div class="ins-health"><div class="ins-big" id="ins-soh">—</div><div class="ins-sub" id="ins-soh-note"></div></div>
          <div class="ins-track"><div id="ins-soh-bar" style="width:0"></div><i style="left:70%"></i></div>
          <div class="ins-track-lbl"><span>Warranty threshold 70%</span><span>100% when new</span></div>
          <div id="ins-bat"></div>
        </section>
      </div>
      <section class="card" aria-labelledby="h-hm">
        <div class="title-block"><h2 id="h-hm">When you use grid power</h2><div class="ins-sub">Average grid import by hour and month, last 12 months. Darker cells mean more energy from the grid.</div></div>
        <div class="hm-scroll"><div class="hm" id="ins-heat"></div></div>
        <div class="hm-foot"><div class="ins-sub" id="ins-heat-note"></div><div class="hm-scale" id="ins-heat-scale"></div></div>
      </section>
      <section class="card" aria-labelledby="h-sp">
        <div class="sp-head">
          <div class="title-block"><h2 id="h-sp">Solar performance</h2><div class="ins-sub">Actual output compared with expected output for the weather, last 30 days</div></div>
          <div class="sp-avg"><span class="ins-k">30-day average</span><span class="ins-v" id="sp-avg">—</span></div>
        </div>
        <div class="sp-plot" id="sp-plot"></div>
        <div class="sp-x" id="sp-x"></div>
        <div class="sp-note wait" id="sp-note"><i></i><span></span></div>
        <div class="foot" id="sp-foot"></div>
      </section>`;
    },
    update() {
      if (S.insights === undefined || nowS() - insAt >= 300) loadInsights();
      Insights.render();
    },
    render() {
      const I = S.insights;
      if (!$("ins-kpis")) return;
      if (!I) {
        $("ins-kpis").innerHTML = `<div class="ins-empty">${I === null ? "Insights could not be loaded. Try again shortly." : "Loading insights"}</div>`;
        return;
      }
      const L = I.lifetime, s = sys(), cap = L.battery_kwh || s.battery_kwh, n30 = I.last30.days;

      // ---- headline figures
      const ss = I.last30.self_pct, prev = I.prev30.self_pct;
      const ssNote = prev != null && I.prev30.days >= 7
        ? (Math.round(ss) === Math.round(prev) ? "Same as the 30 days before"
          : ((d) => `${ss > prev ? "Up" : "Down"} ${d} point${d === 1 ? "" : "s"} on the 30 days before`)(Math.abs(Math.round(ss) - Math.round(prev))))
        : n30 && n30 < 30 ? `From ${n30} day${n30 === 1 ? "" : "s"} of readings so far` : "Share of home use from solar and the battery";
      const used = I.last30.pv_home_pct;
      const cpd = cap && n30 ? I.last30.dis / cap / n30 : null;
      const kpis = [
        ["Self-sufficiency · 30 days", pct(ss), n30 ? ssNote : "No readings yet"],
        ["Solar used at home · 30 days", pct(used), used == null ? "No solar recorded yet" : Math.round(used) >= 100 ? "None was exported to the grid" : `The other ${100 - Math.round(used)}% was exported to the grid`],
        ["Battery cycles", L.cycles == null ? "—" : L.cycles.toLocaleString("en-AU"),
          cpd != null ? `About ${cpd.toFixed(1)} full cycles a day over the last ${n30 === 1 ? "day" : `${n30} days`}` : "Full charge-discharge cycles since the battery was installed"],
        ["CO₂ avoided · lifetime", L.co2_t == null ? "—" : `${L.co2_t.toLocaleString("en-AU")} t`,
          L.pv_kwh ? `From ${(L.pv_kwh / 1000).toFixed(1)} MWh of solar, at the average Australian grid emissions factor` : "Based on the average Australian grid emissions factor"],
      ];
      $("ins-kpis").innerHTML = kpis.map(([k, v, note]) => `<div class="ins-kpi"><div class="ins-k">${k}</div><div class="ins-v">${v}</div><div class="ins-sub">${note}</div></div>`).join("");

      // ---- self-sufficiency by month
      const last = I.months.length - 1;
      $("ins-months").innerHTML = I.months.map((m, k) => {
        const d = ymd(m.month), v = m.self_pct;
        const title = v == null ? `${monthYear.format(d)}: no readings` : `${monthYear.format(d)}: ${pct(v)} self-sufficient over ${m.days} day${m.days === 1 ? "" : "s"} of readings`;
        return `<div class="ins-month${k === last ? " cur" : ""}" title="${title}"><span>${v == null ? "" : pct(v)}</span><i style="height:${v == null ? 0 : (v * 0.86).toFixed(1)}%"></i></div>`;
      }).join("");
      $("ins-mx").innerHTML = I.months.map((m) => `<span>${monthShort.format(ymd(m.month))}</span>`).join("");

      // ---- battery health
      const soh = L.soh;
      $("ins-soh").textContent = pct(soh);
      $("ins-soh-note").textContent = soh != null && cap ? `about ${(cap * soh / 100).toFixed(1)} of ${cap} kWh usable` : "Not reported by your battery yet";
      $("ins-soh-bar").style.width = `${soh ?? 0}%`;
      const B = I.battery, wait = "Needs a full day of readings";
      const rows = [
        ["Average daily depth of discharge", B.avg_swing != null ? pct(B.avg_swing) : null],
        ["Round-trip efficiency", L.round_trip_pct != null ? pct(L.round_trip_pct) : null],
        ["Time at full charge", B.avg_full_min != null ? `${dur(B.avg_full_min * 60)} a day` : null],
        ["Energy delivered since install", L.discharge_kwh != null ? `${Math.round(L.discharge_kwh).toLocaleString("en-AU")} kWh` : null],
      ];
      $("ins-bat").innerHTML = rows.map(([l, v]) => `<div class="ins-row"><span>${l}</span>${v == null ? `<span class="off">${wait}</span>` : `<span>${v}</span>`}</div>`).join("");

      // ---- grid use by hour and month
      const cells = I.months.flatMap((m) => m.heat || []).filter(Boolean);
      // Scale to the busiest cell, but never below 0.2 kWh so a near-zero month doesn't read as heavy use.
      const hmax = Math.max(0.2, ...cells.map((c) => c.kwh));
      let best = null;
      $("ins-heat").innerHTML = I.months.map((m) => {
        const mon = monthShort.format(ymd(m.month));
        return `<div class="hm-row"><span>${mon}</span>` + Array.from({ length: 24 }, (_, h) => {
          const c = m.heat && m.heat[h];
          if (!c) return `<div class="none" title="${mon} ${hh(h)}: no readings"></div>`;
          if (!best || c.kwh > best.c.kwh) best = { c, h, m };
          return `<div style="background:${heatShade(c.kwh / hmax)}" title="${mon} ${hh(h)}: ${c.kwh.toFixed(2)} kWh average"></div>`;
        }).join("") + `</div>`;
      }).join("") + `<div class="hm-row hm-x"><span></span>${Array.from({ length: 24 }, (_, h) => `<span>${h % 3 ? "" : String(h).padStart(2, "0")}</span>`).join("")}</div>`;
      $("ins-heat-scale").innerHTML = `<i class="none"></i>No data<span class="gap"></span>Less ${[0, 0.25, 0.5, 0.75, 1].map((v) => `<i style="background:${heatShade(v)}"></i>`).join("")} More`;
      let heatNote;
      if (!best) heatNote = "No readings yet. This fills in as your system records data.";
      else if (best.c.kwh < 0.1) heatNote = "You have used almost no grid power in the hours recorded so far.";
      else {
        const reserve = s.battery_reserve ?? 10, when = `Most grid power is used around ${hh(best.h)} in ${monthLong.format(ymd(best.m.month))}`;
        heatNote = best.c.soc != null && best.c.soc <= reserve + 5 ? `${when}, after the battery runs down to its ${pct(reserve)} reserve. Keeping more charge for the evening would reduce this.`
          : best.h >= 9 && best.h < 16 ? `${when}, when solar is not covering home use.`
          : `${when}, while the battery still has charge. Running several large appliances at once can draw more than the battery's ${s.battery_max_kw || 5} kW output.`;
      }
      $("ins-heat-note").textContent = heatNote;

      // ---- solar performance
      const P = I.performance, days = (P && P.days) || [];
      const rated = days.filter((d) => d.ratio != null);
      $("sp-plot").innerHTML = `<div class="sp-ref"><span>100% of expected</span></div>` + days.map((d) => {
        const label = shortDay.format(ymd(d.date));
        if (d.ratio == null) return `<div style="height:0" title="${label}: not enough readings"></div>`;
        const low = d.clear && d.ratio < 0.9;
        return `<div class="${low ? "low" : ""}" style="height:${(Math.max(0.04, Math.min(1, (d.ratio - 0.7) / 0.4)) * 100).toFixed(1)}%" title="${label}: ${pct(d.ratio * 100)} of expected (${kWh(d.actual_kwh)} of ${kWh(d.expected_kwh)})${d.clear ? "" : ", cloudy"}"></div>`;
      }).join("");
      const dl = (d) => { const x = ymd(d.date); return `${x.getDate()} ${monthShort.format(x)}`; };
      $("sp-x").innerHTML = days.length ? [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]].map((d) => `<span>${dl(d)}</span>`).join("") : "";
      $("sp-plot").hidden = $("sp-x").hidden = !rated.length;
      $("sp-avg").textContent = rated.length ? pct(rated.reduce((a, d) => a + d.ratio, 0) / rated.length * 100) : "—";
      const lows = rated.filter((d) => d.clear && d.ratio < 0.9).map((d) => d.date);
      let cls, note;
      if (!P) { cls = "wait"; note = "Past weather is unavailable right now, so solar output can't be compared with what the weather allowed. The server could not reach Open-Meteo."; }
      else if (P.fitted_hours < 24 || !rated.length) { cls = "wait"; note = "Learning what your panels should produce for the weather. This needs a few days of daylight readings."; }
      else if (lows.length) {
        cls = "";
        const when = lows.length <= 4 ? `on ${listDays(lows)}, ${lows.length === 1 ? "a clear day" : "all clear days"}` : `on ${lows.length} clear days in the last 30, most recently ${listDays(lows.slice(-1))}`;
        note = `Output was more than 10% below expected ${when}. Dust, bird droppings, or new shading are common causes. Check your panels if this continues.`;
      }
      else { cls = "ok"; note = "Output has been within 10% of expected on every clear day with readings."; }
      $("sp-note").className = `sp-note ${cls}`;
      $("sp-note").querySelector("span").textContent = note;
      $("sp-foot").textContent = P && P.fitted_hours >= 24
        ? `Expected output is learned from ${P.fitted_hours.toLocaleString("en-AU")} daylight hours of your inverter's output against past weather from Open-Meteo, so 100% is how your system usually performs.` : "";
    },
  };

  // ================================================================ SAVINGS
  const EV_KWH = 16.5, PETROL_L = 8, PETROL_PRICE = 1.95; // per 100 km
  const c1 = (v) => `${+(v * 100).toFixed(1)}c`;
  const dollars = (v) => (v == null || isNaN(v) ? "—" : `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-AU")}`);
  const kwhInt = (v) => `${Math.round(v).toLocaleString("en-AU")} kWh`;
  const dayMonth = (ts) => { const d = new Date(ts * 1000); return `${d.getDate()} ${monthShort.format(d)}`; };
  const monthYearLong = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" });
  // Rates that apply at some time of the week (a rate left with no hours isn't worth listing).
  function liveBands(t) {
    if (t.type !== "tou") return [{ name: "All times", rate: t.flat_rate }];
    const used = new Set([...bandTable(t, "weekday").tab, ...bandTable(t, "weekend").tab]);
    return t.bands.filter((_, i) => used.has(i));
  }
  const tariffDetail = (t) => `${t.type === "tou" ? liveBands(t).map((b) => `${c1(b.rate)} ${b.name.toLowerCase()}`).join(" · ") : `${c1(t.flat_rate)} per kWh`}` +
    ` · ${c1(t.feed_in_rate)} feed-in · ${money(t.supply_charge)} a day`;

  let savAt = 0, savBusy = false;
  async function loadSavings(force = false) {
    if (savBusy || (!force && S.savings && nowS() - savAt < 300)) return;
    savBusy = true;
    try {
      const r = await fetch("/api/savings");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      S.savings = await r.json(); savAt = nowS();
    } catch (e) { console.error("savings", e); if (S.savings === undefined) S.savings = null; }
    finally { savBusy = false; }
    if (current === Savings) { Savings.render(); Savings.autoCompare(); }
  }

  const Savings = {
    title: "Savings", sub: "Your bill, system payback, and cheaper ways to power the home and car",
    mount() {
      return `<div class="ins-two">
        <section class="card" aria-labelledby="h-bill">
          <div class="sv-fig"><span class="ins-k" id="h-bill">Estimated bill</span><div class="ins-big" id="sv-bill">—</div><div class="ins-sub" id="sv-bill-note">Loading</div></div>
          <div class="sv-fig"><div class="sv-track"><div id="sv-bill-bar" style="width:0"></div></div><div class="ins-track-lbl"><span id="sv-day"></span><span id="sv-basis"></span></div></div>
          <div id="sv-bill-rows"></div>
        </section>
        <section class="card" aria-labelledby="h-pay" id="sv-pay">
          <div class="sv-fig"><span class="ins-k" id="h-pay">System payback</span><div class="ins-big" id="sv-paid">—</div><div class="ins-sub" id="sv-paid-note"></div></div>
          <div class="ins-track"><div class="green" id="sv-paid-bar" style="width:0"></div></div>
          <form class="sv-cost" id="sv-cost-form" hidden novalidate>
            <label class="field"><span class="field-l">What your solar and battery system cost</span><span class="input"><span class="pre">$</span><input id="sv-cost" inputmode="decimal" autocomplete="off" placeholder="18,400"></span></label>
            <div class="actions"><button class="btn-outline" type="button" data-act="cost-cancel" id="sv-cost-cancel">Cancel</button><button class="btn-primary" type="submit" style="padding:10px 18px;font-size:14px">Save</button></div>
            <span class="field-help bad" id="sv-cost-err"></span>
          </form>
          <div id="sv-pay-rows"></div>
        </section>
      </div>
      <section class="card" aria-labelledby="h-cmp">
        <div class="title-block"><h2 id="h-cmp">Compare electricity plans</h2><div class="ins-sub">Estimated yearly cost of each plan using your own solar, battery, and grid data</div></div>
        <form class="sv-cmp-form" id="sv-cmp-form" novalidate>
          <label class="field"><span class="field-l">Postcode</span><span class="input"><input id="sv-pc" inputmode="numeric" autocomplete="postal-code" maxlength="4" value="${esc(store.get("wmp-postcode"))}"></span></label>
          <label class="field"><span class="field-l">Retailer</span><select id="sv-brand" class="select"><option value="">Loading retailers…</option></select></label>
          <button class="btn-primary" id="sv-cmp-go" type="submit" style="padding:12px 20px;font-size:14px">Compare plans</button>
        </form>
        <div id="sv-plans"></div>
        <div class="ins-sub" id="sv-plan-note"></div>
        <div class="foot" id="sv-plan-foot"></div>
      </section>
      <section class="card" aria-labelledby="h-ev">
        <div class="title-block"><h2 id="h-ev">Cost to drive 100 km</h2><div class="ins-sub">Tesla Model Y Long Range, about ${EV_KWH} kWh per 100 km including charging losses</div></div>
        <div class="sv-ev" id="sv-ev"></div>
        <div class="sv-tesla"><span class="ins-sub">Connect Tesla to see how far you've driven, how much of the charging came from solar, and what you saved compared with petrol.</span><a class="btn-outline" href="#/tesla/setup">Connect Tesla</a></div>
      </section>`;
    },
    async bind() {
      $("sv-pay").addEventListener("click", (e) => {
        const a = e.target.closest("[data-act]");
        if (!a) return;
        const form = $("sv-cost-form");
        if (a.dataset.act === "edit-cost") {
          form.hidden = false; $("sv-cost-err").textContent = "";
          const c = sys().system_cost; $("sv-cost").value = c ? Math.round(c).toLocaleString("en-AU") : "";
          $("sv-cost").focus();
        }
        if (a.dataset.act === "cost-cancel") form.hidden = true;
      });
      $("sv-cost-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const v = Number($("sv-cost").value.replace(/[$,\s]/g, ""));
        if (!$("sv-cost").value.trim() || !isFinite(v) || v <= 0 || v > 1e6) { $("sv-cost-err").textContent = "Enter the cost in dollars, for example 18400."; return; }
        const res = await saveSettings({ system_cost: Math.round(v) });
        if (!res.ok) { $("sv-cost-err").textContent = res.error; return; }
        $("sv-cost-form").hidden = true; toast("System cost saved.");
        await loadSavings(true);
      });
      $("sv-cmp-form").addEventListener("submit", (e) => { e.preventDefault(); Savings.compare(); });
      try {
        S.brands = S.brands || await (await fetch("/api/plans/brands")).json();
        const saved = store.get("wmp-brand") || ((sys().tariff || {}).source || {}).brand_id || "";
        if ($("sv-brand")) $("sv-brand").innerHTML = `<option value="">Select a retailer</option>` +
          S.brands.map((b) => `<option value="${esc(b.id)}"${b.id === saved ? " selected" : ""}>${esc(b.name)}</option>`).join("");
      } catch (_) { if ($("sv-brand")) $("sv-brand").innerHTML = `<option value="">Retailers unavailable</option>`; }
      Savings.autoCompare();
    },
    update() {
      if (S.savings === undefined || nowS() - savAt >= 300) loadSavings();
      Savings.render();
    },
    // Compare straight away when we already know where to look and have enough readings.
    autoCompare() {
      const V = S.savings, pc = store.get("wmp-postcode"), brand = $("sv-brand") && $("sv-brand").value;
      if (!V || V.profile_days < V.min_profile_days || !pc || !brand || S.cmp) return;
      Savings.compare();
    },
    async compare() {
      const pc = $("sv-pc").value.trim(), brand = $("sv-brand").value;
      if (!/^\d{4}$/.test(pc)) { S.cmp = { error: "Enter a four-digit postcode." }; Savings.renderCompare(); return; }
      if (!brand) { S.cmp = { error: "Select a retailer." }; Savings.renderCompare(); return; }
      store.set("wmp-postcode", pc); store.set("wmp-brand", brand);
      S.cmp = { busy: true, brandName: $("sv-brand").selectedOptions[0].textContent };
      Savings.renderCompare();
      try {
        const r = await fetch(`/api/plans/compare?${new URLSearchParams({ brand, postcode: pc })}`);
        const body = await r.json();
        S.cmp = r.ok ? { data: body } : { error: body.detail || "The comparison didn't work. Try again." };
      } catch (_) { S.cmp = { error: "The server could not be reached. Try again." }; }
      Savings.renderCompare();
    },
    render() {
      const V = S.savings;
      if (!$("sv-bill")) return;
      if (!V) { $("sv-bill-note").textContent = V === null ? "Savings could not be loaded. Try again shortly." : "Loading"; return; }

      // ---- this quarter's bill
      const B = V.bill, est = B.estimate, sf = B.so_far, use = est || sf;
      $("h-bill").textContent = `${est ? "Estimated bill" : "Bill so far"} · ${dayMonth(B.start)} to ${dayMonth(B.end)}`;
      $("sv-bill").textContent = money(use.net_cost);
      $("sv-bill-note").textContent = est ? `Without solar and the battery it would be about ${money(est.without_solar)}`
        : `The quarter's estimate starts after your first full day of readings. Without solar and the battery, the bill so far would be ${money(sf.without_solar)}.`;
      $("sv-bill-bar").style.width = `${(B.day / B.days * 100).toFixed(1)}%`;
      $("sv-day").textContent = `Day ${B.day} of ${B.days}`;
      $("sv-basis").textContent = est ? `Estimated from your last ${B.basis_days === 1 ? "full day" : `${B.basis_days} full days`}` : "Actual so far";
      const billRows = [
        [`Grid usage · ${kwhInt(use.import_kwh)}`, money(use.import_cost)],
        [`Supply charge · ${est ? B.days : sf.days} ${(est ? B.days : sf.days) === 1 ? "day" : "days"}`, money(use.supply)],
        [`Feed-in credit · ${kwhInt(use.export_kwh)}`, use.feed_in_credit > 0 ? `−${money(use.feed_in_credit)}` : money(0)],
        [est ? "Estimated total" : "Total so far", money(use.net_cost), true],
      ];
      $("sv-bill-rows").innerHTML = billRows.map(([l, v, b]) => `<div class="ins-row${b ? " total" : ""}"><span>${l}</span><span>${v}</span></div>`).join("");

      // ---- payback
      const Pb = V.payback, cost = Pb.system_cost, saved = Pb.saved_lifetime, pm = Pb.per_month, form = $("sv-cost-form");
      let months = null, note;
      if (!cost) {
        $("sv-paid").textContent = "—";
        note = "Enter what your solar and battery system cost to see when it pays for itself.";
        form.hidden = false; $("sv-cost-cancel").hidden = true;
      } else {
        $("sv-cost-cancel").hidden = false;
        const frac = saved != null ? saved / cost : null;
        $("sv-paid").textContent = frac == null ? "—" : pct(Math.min(1, frac) * 100);
        if (frac == null) note = "Waiting for your inverter's lifetime totals.";
        else if (frac >= 1) note = `Paid off. Your system has saved about ${dollars(saved - cost)} more than it cost.`;
        else if (pm > 0) {
          months = Math.ceil((cost - saved) / pm);
          const d = new Date(); d.setMonth(d.getMonth() + months, 1);
          note = `Paid off by about ${monthYearLong.format(d)} at your current savings rate`;
        } else note = "The payoff date appears after your first full day of readings.";
        $("sv-paid-bar").style.width = `${Math.min(100, (frac || 0) * 100).toFixed(1)}%`;
      }
      if (!cost) $("sv-paid-bar").style.width = "0";
      $("sv-paid-note").textContent = note;
      const wait = `<span class="off">Needs a full day of readings</span>`;
      const payRows = [
        ["System cost", cost ? `<span>${dollars(cost)} <button class="link-btn sv-edit" type="button" data-act="edit-cost">Edit</button></span>` : `<span class="off">Not entered</span>`],
        ["Saved since install, at today's rates", `<span>${dollars(saved)}</span>`],
        [`Average saving per month${Pb.basis_days && Pb.basis_days < 30 ? ` · ${Pb.basis_days} ${Pb.basis_days === 1 ? "day" : "days"} of data` : ""}`, pm != null ? `<span>${money(pm)}</span>` : wait],
        ["Months to go", `<span>${!cost || saved == null ? "—" : saved >= cost ? "0" : months != null ? months : "—"}</span>`],
      ];
      $("sv-pay-rows").innerHTML = payRows.map(([l, v]) => `<div class="ins-row"><span>${l}</span>${v}</div>`).join("");

      Savings.renderCompare();
      Savings.renderEv();
    },
    renderCompare() {
      const V = S.savings, C = S.cmp, out = $("sv-plans"), noteEl = $("sv-plan-note"), foot = $("sv-plan-foot");
      if (!out) return;
      noteEl.textContent = foot.textContent = "";
      const enough = V && V.profile_days >= V.min_profile_days;
      $("sv-cmp-go").disabled = !enough || !!(C && C.busy);
      if (V && !enough) {
        out.innerHTML = `<div class="sv-msg">Plan comparison needs at least ${V.min_profile_days} full days of readings, so each plan is priced on whole days of your usage. You have ${V.profile_days} so far.</div>`;
        return;
      }
      if (!C) { out.innerHTML = `<div class="sv-msg">Enter your postcode and a retailer to price their current plans on your own usage.</div>`; return; }
      if (C.busy) { out.innerHTML = `<div class="sv-msg">Pricing every ${esc(C.brandName)} plan on your usage. The first comparison can take a few seconds.</div>`; return; }
      if (C.error) { out.innerHTML = `<div class="sv-msg bad">${esc(C.error)}</div>`; return; }
      const D = C.data, cur = D.current, curCost = cur.cost.total, src = cur.tariff.source || {};
      const best = D.plans.find((p) => !p.notes.length);
      const row = (name, tags, detail, cost, delta, deltaCls = "") => `<div class="sv-plan"><div class="sv-pname"><span>${esc(name)}</span>${tags}</div>` +
        `<span class="sv-pdetail">${esc(detail)}</span><span class="sv-pcost">${cost}</span><span class="sv-pdelta ${deltaCls}">${delta}</span></div>`;
      out.innerHTML = `<div class="sv-plans">` +
        row(src.plan_name || "Your current rates", `<span class="sv-tag mine">Your plan</span>`, tariffDetail(cur.tariff), dollars(curCost), "") +
        D.plans.map((p) => {
          const c = p.cost.total, tags = (p === best && c < curCost ? `<span class="sv-tag best">Lowest cost</span>` : "") +
            (p.notes.length ? `<span class="sv-tag approx" title="${esc(p.notes.join(" "))}">Approximate</span>` : "");
          return row(p.name, tags, tariffDetail(p.tariff), dollars(c), Math.round(c) === Math.round(curCost) ? "Same cost" : c < curCost ? `Save ${dollars(curCost - c)}` : `${dollars(c - curCost)} more`, c < curCost && !p.notes.length ? "good" : "");
        }).join("") + `</div>`;
      noteEl.textContent = !D.plans.length ? `${D.brand} has no current plans for ${D.postcode} that can be compared.`
        : best && best.cost.total < curCost - 1 ? `Switching to ${best.name} could save about ${dollars(curCost - best.cost.total)} a year. Estimates only. Check current plan details with ${D.brand} before switching.`
        : D.plans.some((p) => p.notes.length && p.cost.total < curCost)
          ? `None of the ${D.brand} plans that could be priced exactly cost less than your current rates. Plans marked approximate may cost more than shown.`
          : `Your current rates cost less than the ${D.checked} ${D.brand} plans checked, for how you use power.`;
      foot.textContent = `Based on ${D.profile_days} full days of your readings, scaled to a year. Seasonal plans use the current season's rates.` +
        (D.excluded ? ` ${D.excluded} plans with controlled load or demand charges were left out.` : "") +
        (D.plans.some((p) => p.notes.length) ? " Approximate means part of the plan couldn't be priced exactly, for example a feed-in rate that changes through the day." : "");
    },
    renderEv() {
      const t = sys().tariff, el = $("sv-ev");
      if (!t || !el) return;
      const cheap = liveBands(t).reduce((a, b) => (b.rate < a.rate ? b : a));
      const rows = [
        ["From solar", "Feed-in credit you give up", EV_KWH * t.feed_in_rate, "#3ee08f"],
        ["From the grid", t.type === "tou" ? `${cheap.name} rate, ${c1(cheap.rate)} per kWh` : `At ${c1(cheap.rate)} per kWh`, EV_KWH * cheap.rate, "#8a8a90"],
        ["Petrol car", `${PETROL_L} L per 100 km at ${money(PETROL_PRICE)} a litre`, PETROL_L * PETROL_PRICE, "#f5f5f5"],
      ];
      const max = Math.max(...rows.map((r) => r[2]));
      el.innerHTML = rows.map(([l, sub, c, bg]) => `<div class="sv-evrow"><div class="sv-evl"><span>${l}</span><span>${sub}</span></div>` +
        `<div class="sv-evbar"><div style="width:${(c / max * 100).toFixed(1)}%;background:${bg}"></div></div><span class="sv-evc">${money(c)}</span></div>`).join("");
    },
  };

  // ================================================================ TESLA
  const Tesla = {
    title: "Tesla", sub: "Not connected",
    mount() {
      return `<section class="empty-state" aria-labelledby="h-te">
        <div class="empty-ic">${icon("car", 24)}</div>
        <h2 id="h-te">Charge your Tesla with excess solar</h2>
        <p>Connect your Tesla account and the charge rate will adjust through the day, so the car gets spare solar and the home battery still fills.</p>
        <a class="btn-primary lg" href="#/tesla/setup">Connect Tesla</a>
      </section>`;
    },
  };

  const Setup = {
    title: "Connect Tesla", sub: "Four steps, about two minutes", nav: "tesla",
    mount() {
      const steps = ["Sign in", "Vehicle", "Charger", "Rules"];
      const perms = ["Read charging status and battery level", "Start and stop charging", "Change the charge current", "Check whether the car is at home"];
      return `<section class="setup" aria-labelledby="h-su">
        <div class="steps">${steps.map((l, k) => `<div class="step${k === 0 ? " cur" : ""}"><div class="step-n">${k + 1}</div><div class="step-l">${l}</div><div class="step-line"></div></div>`).join("")}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <h2 id="h-su">Sign in to Tesla</h2>
          <p class="lead">You will sign in on Tesla's website. Your Tesla password is never seen or stored here.</p>
        </div>
        <div class="perm">
          <div class="perm-h">WattsMyPower will be able to</div>
          ${perms.map((p) => `<div class="perm-row"><span>${icon("check", 18)}</span>${p}</div>`).join("")}
          <div class="perm-f">You can remove access at any time in Settings.</div>
        </div>
        <div class="callout"><span>${icon("car", 22)}</span><div><b>Tesla sign-in is not set up on this server yet</b>Connecting needs a Tesla Fleet API developer app. Once one is registered for this dashboard, this button will take you to Tesla to sign in.</div></div>
        <div class="setup-foot">
          <a class="btn-outline lg" href="#/tesla">Cancel</a>
          <button class="btn-primary" disabled>Sign in with Tesla</button>
        </div>
      </section>`;
    },
  };

  // ================================================================ PLAN FINDER (Energy Made Easy data)
  const store = { get: (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
  const cents = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}c`);
  const PLAN_TYPE = { MARKET: "Market offer", STANDING: "Standing offer", REGULATED: "Regulated offer" };

  const Finder = {
    results: null, busy: false,
    async start() {
      const el = $("finder");
      el.innerHTML = `
        <div class="title-block" style="gap:4px"><h2 id="h-find">Find your plan</h2>
          <div class="sub">Search the current plans retailers publish to Energy Made Easy, then load one into the rates below. Prices include GST.</div></div>
        <form class="finder-row" id="pf-form">
          <label class="field pf-postcode"><span class="field-l">Postcode</span><span class="input"><input id="pf-postcode" inputmode="numeric" autocomplete="postal-code" maxlength="4" pattern="\\d{4}" value="${esc(store.get("wmp-postcode"))}" required></span></label>
          <label class="field pf-brand"><span class="field-l">Retailer</span><select id="pf-brand" class="select" required><option value="">Loading retailers…</option></select></label>
          <label class="field pf-q"><span class="field-l">Plan name (optional)</span><span class="input"><input id="pf-q" placeholder="For example, solar"></span></label>
          <button class="btn-primary" id="pf-go" type="submit" style="padding:12px 20px;font-size:14px">Search plans</button>
        </form>
        <div id="pf-results"></div>`;
      $("pf-form").addEventListener("submit", (e) => { e.preventDefault(); Finder.search(); });
      $("pf-results").addEventListener("click", Finder.onClick);
      $("pf-results").addEventListener("change", (e) => { if (e.target.id === "pf-cl") Finder.renderResults(); });
      try {
        const brands = await (await fetch("/api/plans/brands")).json();
        const saved = store.get("wmp-brand") || ((sys().tariff || {}).source || {}).brand_id || "";
        $("pf-brand").innerHTML = `<option value="">Select your retailer</option>` +
          brands.map((b) => `<option value="${esc(b.id)}"${b.id === saved ? " selected" : ""}>${esc(b.name)}</option>`).join("");
      } catch (_) {
        $("pf-brand").innerHTML = `<option value="">Retailers unavailable</option>`;
      }
    },
    async search() {
      const pc = $("pf-postcode").value.trim(), brand = $("pf-brand").value, q = $("pf-q").value.trim(), out = $("pf-results");
      if (!/^\d{4}$/.test(pc)) { out.innerHTML = `<p class="field-help bad">Enter a four-digit postcode.</p>`; return; }
      if (!brand) { out.innerHTML = `<p class="field-help bad">Select your retailer.</p>`; return; }
      store.set("wmp-postcode", pc); store.set("wmp-brand", brand);
      out.innerHTML = `<p class="field-help">Loading plans from ${esc($("pf-brand").selectedOptions[0].textContent)}. The first search can take a few seconds.</p>`;
      $("pf-go").disabled = true;
      try {
        const r = await fetch(`/api/plans/search?${new URLSearchParams({ brand, postcode: pc, q })}`);
        const body = await r.json();
        if (!r.ok) { out.innerHTML = `<p class="field-help bad">${esc(body.detail || "The search didn't work. Try again.")}</p>`; return; }
        Finder.results = body;
        Finder.renderResults();
      } catch (_) {
        out.innerHTML = `<p class="field-help bad">The server could not be reached. Try again.</p>`;
      } finally { $("pf-go").disabled = false; }
    },
    renderResults() {
      const r = Finder.results, out = $("pf-results");
      if (!r) return;
      const showCl = $("pf-cl") ? $("pf-cl").checked : false;
      const plans = r.plans.filter((p) => showCl || !p.controlled_load);
      const hidden = r.plans.length - plans.length;
      const summary = !r.plans.length ? `${esc(r.brand)} has no current residential electricity plans for ${esc(r.postcode)}.`
        : `${plans.length} ${plans.length === 1 ? "plan" : "plans"} from ${esc(r.brand)} for ${esc(r.postcode)}${hidden ? `, plus ${hidden} with controlled load` : ""}.` +
          (r.truncated ? ` ${esc(r.brand)} publishes more than ${r.limit || 400} plans here, so only the first ${r.limit || 400} were checked. Add part of your plan name to narrow the search.` : "");
      const head = `<div class="pf-head"><span class="field-help">${summary}</span>
        ${r.plans.some((p) => p.controlled_load) ? `<label class="pf-check"><input type="checkbox" id="pf-cl"${showCl ? " checked" : ""}> Show plans with controlled load${hidden ? ` (${hidden})` : ""}</label>` : ""}</div>`;
      out.innerHTML = head + `<div class="pf-list">${plans.map((p) => {
        const tags = [PLAN_TYPE[p.type] || p.type, p.pricing === "tou" ? "Time of use" : "Single rate", p.controlled_load ? "Controlled load" : "", p.demand ? "Demand charges" : ""].filter(Boolean);
        const rates = p.rates.map((x) => `${esc(x.name === "All times" ? "Usage" : x.name)} ${cents(x.price)}`).join(" · ");
        return `<div class="pf-plan">
          <div class="pf-main">
            <div class="pf-name">${esc(p.name)}</div>
            <div class="pf-tags">${tags.map((t) => `<span class="pill pill-neutral">${esc(t)}</span>`).join("")}</div>
            <div class="pf-rates">${rates || "Rates not listed"} per kWh · Supply ${p.supply != null ? money(p.supply) : "—"}/day · Feed-in ${cents(p.feed_in)}</div>
            <div class="pf-id">Plan ${esc(p.id)} · updated ${esc(p.updated || "—")}</div>
          </div>
          <button class="btn-outline" data-plan="${esc(p.id)}">Use this plan</button>
        </div>`;
      }).join("")}</div>`;
    },
    async onClick(e) {
      const b = e.target.closest("[data-plan]");
      if (!b || Finder.busy) return;
      Finder.busy = true;
      const label = b.textContent;
      b.textContent = "Loading…"; b.disabled = true;
      try {
        const r = await fetch(`/api/plans/tariff?${new URLSearchParams({ brand: $("pf-brand").value, plan: b.dataset.plan })}`);
        const body = await r.json();
        if (!r.ok) { toast(body.detail || "That plan couldn't be loaded."); return; }
        Tariff.load(body);
      } catch (_) { toast("The server could not be reached. Try again."); }
      finally { Finder.busy = false; b.textContent = label; b.disabled = false; }
    },
  };

  // ================================================================ TARIFF EDITOR
  const BAND_COLORS = ["#ffb547", "#6f8cff", "#9a9aa3", "#3ee08f", "#c4a7ff", "#ff8a80"];
  const DAY_OPTS = [["all", "Every day"], ["weekdays", "Weekdays"], ["weekends", "Weekends"]];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const toMin = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };

  // Which rate applies at each minute of a weekday or weekend day (first match wins; the server rejects overlaps).
  function bandTable(t, kind) {
    const bands = t.type === "tou" ? t.bands : [{ name: "All times", rate: t.flat_rate, other: true, windows: [] }];
    const other = Math.max(0, bands.findIndex((b) => b.other));
    const tab = new Array(1440).fill(other);
    const set = new Array(1440).fill(false);
    bands.forEach((b, i) => {
      if (b.other) return;
      for (const w of b.windows || []) {
        if (w.days !== "all" && w.days.slice(0, -1) !== kind) continue;
        const s0 = toMin(w.start), e0 = toMin(w.end);
        let m = s0; // equal start and end = the whole day
        do { if (!set[m]) { tab[m] = i; set[m] = true; } m = (m + 1) % 1440; } while (m !== e0);
      }
    });
    return { bands, tab };
  }
  // Indexes of rates that apply at some minute of the week (a rate can be fully covered by the others).
  const usedBands = (t) => new Set([...bandTable(t, "weekday").tab, ...bandTable(t, "weekend").tab]);
  const bandAt = (t, ts) => {
    const d = new Date(ts * 1000), kind = d.getDay() === 0 || d.getDay() === 6 ? "weekend" : "weekday";
    const { bands, tab } = bandTable(t, kind);
    return bands[tab[d.getHours() * 60 + d.getMinutes()]];
  };

  const Tariff = {
    draft: null, dirty: false, imported: null,
    // Load a published plan into the editor (not saved until Save rates).
    load(res) {
      Tariff.draft = clone(res.tariff); Tariff.imported = res; Tariff.dirty = true;
      Tariff.render();
      $("tariff-card").scrollIntoView({ behavior: "smooth", block: "start" });
    },
    async start() {
      // Always edit what the server has, not whatever the page last heard over the live stream.
      $("tariff-card").innerHTML = `<div class="sub">Loading rates…</div>`;
      try {
        Tariff.draft = await (await fetch("/api/tariff")).json();
      } catch (_) {
        $("tariff-card").innerHTML = `<div class="sub">The rates could not be loaded. Reload the page to try again.</div>`;
        return;
      }
      if (S.status) S.status.system = { ...S.status.system, tariff: clone(Tariff.draft) };
      Tariff.dirty = false; Tariff.imported = null;
      if ($("tariff-card")) Tariff.render();
    },
    listen() {
      const card = $("tariff-card");
      card.addEventListener("input", Tariff.onInput);
      card.addEventListener("change", Tariff.onInput);
      card.addEventListener("click", Tariff.onClick);
    },
    seedBands(t) {
      const r = t.flat_rate || 0.32, f2 = (x) => Math.round(x * 100) / 100;
      return [
        { name: "Peak", rate: f2(r * 1.4), windows: [{ days: "all", start: "16:00", end: "21:00" }] },
        { name: "Off-peak", rate: f2(r * 0.7), windows: [{ days: "all", start: "21:00", end: "07:00" }] },
        { name: "Shoulder", rate: r, other: true, windows: [] },
      ];
    },
    money(key, label, unit, help, value, attrs = "") {
      return `<label class="field"><span class="field-l">${label}</span>
        <span class="input"><span class="pre">$</span><input type="number" step="0.01" min="0" inputmode="decimal" ${attrs} value="${value ?? ""}"><span class="unit">${unit}</span></span>
        ${help ? `<span class="field-help">${help}</span>` : ""}</label>`;
    },
    render() {
      const t = Tariff.draft, tou = t.type === "tou", used = tou ? usedBands(t) : new Set();
      const bandsHtml = !tou ? "" : `
        <div class="t-section">
          <div class="t-section-h"><span class="field-l">Import rates</span><span class="field-help">Set when each rate applies. The rate marked for all other times fills the gaps. A window from 00:00 to 00:00 covers the whole day.</span></div>
          <div class="bands">${t.bands.map((b, i) => `
            <div class="band" data-band="${i}">
              <div class="band-top">
                <i class="sw sw10" style="background:${BAND_COLORS[i % BAND_COLORS.length]}"></i>
                <span class="input band-name"><input type="text" maxlength="24" aria-label="Rate name" data-f="name" value="${esc(b.name)}"></span>
                <span class="input band-rate"><span class="pre">$</span><input type="number" step="0.01" min="0" inputmode="decimal" aria-label="${esc(b.name)} rate" data-f="rate" value="${b.rate}"><span class="unit">per kWh</span></span>
                ${t.bands.length > 2 && !b.other ? `<button class="icon-x" data-act="del-band" aria-label="Remove ${esc(b.name)}">×</button>` : ""}
              </div>
              ${b.other ? `<div class="band-other">${used.has(i) ? "Applies at all other times"
                : "Never applies: the other rates already cover every hour. To use two rates, select \u201cUse for all other times\u201d on one of them, then remove this one."}</div>` : `
                <div class="windows">${b.windows.map((w, j) => `
                  <div class="win" data-win="${j}">
                    <select data-f="days" aria-label="Days">${DAY_OPTS.map(([v, l]) => `<option value="${v}"${w.days === v ? " selected" : ""}>${l}</option>`).join("")}</select>
                    <input type="time" step="300" data-f="start" aria-label="From" value="${w.start}">
                    <span class="to">to</span>
                    <input type="time" step="300" data-f="end" aria-label="To" value="${w.end}">
                    ${b.windows.length > 1 ? `<button class="icon-x" data-act="del-win" aria-label="Remove time window">×</button>` : ""}
                  </div>`).join("")}
                </div>
                ${b.windows.length < 6 ? `<button class="link-btn small" data-act="add-win">Add time window</button>` : ""}
                <button class="link-btn small muted-link" data-act="make-other">Use for all other times</button>`}
            </div>`).join("")}
          </div>
          ${t.bands.length < 6 ? `<button class="btn-outline" data-act="add-band" style="align-self:flex-start">Add rate</button>` : ""}
          <div class="timeline" id="timeline"></div>
        </div>`;
      $("tariff-card").innerHTML = `
        <div class="title-block" style="gap:4px"><h2 id="h-rates">Electricity rates</h2><div class="sub">Used to calculate savings, grid cost, and feed-in credit. Find these on your electricity bill.</div></div>
        ${Tariff.imported ? `<div class="import-note" role="status"><b>Loaded ${esc(Tariff.imported.plan.brand)} · ${esc(Tariff.imported.plan.name)}.</b> Check the rates below, then select Save rates.
          ${Tariff.imported.notes.length ? `<ul>${Tariff.imported.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</div>`
          : t.source ? `<div class="source-line">Imported from ${esc(t.source.brand)} · ${esc(t.source.plan_name)} (plan ${esc(t.source.plan_id)}), published ${esc(t.source.updated || "—")}. Edit anything that differs from your bill.</div>` : ""}
        <div class="field">
          <span class="field-l">Rate type</span>
          <div class="seg type-seg" role="group" aria-label="Rate type">
            <button data-act="type" data-type="flat" aria-pressed="${!tou}">Single rate</button>
            <button data-act="type" data-type="tou" aria-pressed="${tou}">Time of use</button>
          </div>
          <span class="field-help">${tou ? "Different rates at different times of day, for example peak, shoulder, and off-peak." : "One price for grid electricity at any time of day."}</span>
        </div>
        ${tou ? bandsHtml : `<div class="fields">${Tariff.money("flat", "Grid import rate", "per kWh", "What you pay for electricity from the grid", t.flat_rate, 'data-top="flat_rate"')}</div>`}
        <div class="fields">
          ${Tariff.money("fit", "Feed-in tariff", "per kWh", "What you earn for solar sent to the grid", t.feed_in_rate, 'data-top="feed_in_rate"')}
          ${Tariff.money("sup", "Daily supply charge", "per day", "Fixed daily charge from your retailer", t.supply_charge, 'data-top="supply_charge"')}
        </div>
        <div class="t-foot">
          <span class="s-status" id="rates-status">${Tariff.dirty ? "Unsaved changes." : ""}</span>
          <div class="actions">
            <button class="btn-outline" data-act="discard"${Tariff.dirty ? "" : " disabled"}>Discard changes</button>
            <button class="btn-primary" data-act="save" style="padding:10px 18px;font-size:14px"${Tariff.dirty ? "" : " disabled"}>Save rates</button>
          </div>
        </div>`;
      Tariff.renderTimeline();
    },
    renderTimeline() {
      const el = $("timeline"), t = Tariff.draft;
      if (!el) return;
      const used = usedBands(t);
      t.bands.forEach((b, i) => {
        const note = b.other && document.querySelector(`[data-band="${i}"] .band-other`);
        if (note) note.textContent = used.has(i) ? "Applies at all other times"
          : "Never applies: the other rates already cover every hour. To use two rates, select \u201cUse for all other times\u201d on one of them, then remove this one.";
      });
      const row = (kind, label) => {
        const { bands, tab } = bandTable(t, kind), segs = [];
        let start = 0;
        for (let m = 1; m <= 1440; m++) if (m === 1440 || tab[m] !== tab[start]) { segs.push([start, m, tab[start]]); start = m; }
        return `<div class="tl-row"><span class="tl-label">${label}</span><div class="tl-bar">${segs.map(([a, b, i]) =>
          `<div style="left:${a / 14.4}%;width:${(b - a) / 14.4}%;background:${BAND_COLORS[i % BAND_COLORS.length]}" title="${esc(bands[i].name)} ${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")} to ${String(Math.floor(b / 60) % 24).padStart(2, "0")}:${String(b % 60).padStart(2, "0")}"></div>`).join("")}</div></div>`;
      };
      el.innerHTML = row("weekday", "Weekdays") + row("weekend", "Weekends") +
        `<div class="tl-row"><span class="tl-label"></span><div class="tl-ticks">${[0, 6, 12, 18, 24].map((hr) => `<span style="left:${hr / 24 * 100}%">${String(hr).padStart(2, "0")}:00</span>`).join("")}</div></div>` +
        `<div class="tl-legend">${t.bands.map((b, i) => `<span><i class="sw sw10" style="background:${BAND_COLORS[i % BAND_COLORS.length]}"></i>${esc(b.name)} · ${money(+b.rate || 0)}</span>`).join("")}</div>`;
    },
    touch() {
      Tariff.dirty = true;
      $("rates-status").textContent = "Unsaved changes.";
      $("rates-status").classList.remove("bad");
      document.querySelectorAll('#tariff-card [data-act="save"], #tariff-card [data-act="discard"]').forEach((b) => { b.disabled = false; });
    },
    onInput(e) {
      const el = e.target, t = Tariff.draft;
      if (el.dataset.top) { t[el.dataset.top] = el.value === "" ? "" : +el.value; Tariff.touch(); return; }
      const f = el.dataset.f, bandEl = el.closest("[data-band]");
      if (!f || !bandEl) return;
      const b = t.bands[+bandEl.dataset.band], winEl = el.closest("[data-win]");
      if (winEl) b.windows[+winEl.dataset.win][f] = el.value;
      else b[f] = f === "rate" ? (el.value === "" ? "" : +el.value) : el.value;
      Tariff.touch();
      Tariff.renderTimeline();
    },
    async onClick(e) {
      const a = e.target.closest("[data-act]");
      if (!a) return;
      const t = Tariff.draft, bi = a.closest("[data-band]") ? +a.closest("[data-band]").dataset.band : -1, act = a.dataset.act;
      if (act === "save") return Tariff.save();
      if (act === "discard") { Tariff.start(); return; }
      if (act === "type") {
        if (t.type === a.dataset.type) return;
        t.type = a.dataset.type;
        if (t.type === "tou" && (!t.bands || t.bands.length < 2)) t.bands = Tariff.seedBands(t);
      }
      if (act === "add-band") t.bands.splice(t.bands.length - (t.bands[t.bands.length - 1].other ? 1 : 0), 0, { name: `Rate ${t.bands.length + 1}`, rate: t.flat_rate || 0.3, windows: [{ days: "all", start: "07:00", end: "09:00" }] });
      if (act === "del-band") t.bands.splice(bi, 1);
      if (act === "add-win") t.bands[bi].windows.push({ days: "all", start: "07:00", end: "09:00" });
      if (act === "del-win") t.bands[bi].windows.splice(+a.closest("[data-win]").dataset.win, 1);
      if (act === "make-other") {
        t.bands.forEach((b) => { if (b.other) { delete b.other; b.windows = [{ days: "all", start: "07:00", end: "09:00" }]; } });
        t.bands[bi].other = true; t.bands[bi].windows = [];
      }
      Tariff.dirty = true;
      Tariff.render();
    },
    async save() {
      const st = $("rates-status");
      st.textContent = "Saving…"; st.classList.remove("bad");
      try {
        const r = await fetch("/api/tariff", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Tariff.draft) });
        const body = await r.json();
        if (!r.ok) { st.textContent = typeof body.detail === "string" ? body.detail : "Check the rates and try again."; st.classList.add("bad"); return; }
        if (S.status) S.status.system = { ...S.status.system, tariff: body };
        Tariff.draft = clone(body); Tariff.dirty = false; Tariff.imported = null;
        Tariff.render();
        $("rates-status").textContent = `Saved at ${hhmm(nowS())}. Savings on every page now use these rates.`;
        S.costsToday = null; S.costsKey = "";
      } catch (_) { st.textContent = "The server could not be reached. Try again."; st.classList.add("bad"); }
    },
  };

  // ================================================================ SETTINGS
  const Settings = {
    title: "Settings", sub: "System details, rates, and connected services", nav: "settings",
    mount(tab) {
      const tabs = [["system", "System"], ["tariffs", "Tariffs"], ["integrations", "Integrations"]];
      return `<div class="s-tabs">${tabs.map(([k, l]) => `<a href="#/settings/${k}"${k === tab ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</div>` +
        (tab === "tariffs" ? Settings.tariffs() : tab === "integrations" ? `<section class="s-card" aria-label="Connected services" id="integ"></section>` : Settings.system());
    },
    system() {
      return `<section class="s-card" aria-labelledby="h-sys">
        <div class="s-head"><div class="title-block" style="gap:4px"><h2 id="h-sys">Solar and battery system</h2><div class="sub" id="sys-sub"></div></div></div>
        <div id="sys-rows"></div>
        <div class="s-note">These details come from your inverters over the local network. Solar array size (PV_KW) and the second inverter's address (PV2_HOST) are set in the server configuration.</div>
      </section>`;
    },
    tariffs() {
      return `<section class="s-card padded" aria-labelledby="h-find" id="finder"></section>
        <section class="s-card padded" aria-labelledby="h-rates" id="tariff-card"></section>`;
    },
    bind(tab) {
      if (tab === "tariffs") { Finder.start(); Tariff.start(); Tariff.listen(); }
      if (tab === "integrations") {
        $("integ").addEventListener("click", async (e) => {
          const a = e.target.closest("[data-act]");
          if (!a) return;
          const form = $("loc-form");
          const saved = async (changes) => {
            const res = await saveSettings(changes);
            $("loc-err").textContent = res.ok ? "" : res.error;
            if (res.ok) { form.hidden = true; Settings.places = null; toast("Location saved. Updating the forecast."); S.forecast = undefined; Settings.update(); await loadForecast(); }
          };
          if (a.dataset.act === "loc") { form.hidden = !form.hidden; if (!form.hidden) $("in-place").focus(); }
          if (a.dataset.act === "loc-cancel") { form.hidden = true; Settings.places = null; $("loc-results").innerHTML = ""; }
          if (a.dataset.act === "loc-coords") { $("loc-coords").hidden = !$("loc-coords").hidden; if (!$("loc-coords").hidden) $("in-lat").focus(); }
          if (a.dataset.act === "loc-pick") {
            const p = Settings.places && Settings.places[+a.dataset.i];
            if (p) await saved({ latitude: p.latitude, longitude: p.longitude, location_name: p.name });
          }
          if (a.dataset.act === "loc-save") {
            const lat = $("in-lat").value.trim(), lon = $("in-lon").value.trim();
            await saved({ latitude: lat === "" ? NaN : +lat, longitude: lon === "" ? NaN : +lon });
          }
        });
        // Search on submit only: OpenStreetMap asks apps not to search as you type.
        $("integ").addEventListener("submit", async (e) => {
          if (e.target.id !== "loc-search") return;
          e.preventDefault();
          const q = $("in-place").value.trim(), out = $("loc-results"), btn = e.target.querySelector("button[type=submit]");
          $("loc-err").textContent = "";
          if (q.length < 3) { $("loc-err").textContent = "Enter at least three letters of a suburb, town or address."; return; }
          btn.disabled = true; out.innerHTML = `<span class="field-help">Searching…</span>`;
          try {
            const r = await fetch(`/api/geocode?${new URLSearchParams({ q })}`), body = await r.json();
            if (!r.ok) { out.innerHTML = ""; $("loc-err").textContent = body.detail || "The search didn't work. Try again."; return; }
            Settings.places = body;
            out.innerHTML = body.length ? body.map((p, i) => `<button type="button" class="loc-place" data-act="loc-pick" data-i="${i}"><span>${esc(p.label)}</span><small>${esc(p.detail)}</small></button>`).join("")
              : `<span class="field-help">No places found. Try a suburb and state, for example Paddington QLD.</span>`;
          } catch (_) { out.innerHTML = ""; $("loc-err").textContent = "The server could not be reached. Try again."; }
          finally { btn.disabled = false; }
        });
      }
    },
    update() {
      const s = sys(), st = S.status, last = st && st.last_success;
      if ($("sys-rows")) {
        $("sys-sub").textContent = `From your Sungrow inverter · ${last ? `last synced ${hhmm(last)}` : "not synced yet"}`;
        const rows = [
          ["Site name", "Home"],
          ["Inverter", s.model ? `Sungrow ${s.model} hybrid${s.nominal_kw ? `, ${s.nominal_kw} kW` : ""}` : "—"],
          ["Serial number", s.serial || "—"],
          ["Solar array", s.pv_kw ? `${s.pv_kw} kW` : "—"],
          ["Battery", s.battery_kwh ? `${s.battery_kwh} kWh` : "—"],
          ["Maximum charge and discharge rate", s.battery_max_kw ? `${s.battery_max_kw} kW` : "—"],
          ["Backup reserve", s.battery_reserve != null ? pct(s.battery_reserve) : "—"],
          ["Grid connection", s.phases || "—"],
          ...(s.pv2 ? [["Second inverter", (s.pv2.model ? `Sungrow ${s.pv2.model}${s.pv2.nominal_kw ? `, ${s.pv2.nominal_kw} kW` : ""}` : `At ${s.pv2.host}, not read yet`) +
            (s.pv2.behind_meter ? ", behind the hybrid's meter" : ", outside the hybrid's meter (output counted as export)")]] : []),
        ];
        $("sys-rows").innerHTML = rows.map(([l, v]) => `<div class="s-row"><span>${l}</span><span>${esc(v)}</span></div>`).join("");
      }
      const integ = $("integ");
      if (!integ) return;
      // Don't redraw while the location form is open, so typing isn't interrupted.
      const form = $("loc-form");
      if (form && !form.hidden) return;
      const ok = fresh(), fcOk = !!S.forecast;
      const row = (ic, name, on, status, detail, action = "", extra = "") => `<div class="integ"><div class="integ-ic">${icon(ic, 22)}</div>` +
        `<div class="integ-main"><div class="integ-name">${name}<span class="pill ${on ? "pill-ok" : "pill-neutral"}">${status}</span></div><span class="integ-detail">${detail}</span></div>${action}${extra}</div>`;
      integ.innerHTML =
        row("sun", "Sungrow inverter", ok, ok ? "Connected" : "Not responding", `Inverter and battery data every minute over the local network · ${last ? `last sync ${hhmm(last)}` : "no data yet"}`) +
        (s.pv2 ? (() => {
          const pv2Ok = s.pv2.last_success && nowS() - s.pv2.last_success < (st.poll_interval || 60) * 3, p = snap();
          return row("sun", `Sungrow ${s.pv2.model || "second inverter"}`, pv2Ok, pv2Ok ? "Connected" : s.pv2.last_success ? "Not responding" : "Connecting",
            `Second solar system through its Wi-Fi dongle at ${esc(s.pv2.host)} · ${pv2Ok && p ? `${kW(p.pv2_power)} now, ${kWh(p.daily_pv2)} today` : s.pv2.last_success ? `last sync ${hhmm(s.pv2.last_success)} (it powers down after dark)` : "no data yet"}`);
        })() : "") +
        row("car", "Tesla", false, "Not connected", "Charge your car with excess solar", `<a class="btn-primary" href="#/tesla/setup" style="padding:10px 18px;font-size:14px">Connect Tesla</a>`) +
        row("cloudSun", "Weather forecast", fcOk, fcOk ? "Connected" : S.forecast === undefined ? "Checking" : "Unavailable",
          `Hourly cloud cover and temperature from Open-Meteo for ${esc(locationLabel())}`,
          `<button class="btn-outline" data-act="loc">Change location</button>`,
          `<div class="loc-form" id="loc-form" hidden>
            <form class="loc-search" id="loc-search">
              <label class="field"><span class="field-l">Suburb, town or address</span><span class="input"><input id="in-place" placeholder="For example, Paddington QLD" autocomplete="off"></span></label>
              <div class="actions"><button type="button" class="btn-outline" data-act="loc-cancel">Cancel</button><button type="submit" class="btn-primary" style="padding:10px 18px;font-size:14px">Search</button></div>
            </form>
            <div class="loc-results" id="loc-results"></div>
            <span class="field-help bad" id="loc-err"></span>
            <span class="field-help">Searches OpenStreetMap. Only the suburb name and its coordinates are saved, never a street address.
              <button type="button" class="link-btn inline" data-act="loc-coords">Enter coordinates instead</button></span>
            <div class="loc-coords" id="loc-coords" hidden>
              <label class="field"><span class="field-l">Latitude</span><span class="input"><input id="in-lat" type="number" step="0.0001" min="-90" max="90" value="${s.latitude}"></span></label>
              <label class="field"><span class="field-l">Longitude</span><span class="input"><input id="in-lon" type="number" step="0.0001" min="-180" max="180" value="${s.longitude}"></span></label>
              <button type="button" class="btn-primary" data-act="loc-save" style="padding:10px 18px;font-size:14px">Save coordinates</button>
            </div>
          </div>`);
    },
  };

  async function saveSettings(changes) {
    if (Object.values(changes).some((v) => Number.isNaN(v))) return { ok: false, error: "Enter a number." };
    try {
      const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      const body = await r.json();
      if (!r.ok) return { ok: false, error: friendly(body.detail) };
      if (S.status) S.status.system = { ...S.status.system, ...body };
      return { ok: true };
    } catch (e) { return { ok: false, error: "The server could not be reached. Try again." }; }
  }
  const friendly = (d) => {
    const m = /^(\w+) must be between (.+) and (.+)$/.exec(d || "");
    const names = { latitude: "Latitude", longitude: "Longitude" };
    return m ? `${names[m[1]] || m[1]} must be between ${m[2]} and ${m[3]}.` : "Invalid value.";
  };

  // ================================================================ router
  const VIEWS = { overview: Overview, history: History, forecast: Forecast, insights: Insights, savings: Savings, tesla: Tesla };
  let current = null, currentKey = "";
  function route() {
    const parts = (location.hash.replace(/^#\/?/, "") || "overview").split("/");
    let view, arg, navKey = parts[0];
    if (parts[0] === "tesla" && parts[1] === "setup") view = Setup;
    else if (parts[0] === "settings") { view = Settings; arg = ["system", "tariffs", "integrations"].includes(parts[1]) ? parts[1] : "system"; }
    else { view = VIEWS[parts[0]] || Overview; if (!VIEWS[parts[0]]) navKey = "overview"; }
    const key = `${navKey}/${arg || parts[1] || ""}`;
    if (key === currentKey) return;
    currentKey = key; current = view;
    navKeyNow = navKey;
    document.querySelectorAll("[data-nav]").forEach((a) => (a.dataset.nav === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    navKey === "settings" ? $("gear").setAttribute("aria-current", "page") : $("gear").removeAttribute("aria-current");
    placeNavIndicator();
    $("page-title").textContent = view === Overview ? greeting() : view.title;
    $("page-sub").textContent = view.sub;
    document.title = view === Overview ? "WattsMyPower" : `${view.title} · WattsMyPower`;
    $("view").innerHTML = view.mount(arg);
    view.bind && view.bind(arg);
    view.update && view.update();
    window.scrollTo(0, 0);
    renderDock();
  }
  window.addEventListener("hashchange", route);

  // ---------------------------------------------------------------- data
  async function loadForecast() {
    try { S.forecast = await (await fetch("/api/forecast")).json(); }
    catch (e) { console.error("forecast", e); S.forecast = null; }
    if (current === Overview || current === Forecast || current === Settings) current.update();
  }

  function connect() {
    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      S.status = JSON.parse(e.data);
      renderNav();
      renderHeader();
      renderDock();
      current && current.update && current.update();
    };
    es.onerror = () => renderHeader(); // EventSource reconnects by itself
  }

  renderNav();
  route();
  renderHeader();
  connect();
  loadForecast();
  setInterval(renderHeader, 30 * 1000);
  setInterval(loadForecast, 10 * 60 * 1000);
})();
