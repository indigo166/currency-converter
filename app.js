/*
 * app.js — UI, storage and network. Pure logic lives in core.js (window.Core).
 *
 * Rendering is deliberately plain: each state change re-renders the affected region
 * from state as an HTML string, and one delegated listener handles every tap via
 * data-action attributes. The app is small enough that this is fast, and it means
 * there is exactly one place each piece of UI is described.
 */
(function () {
  'use strict';

  const C = window.Core;
  const { VERSION, RELEASES } = window.AppVersion;

  // ------------------------------------------------------------------------
  // Storage — everything lives on the phone. Home-screen web apps on iOS keep their
  // own storage and are exempt from Safari's 7-day eviction of website data.
  // ------------------------------------------------------------------------

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('cc.' + k);
        return v == null ? d : JSON.parse(v);
      } catch (_) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('cc.' + k, JSON.stringify(v)); } catch (_) { /* full/private */ }
    },
  };

  const MAX_PINS = 6;
  const MAX_HISTORY = 200;
  const MAX_TAPE = 100;
  const STALE_MS = 24 * 3600 * 1000;
  const AUTO_REFRESH_MS = 6 * 3600 * 1000;
  const PCT_EPSILON = 0.00005; // 0.005% — below this the arrow is a dash

  const validPair = (p) => p && C.CODES.has(p.from) && C.CODES.has(p.to);
  const unitsState = store.get('units', null);

  const S = {
    tab: ['currency', 'calc', 'units'].includes(store.get('tab')) ? store.get('tab') : 'currency',
    pair: validPair(store.get('pair')) ? store.get('pair') : { from: 'JPY', to: 'USD' },
    rates: store.get('rates', null),
    // pos = cursor position within text (0…text.length); tapping the number moves it.
    // steps = each "=" in the current chain, {expr, result, from}, so the screen can show
    // how the number on it was reached. Cleared when a fresh number is started.
    cur: { text: '', pos: 0, isResult: false, steps: [] },
    calc: { text: '', pos: 0, editingId: null },
    // Snapshots taken before anything that throws work away ("=", AC, starting over,
    // deleting a tape line), per tab. ↶ pops one.
    undo: { cur: [], calc: [] },
    pins: store.get('pins', []),
    selected: [],
    history: store.get('history', []),
    tape: store.get('tape', []),
    units: unitsState && C.UNITS[unitsState.cat] ? unitsState
      : { cat: 'Length', from: 'mi', to: 'km', value: '1' },
    refreshing: false,
    chart: null,
    sheet: null,
    updateReady: null, // a newer version number waiting to be loaded
    scrollTapeToEnd: true,
  };

  let idSeq = 0;
  const newId = () => Date.now() * 1000 + (idSeq++ % 1000);

  // ------------------------------------------------------------------------
  // Icons (Material Symbols paths)
  // ------------------------------------------------------------------------

  const svg = (d, vb) => `<svg viewBox="${vb || '0 0 24 24'}" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  const I = {
    chevron: svg('M7 10l5 5 5-5z'),
    swap: svg('M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z'),
    swapV: svg('M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3L5 6.99h3V14h2V6.99h3L9 3z'),
    history: svg('M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z'),
    refresh: svg('M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z'),
    close: svg('M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'),
    pin: svg('M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z'),
    back: svg('M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z'),
    backspace: svg('M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z'),
    currency: svg('M12.89 11.1c-1.78-.59-2.64-.96-2.64-1.9 0-1.02 1.11-1.39 1.81-1.39 1.31 0 1.79.99 1.9 1.34l1.58-.67c-.15-.44-.82-1.91-2.66-2.23V5h-1.75v1.26c-2.6.56-2.62 2.85-2.62 2.96 0 2.27 2.25 2.91 3.35 3.31 1.58.56 2.28 1.07 2.28 2.03 0 1.13-1.05 1.61-1.98 1.61-1.82 0-2.34-1.87-2.4-2.09l-1.66.67c.63 2.19 2.28 2.78 3.02 2.96V19h1.75v-1.24c.52-.09 3.02-.59 3.02-3.22.01-1.39-.6-2.61-3-3.44zM3 21H1v-6h6v2H4.52c1.61 2.41 4.36 4 7.48 4a9 9 0 0 0 9-9h2c0 6.08-4.92 11-11 11-3.72 0-7.01-1.85-9-4.67V21zm-2-9C1 5.92 5.92 1 12 1c3.72 0 7.01 1.85 9 4.67V3h2v6h-6V7h2.48C17.87 4.59 15.12 3 12 3a9 9 0 0 0-9 9H1z'),
    calc: svg('M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM6.25 7.72h5v1.5h-5zM13 15.75h5v1.5h-5zm0-2.5h5v1.5h-5zM8 18h1.5v-2h2v-1.5h-2v-2H8v2H6V16h2zm6.09-7.05l1.41-1.41 1.41 1.41 1.06-1.06-1.41-1.42 1.41-1.41L16.91 6 15.5 7.41 14.09 6l-1.06 1.06 1.41 1.41-1.41 1.42z'),
    undo: svg('M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z'),
    info: svg('M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z'),
    ruler: svg('M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h2v4h2V8h2v4h2V8h2v4h2V8h2v4h2V8h2v8z'),
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------------------
  // Network
  // ------------------------------------------------------------------------

  const JSD = (tag) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.json`;
  const FR = 'https://api.frankfurter.dev/v1/';
  const TRM = 'https://www.datos.gov.co/resource/32sa-8pi3.json';

  async function getJSON(url, ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms || 20000);
    try {
      const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Two sources, one table at a time. jsDelivr first (carries COP, has dated tags for
   * the daily delta); Frankfurter/ECB as fallback (no COP). The first usable table
   * wins outright and they are never merged — every pair crosses two USD-base rates,
   * so a stitched table would bake the providers' ~0.4% disagreement into JPY→COP.
   */
  async function refreshRates(manual) {
    if (S.refreshing) return;
    S.refreshing = true;
    renderTop();
    try {
      let today = null;
      let source = null;
      try { today = C.parseJsDelivr(await getJSON(JSD('latest'))); if (today) source = 'jsdelivr'; } catch (_) { /* fall back */ }
      if (!today) {
        try { today = C.parseFrankfurter(await getJSON(FR + 'latest?base=USD')); if (today) source = 'ecb'; } catch (_) { /* offline */ }
      }
      if (!today) {
        if (manual) toast("Couldn't refresh — check connection");
        return;
      }
      // Previous day from the SAME source, so the delta compares like with like.
      // jsDelivr has no weekend tags, so walk back until one resolves.
      let prev = null;
      if (source === 'jsdelivr') {
        for (let b = 1; b <= 5 && !prev; b++) {
          try { prev = C.parseJsDelivr(await getJSON(JSD(C.minusDaysIso(today.date, b)))); } catch (_) { /* next */ }
        }
      } else {
        try { prev = C.parseFrankfurter(await getJSON(FR + C.minusDaysIso(today.date, 1) + '?base=USD')); } catch (_) { /* no delta */ }
      }
      S.rates = {
        rates: today.rates, date: today.date,
        prev: prev ? prev.rates : null, prevDate: prev ? prev.date : null,
        source, refreshedAt: Date.now(),
      };
      store.set('rates', S.rates);
      if (manual) toast('Rates updated');
    } finally {
      S.refreshing = false;
      render();
    }
  }

  const seriesCache = new Map();

  /**
   * Daily history for a pair. Neither side COP → one Frankfurter time-series request
   * (ECB, back to 1999). USD/COP → Colombia's official TRM (back to 1991). COP against
   * anything else → both, crossed per date on a forward-filled axis.
   */
  async function fetchSeries(from, to, rangeKey) {
    const key = `${from}|${to}|${rangeKey}`;
    if (seriesCache.has(key)) return seriesCache.get(key);
    const start = C.startDateFor(rangeKey);
    const end = C.todayIso();
    const fr = async (f, t) => C.parseTimeSeries(
      await getJSON(`${FR}${start}..${end}?base=${f}&symbols=${t}`, 45000), t);
    const trm = async () => {
      const q = new URLSearchParams({
        $select: 'vigenciadesde,valor',
        $where: `vigenciadesde >= "${start}T00:00:00.000"`,
        $order: 'vigenciadesde ASC',
        // Socrata's default page is 1,000 rows — without this, Max silently stops in 1995.
        $limit: '50000',
      }).toString().replace(/\+/g, '%20');
      return C.parseTrm(await getJSON(`${TRM}?${q}`, 45000));
    };

    let out;
    if (from !== 'COP' && to !== 'COP') {
      out = { points: await fr(from, to), source: 'ECB daily fixings via Frankfurter' };
    } else {
      const cop = await trm(); // COP per USD
      const other = from === 'COP' ? to : from;
      const copIsTarget = to === 'COP';
      if (other === 'USD') {
        out = { points: copIsTarget ? cop : C.invertSeries(cop), source: 'Official TRM · Superintendencia Financiera' };
      } else {
        const copPerOther = C.crossSeries(cop, await fr('USD', other));
        out = { points: copIsTarget ? copPerOther : C.invertSeries(copPerOther), source: 'TRM × ECB cross' };
      }
    }
    if (out.points.length) seriesCache.set(key, out);
    return out;
  }

  // ------------------------------------------------------------------------
  // Keypad behaviour
  // ------------------------------------------------------------------------

  const MAX_UNDO = 30;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function snapCur() {
    S.undo.cur.push(clone(S.cur));
    if (S.undo.cur.length > MAX_UNDO) S.undo.cur.shift();
  }
  function snapCalc() {
    S.undo.calc.push({ calc: clone(S.calc), tape: clone(S.tape) });
    if (S.undo.calc.length > MAX_UNDO) S.undo.calc.shift();
  }

  const EDIT_KEYS = new Set(['AC', 'back', '00', '000', '.', '%', '+', '-', '×', '÷']);
  const STARTS_NEW = (k) => /^\d$/.test(k) || k === '00' || k === '000' || k === '.';

  /**
   * Currency tab. Keys apply at the cursor. After "=", digits start a new number (what
   * every phone calculator does) while operators chain off the result ("+10" on 200 → 210).
   */
  function keyCurrency(k) {
    const c = S.cur;
    if (k === '=') {
      const expr = C.trimTrailingOps(c.text);
      const v = C.evaluateLoose(expr);
      if (v == null) return;
      // Nothing new to record if "=" is pressed again on a result.
      if (c.isResult && c.steps.length && expr === C.formatNumberForExpression(c.steps[c.steps.length - 1].result)) return;
      snapCur();
      const rate = S.rates ? C.rateBetween(S.rates.rates, S.pair.from, S.pair.to) : null;
      if (rate != null) {
        S.history.unshift({
          id: newId(), expression: expr, result: v, from: S.pair.from, to: S.pair.to,
          converted: v * rate, rate, ts: Date.now(),
        });
        S.history.length = Math.min(S.history.length, MAX_HISTORY);
        store.set('history', S.history);
      }
      const text = C.formatNumberForExpression(v);
      S.cur = { text, pos: text.length, isResult: true, steps: [...c.steps, { expr, result: v, from: S.pair.from }] };
      return;
    }
    if (!EDIT_KEYS.has(k) && !/^\d$/.test(k)) return;
    if (k === 'AC') {
      if (c.text || c.steps.length) snapCur();
      S.cur = { text: '', pos: 0, isResult: false, steps: [] };
      return;
    }
    // A digit on a result starts a new calculation, so the old working goes — undoably.
    const fresh = c.isResult && STARTS_NEW(k);
    if (fresh) snapCur();
    const base = fresh ? { text: '', pos: 0 } : { text: c.text, pos: c.pos };
    const r = C.editAt(base.text, base.pos, k);
    S.cur = { text: r.text, pos: r.cur, isResult: false, steps: fresh ? [] : c.steps };
  }

  /**
   * Calculator tab — an adding-machine tape. Keys apply at the cursor. "=" commits the
   * line and clears the input (leaving "20" there would turn a typed "20+30" into
   * "2020+30"). A line tapped back open is rewritten in place and keeps its position.
   */
  function keyCalc(k) {
    const c = S.calc;
    if (k === '=') {
      const expr = C.trimTrailingOps(c.text);
      const v = C.evaluateLoose(expr);
      if (v == null) return;
      snapCalc();
      const existing = c.editingId != null && S.tape.find((e) => e.id === c.editingId);
      if (existing) {
        existing.expression = expr;
        existing.result = v;
      } else {
        S.tape.push({ id: newId(), expression: expr, result: v, ts: Date.now() });
        if (S.tape.length > MAX_TAPE) S.tape.splice(0, S.tape.length - MAX_TAPE);
        S.scrollTapeToEnd = true;
      }
      store.set('tape', S.tape);
      S.calc = { text: '', pos: 0, editingId: null };
      return;
    }
    if (!EDIT_KEYS.has(k) && !/^\d$/.test(k)) return;
    if (k === 'AC' && c.text) snapCalc();
    const r = C.editAt(c.text, c.pos, k);
    S.calc = { text: r.text, pos: r.cur, editingId: c.editingId };
  }

  /**
   * The expression as tappable characters with a cursor. Each raw character is its own
   * span tagged with its index; the display commas are separate, untagged spans, so a tap
   * on the "2" of "12,000" still lands on raw index 1.
   */
  function exprHTML(text, pos, placeholder) {
    if (!text) return placeholder;
    const commas = C.commaPositions(text);
    let h = '';
    for (let i = 0; i <= text.length; i++) {
      if (i === pos) h += '<span class="caret"></span>';
      if (i === text.length) break;
      if (commas.has(i)) h += '<span class="sep">,</span>';
      const ch = text[i] === '-' ? '−' : esc(text[i]);
      h += `<span data-i="${i}">${ch}</span>`;
    }
    return h;
  }

  /** The raw index a touch at (x, y) means: before or after the nearest character. */
  function indexAtPoint(el, x, y) {
    const spans = el.querySelectorAll('[data-i]');
    if (!spans.length) return 0;
    let best = null;
    let bestD = Infinity;
    for (const sp of spans) {
      const r = sp.getBoundingClientRect();
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const d = dy * 1000 + dx; // same line first, then nearest across it
      if (d < bestD) { bestD = d; best = { i: Number(sp.dataset.i), r }; }
    }
    return x < (best.r.left + best.r.right) / 2 ? best.i : best.i + 1;
  }

  /** Move the cursor without re-rendering the whole screen (keeps a drag smooth). */
  function placeCaret(which, pos) {
    const st = which === 'calc' ? S.calc : S.cur;
    if (st.pos === pos && !(which === 'cur' && st.isResult)) return;
    st.pos = pos;
    if (which === 'cur') st.isResult = false; // moving into a result means editing it
    const el = document.querySelector(`[data-caret="${which}"]`);
    if (el) el.innerHTML = exprHTML(st.text, pos, el.innerHTML);
  }

  function onKey(k) {
    if (S.tab === 'currency') keyCurrency(k);
    else if (S.tab === 'calc') keyCalc(k);
    renderView();
  }

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------

  function renderTop() {
    let html;
    if (S.tab === 'currency') {
      html = `
        <button class="title-btn" data-action="open-pair">${S.pair.from} → ${S.pair.to}${I.chevron}</button>
        <div class="spacer"></div>
        <button class="icon-btn" data-action="swap" aria-label="Swap currencies">${I.swap}</button>
        <button class="icon-btn" data-action="open-history" aria-label="History">${I.history}</button>`;
    } else if (S.tab === 'calc') {
      html = '<div class="title">Calculator</div><div class="spacer"></div>';
    } else {
      html = '<div class="title">Units</div><div class="spacer"></div>';
    }
    // The version sits beside ⓘ on every tab. It turns blue with a ↻ when a newer version
    // is waiting — tap it to load. No pop-ups either way: Julian asked for none.
    html += S.updateReady
      ? `<button class="ver ready" data-action="refresh-app" aria-label="Load version ${S.updateReady}">v${S.updateReady} ↻</button>`
      : `<button class="ver" data-action="open-about" aria-label="Version ${VERSION}, what's new">v${VERSION}</button>`;
    html += `<button class="icon-btn" data-action="open-about" aria-label="Version and what's new">${I.info}</button>`;
    $('#topbar').innerHTML = html;
    if (S.tab === 'currency') {
      const rl = document.querySelector('.rateline');
      if (rl) rl.outerHTML = renderRateLine();
    }
  }

  function renderRateLine() {
    const { from, to } = S.pair;
    const refreshBtn = `<button class="icon-btn sm ${S.refreshing ? 'spin' : ''}" data-action="refresh" aria-label="Refresh rates">${I.refresh}</button>`;
    if (!S.rates) {
      return `<div class="rateline"><span class="muted" style="padding:6px 4px">${S.refreshing ? 'Fetching rates…' : 'No rates yet — tap ↻'}</span><div class="spacer"></div>${refreshBtn}</div>`;
    }
    const rate = C.rateBetween(S.rates.rates, from, to);
    if (rate == null) {
      const missing = [from, to].filter((c) => !S.rates.rates[c]);
      return `<div class="rateline"><span class="err">No rate for ${missing.join(' or ')} today</span><div class="spacer"></div>${refreshBtn}</div>`;
    }
    // Both directions, the current one first: "¥100 = $0.634 · $1 = ¥157.63". Each is
    // quoted on the base people use (per 100 yen, per dollar), so neither reads as 0.0063.
    const quotes = `<span class="q">${esc(C.quoteText(from, to, rate))}</span>`
      + `<span class="q2">${esc(C.quoteText(to, from, 1 / rate))}</span>`;
    const prevRate = S.rates.prev ? C.rateBetween(S.rates.prev, from, to) : null;
    let move = '';
    if (prevRate) {
      // Direction from the PERCENTAGE — an absolute threshold can't span a 163.7 rate
      // and a 0.0061 one; it used to call a real move "unchanged".
      const pct = (rate - prevRate) / prevRate;
      const cls = pct > PCT_EPSILON ? 'up' : pct < -PCT_EPSILON ? 'down' : 'flat';
      const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '—';
      move = `<span class="${cls}">${arrow} ${Math.abs(pct * 100).toFixed(2)}% ${esc(from)}→${esc(to)}</span>`;
    }
    const stale = Date.now() - S.rates.refreshedAt > STALE_MS;
    let note = C.shortDate(S.rates.date);
    if (stale) note += ` · ${Math.max(1, Math.floor((Date.now() - S.rates.refreshedAt) / 864e5))}d old`;
    if (S.rates.source === 'ecb') note += ' · ECB';
    return `<div class="rateline">
      <button class="rate-main" data-action="open-chart">
        <span class="quotes">${quotes}</span>
        <span class="meta">${move}<span class="note ${stale ? 'stale' : ''}">${note}</span><span class="chev">chart ›</span></span>
      </button>${refreshBtn}</div>`;
  }

  function renderPins() {
    if (!S.pins.length) return '';
    const chips = S.pins.map((p) => `
      <div class="pinchip ${S.selected.includes(p.id) ? 'sel' : ''}" data-action="pin-toggle" data-long="pin-load" data-id="${p.id}">
        <div>
          ${/[+×÷]|.-/.test(p.expression) ? `<div class="p-expr">${esc(C.displayExpression(p.expression))}</div>` : ''}
          <div class="p-amt">${esc(C.formatAmount(p.amount, p.from))}</div>
          ${p.converted != null ? `<div class="p-conv">${esc(C.formatAmount(p.converted, p.to))}</div>` : ''}
        </div>
        <button class="x" data-action="pin-remove" data-id="${p.id}" aria-label="Remove pin">${I.close}</button>
      </div>`).join('');
    const clear = S.pins.length > 1 ? '<button class="text-btn" data-action="pins-clear">Clear</button>' : '';
    return `<div class="pins" data-keep-scroll="pins">${chips}${clear}</div>${renderComparison()}`;
  }

  /** Difference in both currencies plus the ratio: what you save, and whether it's a different league. */
  function renderComparison() {
    const chosen = S.selected.map((id) => S.pins.find((p) => p.id === id)).filter(Boolean);
    if (!chosen.length) return '';
    if (chosen.length < 2) return '<div class="hint">Tap another to compare · hold to load</div>';
    const [small, big] = [...chosen].sort((a, b) => a.amount - b.amount);
    if (small.from !== big.from) {
      return '<div class="compare"><span style="color:var(--down)">Pinned in different currencies — not comparable</span></div>';
    }
    let conv = '';
    if (small.converted != null && big.converted != null && small.to === big.to) {
      conv = `<span class="conv">· ${esc(C.formatAmount(big.converted - small.converted, big.to))}</span>`;
    }
    const ratio = small.amount !== 0 ? `<span class="muted">· ${(big.amount / small.amount).toFixed(2)}×</span>` : '';
    return `<div class="compare"><span class="muted">Difference</span><b>${esc(C.formatAmount(big.amount - small.amount, big.from))}</b>${conv}${ratio}</div>`;
  }

  function installHint() {
    const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (!iOS || navigator.standalone || store.get('installHintDismissed', false)) return '';
    return `<div class="install"><div>Install: tap <b>Share</b> → <b>Add to Home Screen</b>. It'll open full-screen and work offline.</div>
      <button class="x" data-action="dismiss-install" aria-label="Dismiss">${I.close}</button></div>`;
  }

  function renderCurrency() {
    const { from, to } = S.pair;
    const rate = S.rates ? C.rateBetween(S.rates.rates, from, to) : null;
    const preview = C.evaluateLoose(S.cur.text);
    let convHtml = '&nbsp;';
    let convCls = 'conv';
    if (preview != null && rate != null) convHtml = '≈ ' + esc(C.formatAmount(preview * rate, to));
    else if (preview != null && S.rates && rate == null) { convHtml = `no ${to} rate in today's table`; convCls += ' err'; }
    const chips = C.QUICK_PAIRS.map(([f, t]) =>
      `<button class="seg ${f === from && t === to ? 'on' : ''}" data-action="pair" data-from="${f}" data-to="${t}">${f} → ${t}</button>`).join('');
    // The big line always shows, in the currency being typed: it's the only thing on
    // screen saying whether 4800 means dollars or yen.
    return `
      ${installHint()}
      <div class="segs">${chips}</div>
      ${renderRateLine()}
      ${renderPins()}
      <div class="display">
        ${renderSteps(from)}
        ${renderWorkingLine()}
        <div class="big" data-fit="44">${preview != null ? esc(C.formatAmount(preview, from)) : '&nbsp;'}</div>
        <div class="conv-row">
          ${undoButton('cur')}
          <div class="${convCls}">${convHtml}</div>
          ${preview != null ? `<button class="pill" data-action="pin">${I.pin}Pin</button>` : ''}
        </div>
      </div>`;
  }

  /**
   * How the number on screen was reached. After "=", the line above the answer keeps the
   * sum that produced it ("12,548+300 =") instead of repeating the answer; carry on with
   * "+10 =" and the earlier step stays stacked above. Each is tappable to go back and edit.
   */
  function renderWorkingLine() {
    const c = S.cur;
    const last = c.steps[c.steps.length - 1];
    if (c.isResult && last) {
      return `<button class="expr working" data-action="step-load" data-idx="${c.steps.length - 1}" data-fit="26">${esc(C.displayExpression(last.expr))} =</button>`;
    }
    return `<div class="expr" data-caret="cur" data-fit="26">${exprHTML(c.text, c.pos, '&nbsp;')}</div>`;
  }

  function renderSteps() {
    const c = S.cur;
    const shown = c.isResult ? c.steps.slice(0, -1) : c.steps;
    if (!shown.length) return '';
    return `<div class="steps" id="steps">${shown.map((st, i) => `
      <button class="step" data-action="step-load" data-idx="${i}">
        <span class="s-expr">${esc(C.displayExpression(st.expr))} =</span>
        <span class="s-res">${esc(C.formatAmount(st.result, st.from))}</span>
      </button>`).join('')}</div>`;
  }

  function undoButton(tab) {
    if (!S.undo[tab].length) return '';
    return `<button class="undo" data-action="undo" aria-label="Undo">${I.undo}Undo</button>`;
  }

  function renderCalc() {
    const preview = C.evaluateLoose(S.calc.text);
    const hasOp = /[+×÷]|.-/.test(C.trimTrailingOps(S.calc.text));
    const lines = S.tape.map((e) => `
      <div class="tape-line ${S.calc.editingId === e.id ? 'editing' : ''}" data-action="tape-edit" data-id="${e.id}">
        <div class="t-expr">${esc(C.displayExpression(e.expression))}</div>
        <div class="t-res">${esc(C.formatPlainNumber(e.result))}</div>
        <button class="x" data-action="tape-delete" data-id="${e.id}" aria-label="Delete line">${I.close}</button>
      </div>`).join('');
    const n = S.tape.length;
    return `
      <div class="tape-head"><span class="muted">${n} line${n === 1 ? '' : 's'}</span><div class="spacer"></div>
        ${n ? '<button class="text-btn" data-action="tape-clear">Clear</button>' : ''}</div>
      <div class="tape" id="tape">${lines || '<div class="empty">Press = and each result stacks up here.<br>Tap a line to fix it.</div>'}</div>
      ${S.calc.editingId != null ? '<div class="editing-bar"><span>Editing a line — = saves it</span><button class="text-btn" data-action="tape-cancel">Cancel</button></div>' : ''}
      <div class="display calc">
        <div class="expr" data-caret="calc" data-fit="38">${exprHTML(S.calc.text, S.calc.pos, '0')}</div>
        <div class="calc-row">${undoButton('calc')}<div class="preview">${preview != null && hasOp ? '= ' + esc(C.formatPlainNumber(preview)) : ''}</div></div>
      </div>`;
  }

  function unitOptions(list, sel) {
    return list.map((x) => `<option value="${x.code}" ${x.code === sel ? 'selected' : ''}>${esc(x.name)} (${esc(x.symbol)})</option>`).join('');
  }

  function unitResult() {
    const u = S.units;
    const list = C.UNITS[u.cat];
    const from = list.find((x) => x.code === u.from) || list[0];
    const to = list.find((x) => x.code === u.to) || list[1];
    const v = parseFloat(String(u.value).replace(/,/g, ''));
    if (!Number.isFinite(v)) return '—';
    return `${C.formatPlainNumber(C.convertUnits(v, from, to))} ${esc(to.symbol)}`;
  }

  function renderUnits() {
    const u = S.units;
    const list = C.UNITS[u.cat];
    const cats = Object.keys(C.UNITS).map((c) =>
      `<button class="chip ${c === u.cat ? 'on' : ''}" data-action="unit-cat" data-cat="${c}">${c}</button>`).join('');
    return `
      <div class="chips">${cats}</div>
      <div class="unit-card"><label>From</label>
        <select data-change="unit-from">${unitOptions(list, u.from)}</select>
        <input id="unit-in" inputmode="decimal" autocomplete="off" value="${esc(u.value)}" aria-label="Value to convert">
      </div>
      <button class="swap-mid" data-action="unit-swap" aria-label="Swap units">${I.swapV}</button>
      <div class="unit-card"><label>To</label>
        <select data-change="unit-to">${unitOptions(list, u.to)}</select>
        <div class="unit-out" id="unit-out">${unitResult()}</div>
      </div>`;
  }

  /**
   * Keys fill the height the screen has left. They were a fixed ~62px, so every iPhone
   * taller than the smallest one showed the spare height as dead space above the pad.
   *
   * Measured rather than guessed: everything above the pad that must stay visible (chips,
   * rate line, pins and the comparison, the tape's header) is taken at its real height,
   * the part that can flex (the display, the tape) is held at a floor, and the keys get
   * the rest — clamped so they never go below a comfortable tap target or grow absurd on
   * an iPad. Re-run on every render because pinning or un-pinning changes the budget.
   */
  const KEY_MIN = 52;
  const KEY_MAX = 88;
  const DISPLAY_FLOOR = 128; // expression + currency amount + conversion line
  const TAPE_FLOOR = 150; // about three tape lines
  const DISPLAY_COMPACT = 104; // the same three lines at the smaller type below
  const KEY_COMFORT = 68; // below this, shrink the display instead of the keys

  function sizePad() {
    const pad = $('#pad');
    if (pad.hidden) return;
    const app = $('#app');
    const avail = app.clientHeight - parseFloat(getComputedStyle(app).paddingTop)
      - $('#topbar').offsetHeight - $('#tabs').offsetHeight;
    let need = 0;
    for (const el of $('#view').children) {
      const cs = getComputedStyle(el);
      const margins = parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      if (el.id === 'tape') need += TAPE_FLOOR;
      else if (el.classList.contains('display') && !el.classList.contains('calc')) {
        const steps = el.querySelector('.steps');
        need += DISPLAY_FLOOR + (steps ? steps.offsetHeight : 0);
      }
      else need += el.offsetHeight + margins;
    }
    const pcs = getComputedStyle(pad);
    const chrome = parseFloat(pcs.paddingTop) + parseFloat(pcs.paddingBottom) + 4 * parseFloat(pcs.rowGap || 8);
    const hasDisplay = !!document.querySelector('#view > .display:not(.calc)');
    let keyH = Math.floor((avail - need - chrome) / 5);
    // Short on room (pins and a comparison open)? The display gives up size before the
    // keys do — a smaller readout is still readable; a small key is a missed tap.
    const compact = hasDisplay && keyH < KEY_COMFORT;
    if (compact) keyH += Math.floor((DISPLAY_FLOOR - DISPLAY_COMPACT) / 5);
    app.classList.toggle('compact', compact);
    const clamped = Math.max(KEY_MIN, Math.min(KEY_MAX, keyH));
    document.documentElement.style.setProperty('--key-h', clamped + 'px');
  }

  /**
   * Shrink a line's font until it fits its box, so long amounts never clip. An expression
   * that still doesn't fit at a readable size wraps onto a second line instead of being
   * cut off — every digit has to stay visible now that any of them can be tapped.
   */
  function fitText() {
    const compact = $('#app').classList.contains('compact');
    document.querySelectorAll('[data-fit]').forEach((el) => {
      const max = parseFloat(el.dataset.fit) * (compact ? 0.75 : 1);
      const wraps = el.hasAttribute('data-caret');
      const floor = wraps ? 20 : 16;
      el.style.whiteSpace = 'nowrap';
      el.style.wordBreak = '';
      let size = max;
      el.style.fontSize = size + 'px';
      const box = el.parentElement.clientWidth - 12;
      while (el.scrollWidth > box && size > floor) {
        size -= 2;
        el.style.fontSize = size + 'px';
      }
      if (wraps && el.scrollWidth > box) {
        el.style.whiteSpace = 'normal';
        el.style.wordBreak = 'break-all';
      }
    });
  }

  function renderView() {
    // Horizontal strips keep their scroll position across re-renders.
    const kept = {};
    document.querySelectorAll('[data-keep-scroll]').forEach((el) => { kept[el.dataset.keepScroll] = el.scrollLeft; });
    const tapeEl = document.getElementById('tape');
    const tapeTop = tapeEl ? tapeEl.scrollTop : 0;

    const v = $('#view');
    v.innerHTML = S.tab === 'currency' ? renderCurrency() : S.tab === 'calc' ? renderCalc() : renderUnits();

    document.querySelectorAll('[data-keep-scroll]').forEach((el) => {
      if (kept[el.dataset.keepScroll] != null) el.scrollLeft = kept[el.dataset.keepScroll];
    });
    const t = document.getElementById('tape');
    if (t) {
      if (S.scrollTapeToEnd) { t.scrollTop = t.scrollHeight; S.scrollTapeToEnd = false; }
      else t.scrollTop = tapeTop;
    }
    const steps = document.getElementById('steps');
    if (steps) steps.scrollTop = steps.scrollHeight;
    sizePad();
    fitText();
  }

  function renderPad() {
    const pad = $('#pad');
    pad.hidden = S.tab === 'units';
    if (pad.dataset.built) return;
    pad.dataset.built = '1';
    const k = (key, label, cls) => `<button class="key ${cls || ''}" data-key="${key}">${label}</button>`;
    pad.innerHTML = `
      <div class="krow">${k('AC', 'AC', 'ac')}<button class="key ac" data-key="back" data-long="key-clear" aria-label="Backspace, hold to clear">${I.backspace}</button>${k('÷', '÷', 'op')}${k('×', '×', 'op')}</div>
      <div class="krow">${k('7', '7')}${k('8', '8')}${k('9', '9')}${k('-', '−', 'op')}</div>
      <div class="krow">${k('4', '4')}${k('5', '5')}${k('6', '6')}${k('+', '+', 'op')}</div>
      <div class="krow">${k('1', '1')}${k('2', '2')}${k('3', '3')}${k('%', '%', 'op')}</div>
      <div class="krow five">${k('0', '0')}${k('00', '00', 'small')}${k('000', '000', 'small')}${k('.', '.')}${k('=', '=', 'eq')}</div>`;
  }

  function renderTabs() {
    const t = (key, icon, label) =>
      `<button class="tab ${S.tab === key ? 'on' : ''}" data-action="tab" data-tab="${key}"><span class="ic">${icon}</span>${label}</button>`;
    $('#tabs').innerHTML = t('currency', I.currency, 'Currency') + t('calc', I.calc, 'Calculator') + t('units', I.ruler, 'Units');
  }

  function render() {
    renderTop();
    renderView();
    renderPad();
    renderTabs();
    sizePad();
    fitText();
    if (S.sheet) renderSheet();
  }

  // ------------------------------------------------------------------------
  // Sheets
  // ------------------------------------------------------------------------

  function renderSheet() {
    const w = $('#sheet');
    if (!S.sheet) { w.hidden = true; w.innerHTML = ''; return; }
    let body = '';
    if (S.sheet === 'pair') {
      const opts = (sel) => C.CURRENCIES.map((c) =>
        `<option value="${c.code}" ${c.code === sel ? 'selected' : ''}>${c.code} — ${esc(c.name)}</option>`).join('');
      body = `<h2>Currency pair</h2>
        <div class="pair-row">
          <div class="field"><label>From</label><select data-change="pair-from">${opts(S.pair.from)}</select></div>
          <button class="icon-btn" data-action="swap" aria-label="Swap">${I.swap}</button>
          <div class="field"><label>To</label><select data-change="pair-to">${opts(S.pair.to)}</select></div>
        </div>`;
    } else if (S.sheet === 'about') {
      const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const rel = RELEASES.map((r) => `
        <div class="rel">
          <div class="rel-head"><b>Version ${esc(r.version)}</b>${r.version === VERSION ? '<span class="now">this version</span>' : ''}<span class="muted">${fmtDate(r.date)}</span></div>
          <ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </div>`).join('');
      const rates = S.rates
        ? `${S.rates.source === 'ecb' ? 'ECB (fallback — no COP)' : 'jsDelivr currency-api'} · ${esc(C.shortDate(S.rates.date))}`
        : 'not fetched yet';
      body = `<div class="about-head"><div class="about-v">Version ${esc(VERSION)}</div>
          <div class="muted">Released ${fmtDate(RELEASES[0].date)} · rates: ${rates}</div></div>
        <h2>What's new</h2>${rel}`;
    } else if (S.sheet === 'history') {
      const items = S.history.map((h) => `
        <div class="hist-item" data-action="history-load" data-id="${h.id}">
          <div class="h-expr">${esc(C.displayExpression(h.expression))} =</div>
          <div class="h-amt">${esc(C.formatAmount(h.result, h.from))}</div>
          <div class="h-row"><span class="h-conv">≈ ${esc(C.formatAmount(h.converted, h.to))}</span>
            <span class="h-time">${new Date(h.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
        </div>`).join('');
      body = `<h2>History ${S.history.length ? '<button class="text-btn" data-action="history-clear">Clear</button>' : ''}</h2>
        ${items || '<div class="empty">Every = you press lands here.</div>'}`;
    }
    // An explicit ✕ on every sheet. Dismissing used to rely on tapping the dimmed backdrop,
    // and iPhone Safari doesn't deliver taps on a plain element to a document-level
    // listener — so on the phone the ⓘ screen could be opened but never closed.
    w.innerHTML = `<div class="sheet" role="dialog">
      <button class="sheet-close" data-action="close-sheet" aria-label="Close">${I.close}</button>
      <div class="grab" data-action="close-sheet"></div>${body}</div>`;
    w.hidden = false;
  }

  function openSheet(name) { S.sheet = name; renderSheet(); }
  function closeSheet() { S.sheet = null; renderSheet(); }

  // ------------------------------------------------------------------------
  // Chart
  // ------------------------------------------------------------------------

  async function openChart() {
    if (!S.rates) return;
    S.chart = { range: store.get('chartRange', '1M'), data: null, loading: true, error: null, scrub: null };
    $('#chart').hidden = false;
    renderChart();
    loadChart();
  }

  async function loadChart() {
    const c = S.chart;
    const want = `${S.pair.from}|${S.pair.to}|${c.range}`;
    c.loading = true; c.error = null; c.scrub = null;
    renderChart();
    try {
      const data = await fetchSeries(S.pair.from, S.pair.to, c.range);
      if (!S.chart || `${S.pair.from}|${S.pair.to}|${S.chart.range}` !== want) return; // superseded
      S.chart.data = data.points.length >= 2 ? data : null;
      S.chart.error = data.points.length >= 2 ? null : 'Not enough history for this pair';
    } catch (_) {
      if (!S.chart) return;
      S.chart.error = navigator.onLine === false ? 'Offline — history needs a connection' : "Couldn't load history";
    }
    if (S.chart) { S.chart.loading = false; renderChart(); }
  }

  function renderChart() {
    const c = S.chart;
    const el = $('#chart');
    if (!c) { el.hidden = true; el.innerHTML = ''; return; }
    const { from, to } = S.pair;
    const pills = C.RANGES.map((r) =>
      `<button class="chip ${r.key === c.range ? 'on' : ''}" data-action="chart-range" data-range="${r.key}">${r.key}</button>`).join('');

    let readout = '';
    let plot = `<div class="center">${c.loading ? 'Loading…' : ''}</div>`;
    let stats = '';
    let source = '';
    if (c.error) plot = `<div class="center err">${esc(c.error)}</div>`;
    if (c.data) {
      const pts = C.downsample(c.data.points, 400);
      c.pts = pts;
      const st = C.seriesStats(c.data.points);
      // Same quote base as the rate line, so the chart and the line agree: a yen chart
      // reads in "per 100 JPY", not in 0.0061s.
      const base = C.quoteFor(st.last).baseUnits;
      c.base = base;
      const fq = (v) => C.formatQuoteValue({ baseUnits: base, value: v * base });
      const baseLabel = base === 1 ? '1' : base.toLocaleString('en-US');
      const shown = c.scrub != null ? pts[c.scrub] : pts[pts.length - 1];
      const rising = st.change >= 0;
      const dateLabel = new Date(shown.d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const changeHtml = c.scrub == null
        ? `<span class="${rising ? 'up' : 'down'}">${rising ? '▲' : '▼'} ${C.formatRateDelta(st.change * base, st.last * base)} (${Math.abs((st.changePct || 0) * 100).toFixed(2)}%) over ${c.range}</span>`
        : '';
      readout = `<div class="readout"><div class="val">${baseLabel} ${from} = ${fq(shown.v)} ${to}</div>
        <div class="sub"><span>${dateLabel}</span>${changeHtml}</div></div>`;
      plot = '';
      stats = `<div class="stats">
        <div><div class="k">Low</div><div class="v">${fq(st.low)}</div></div>
        <div><div class="k">High</div><div class="v">${fq(st.high)}</div></div>
        <div><div class="k">Then</div><div class="v">${fq(st.first)}</div></div>
        <div><div class="k">Now</div><div class="v">${fq(st.last)}</div></div></div>`;
      source = `<div class="source">${c.data.points.length.toLocaleString('en-US')} daily closes · ${esc(c.data.source)}${base > 1 ? ` · per ${baseLabel} ${from}` : ''}</div>`;
    }
    el.innerHTML = `
      <div class="chart-top">
        <button class="icon-btn" data-action="chart-close" aria-label="Back">${I.back}</button>
        <div class="title">${from} → ${to}</div><div class="spacer"></div>
        <button class="icon-btn" data-action="chart-refresh" aria-label="Reload history">${I.refresh}</button>
      </div>
      <div class="chart-body">
        <div class="ranges">${pills}</div>
        ${readout}
        <div class="plot" id="plot">${plot}</div>
        ${stats}${source}
      </div>`;
    if (c.data) requestAnimationFrame(drawPlot);
  }

  /** The plot, as SVG with real text axes: y at low/mid/high, x at five dated ticks. */
  function drawPlot() {
    const c = S.chart;
    const host = document.getElementById('plot');
    if (!c || !c.pts || !host) return;
    const pts = c.pts;
    const W = host.clientWidth;
    const H = host.clientHeight;
    if (!W || !H) return;
    const padL = 54;
    const padR = 6;
    const padT = 10;
    const padB = 24;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    const vals = pts.map((p) => p.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || Math.abs(max) * 0.01 || 1;
    const x = (i) => padL + (pw * i) / (pts.length - 1);
    const y = (v) => padT + ph * (1 - (v - min) / span);
    const rising = vals[vals.length - 1] >= vals[0];
    const color = rising ? 'var(--up)' : 'var(--down)';
    const base = c.base || 1;
    const fy = (v) => C.formatQuoteValue({ baseUnits: base, value: v * base });

    let line = '';
    pts.forEach((p, i) => { line += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`; });
    const area = `${line}L${x(pts.length - 1).toFixed(1)},${padT + ph}L${padL},${padT + ph}Z`;

    const grid = [max, (min + max) / 2, min].map((v) =>
      `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#ffffff1a"/>
       <text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${fy(v)}</text>`).join('');
    const ticks = C.axisLabels(pts, c.range).map(({ i, label }, k, all) => {
      const anchor = k === 0 ? 'start' : k === all.length - 1 ? 'end' : 'middle';
      return `<line x1="${x(i)}" x2="${x(i)}" y1="${padT + ph}" y2="${padT + ph + 4}" stroke="#ffffff40"/>
        <text x="${x(i)}" y="${H - 4}" text-anchor="${anchor}" fill="var(--muted)" font-size="11">${label}</text>`;
    }).join('');

    let cross = '';
    if (c.scrub != null) {
      const i = c.scrub;
      cross = `<line x1="${x(i)}" x2="${x(i)}" y1="${padT}" y2="${padT + ph}" stroke="#ffffff90" stroke-dasharray="4 4"/>
        <circle cx="${x(i)}" cy="${y(pts[i].v)}" r="6" fill="var(--bg)" stroke="${color}" stroke-width="3"/>`;
    }
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${rising ? '#3dbb72' : '#e0574c'}" stop-opacity="0.28"/>
        <stop offset="1" stop-color="${rising ? '#3dbb72' : '#e0574c'}" stop-opacity="0"/></linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#fill)"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
      ${ticks}${cross}</svg>`;
    host.dataset.padl = padL;
    host.dataset.pw = pw;
  }

  function scrubAt(clientX) {
    const c = S.chart;
    const host = document.getElementById('plot');
    if (!c || !c.pts || !host) return;
    const r = host.getBoundingClientRect();
    const f = (clientX - r.left - Number(host.dataset.padl)) / Number(host.dataset.pw);
    const i = Math.max(0, Math.min(c.pts.length - 1, Math.round(f * (c.pts.length - 1))));
    if (i !== c.scrub) {
      c.scrub = i;
      // Only the readout and the plot change while dragging.
      const shown = c.pts[i];
      const val = document.querySelector('.readout .val');
      const sub = document.querySelector('.readout .sub');
      if (val) val.textContent = `${c.base === 1 ? '1' : c.base.toLocaleString('en-US')} ${S.pair.from} = ${C.formatQuoteValue({ baseUnits: c.base, value: shown.v * c.base })} ${S.pair.to}`;
      if (sub) sub.innerHTML = `<span>${new Date(shown.d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
      drawPlot();
    }
  }

  function endScrub() {
    if (S.chart && S.chart.scrub != null) { S.chart.scrub = null; renderChart(); }
  }

  // ------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms || 1800);
  }

  function setPair(from, to) {
    S.pair = { from, to };
    store.set('pair', S.pair);
    S.cur.isResult = false;
    render();
  }

  const actions = {
    tab(el) { S.tab = el.dataset.tab; store.set('tab', S.tab); render(); },
    pair(el) { setPair(el.dataset.from, el.dataset.to); },
    swap() { setPair(S.pair.to, S.pair.from); },
    refresh() { refreshRates(true); },
    'open-pair'() { openSheet('pair'); },
    'open-history'() { openSheet('history'); },
    'open-about'() { openSheet('about'); },
    'refresh-app'() { location.reload(); },
    'close-sheet'() { closeSheet(); },
    'open-chart'() { openChart(); },
    'dismiss-install'() { store.set('installHintDismissed', true); renderView(); },
    pin() {
      const v = C.evaluateLoose(S.cur.text);
      if (v == null) return;
      const rate = S.rates ? C.rateBetween(S.rates.rates, S.pair.from, S.pair.to) : null;
      // The pin keeps the pair it was taken with, so changing the pair later can't
      // relabel a number computed at a different rate.
      S.pins.push({
        // After "=", pin the sum that produced the answer, not the bare answer.
        id: newId(),
        expression: S.cur.isResult && S.cur.steps.length ? S.cur.steps[S.cur.steps.length - 1].expr : C.trimTrailingOps(S.cur.text),
        amount: v,
        from: S.pair.from, to: S.pair.to, converted: rate != null ? v * rate : null, ts: Date.now(),
      });
      if (S.pins.length > MAX_PINS) S.pins.splice(0, S.pins.length - MAX_PINS);
      store.set('pins', S.pins);
      toast('Pinned');
      renderView();
      const strip = document.querySelector('.pins');
      if (strip) strip.scrollLeft = strip.scrollWidth;
    },
    'pin-toggle'(el) {
      const id = Number(el.dataset.id);
      const s = S.selected;
      if (s.includes(id)) S.selected = s.filter((x) => x !== id);
      else if (s.length < 2) S.selected = [...s, id];
      else S.selected = [s[1], id]; // a third replaces the older, so it never gets stuck
      renderView();
    },
    'pin-remove'(el) {
      const id = Number(el.dataset.id);
      S.pins = S.pins.filter((p) => p.id !== id);
      S.selected = S.selected.filter((x) => x !== id);
      store.set('pins', S.pins);
      renderView();
    },
    'pins-clear'() { S.pins = []; S.selected = []; store.set('pins', S.pins); renderView(); },
    'tape-edit'(el) {
      const e = S.tape.find((x) => x.id === Number(el.dataset.id));
      if (!e) return;
      S.calc = { text: e.expression, pos: e.expression.length, editingId: e.id };
      renderView();
    },
    undo() {
      if (S.tab === 'calc') {
        const snap = S.undo.calc.pop();
        if (!snap) return;
        S.calc = snap.calc;
        S.tape = snap.tape;
        store.set('tape', S.tape);
      } else {
        const snap = S.undo.cur.pop();
        if (!snap) return;
        S.cur = snap;
      }
      renderView();
    },
    'step-load'(el) {
      const i = Number(el.dataset.idx);
      const st = S.cur.steps[i];
      if (!st) return;
      snapCur();
      // Back to that sum, ready to edit; the steps after it are dropped (and undoable).
      S.cur = { text: st.expr, pos: st.expr.length, isResult: false, steps: S.cur.steps.slice(0, i) };
      renderView();
    },
    'tape-delete'(el) {
      snapCalc();
      const id = Number(el.dataset.id);
      S.tape = S.tape.filter((x) => x.id !== id);
      if (S.calc.editingId === id) S.calc = { text: '', pos: 0, editingId: null };
      store.set('tape', S.tape);
      renderView();
    },
    'tape-clear'() {
      if (!confirm('Clear all tape lines?')) return;
      snapCalc();
      S.tape = []; S.calc = { text: '', pos: 0, editingId: null }; store.set('tape', S.tape); renderView();
    },
    'tape-cancel'() { S.calc = { text: '', pos: 0, editingId: null }; renderView(); },
    'unit-cat'(el) {
      const cat = el.dataset.cat;
      const [f, t] = C.UNIT_DEFAULTS[cat];
      S.units = { cat, from: f, to: t, value: S.units.value };
      store.set('units', S.units);
      renderView();
    },
    'unit-swap'() {
      S.units = { ...S.units, from: S.units.to, to: S.units.from };
      store.set('units', S.units);
      renderView();
    },
    'history-load'(el) {
      const h = S.history.find((x) => x.id === Number(el.dataset.id));
      if (!h) return;
      S.pair = { from: h.from, to: h.to };
      store.set('pair', S.pair);
      S.cur = { text: h.expression, pos: h.expression.length, isResult: false, steps: [] };
      closeSheet();
      render();
    },
    'history-clear'() {
      if (!confirm('Clear history?')) return;
      S.history = []; store.set('history', S.history); renderSheet();
    },
    'chart-close'() { S.chart = null; renderChart(); },
    'chart-range'(el) { S.chart.range = el.dataset.range; store.set('chartRange', S.chart.range); loadChart(); },
    'chart-refresh'() {
      for (const k of [...seriesCache.keys()]) if (k.startsWith(`${S.pair.from}|${S.pair.to}|`)) seriesCache.delete(k);
      loadChart();
    },
  };

  const longActions = {
    'pin-load'(el) {
      const p = S.pins.find((x) => x.id === Number(el.dataset.id));
      if (!p) return;
      S.pair = { from: p.from, to: p.to };
      store.set('pair', S.pair);
      S.cur = { text: p.expression, pos: p.expression.length, isResult: false, steps: [] };
      render();
      toast('Loaded');
    },
    'key-clear'() { onKey('AC'); },
  };

  // Long-press: 450 ms hold fires the long action and swallows the click that follows.
  let longTimer = null;
  let swallowClick = false;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-long]');
    if (!el) return;
    clearTimeout(longTimer);
    longTimer = setTimeout(() => {
      swallowClick = true;
      if (navigator.vibrate) navigator.vibrate(15);
      longActions[el.dataset.long](el);
    }, 450);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) =>
    document.addEventListener(t, () => clearTimeout(longTimer), true));
  document.addEventListener('scroll', () => clearTimeout(longTimer), true);

  document.addEventListener('click', (e) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const key = e.target.closest('[data-key]');
    if (key) { onKey(key.dataset.key); return; }
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) { actions[el.dataset.action](el, e); return; }
    if (e.target.id === 'sheet') closeSheet(); // tap on the dimmed backdrop
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const v = el.value;
    switch (el.dataset.change) {
      case 'pair-from': setPair(v, S.pair.to); break;
      case 'pair-to': setPair(S.pair.from, v); break;
      case 'unit-from': S.units = { ...S.units, from: v }; store.set('units', S.units); renderView(); break;
      case 'unit-to': S.units = { ...S.units, to: v }; store.set('units', S.units); renderView(); break;
      default:
    }
  });

  // Typing into the units field updates only the result — re-rendering would drop focus.
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'unit-in') return;
    S.units = { ...S.units, value: e.target.value };
    store.set('units', S.units);
    const out = document.getElementById('unit-out');
    if (out) out.innerHTML = unitResult();
  });

  // Cursor: touch the number to put the cursor there; keep the finger down and slide to
  // fine-tune. Pointer events rather than click, which iPhone Safari won't deliver on a
  // plain element — the same trap that made the ⓘ screen impossible to close.
  let caretDrag = null;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-caret]');
    if (!el) return;
    const st = el.dataset.caret === 'calc' ? S.calc : S.cur;
    if (!st.text) return;
    caretDrag = el.dataset.caret;
    placeCaret(caretDrag, indexAtPoint(el, e.clientX, e.clientY));
  });
  document.addEventListener('pointermove', (e) => {
    if (!caretDrag) return;
    const el = document.querySelector(`[data-caret="${caretDrag}"]`);
    if (el) placeCaret(caretDrag, indexAtPoint(el, e.clientX, e.clientY));
  });
  ['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => { caretDrag = null; }));

  // Chart scrubbing: touch and drag anywhere on the plot.
  let scrubbing = false;
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#plot')) return;
    scrubbing = true;
    scrubAt(e.clientX);
  });
  document.addEventListener('pointermove', (e) => { if (scrubbing) scrubAt(e.clientX); });
  ['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => {
    if (scrubbing) { scrubbing = false; endScrub(); }
  }));

  window.addEventListener('resize', () => { sizePad(); fitText(); if (S.chart && S.chart.data) drawPlot(); });

  // Refresh when the app comes back to the foreground with a stale table.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!S.rates || Date.now() - S.rates.refreshedAt > AUTO_REFRESH_MS)) {
      refreshRates(false);
    }
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(VERSION), { updateViaCache: 'none' })
      .catch(() => { /* offline shell unavailable */ });
  }

  /**
   * iPhone resumes a home-screen app rather than reloading it, so a new version would only
   * arrive after a full close-and-reopen. On every return to the app, ask the server what
   * the current version is. (The service worker's own update check can't do this: its
   * script is identical across releases — the version reaches it on the URL — so the
   * browser never sees a change.)
   *
   * If nothing is in progress, reload straight into the new version. If a calculation is
   * half-typed or a screen is open, don't throw that away: flag it on the version line and
   * let the reload happen on a tap.
   */
  async function checkForUpdate() {
    if (location.protocol !== 'https:') return;
    try {
      const r = await fetch('version.js', { cache: 'no-store' });
      const m = (await r.text()).match(/const VERSION = (\d+);/);
      const latest = m ? Number(m[1]) : null;
      if (!latest || latest <= VERSION) return;
      const idle = !S.cur.text && !S.calc.text && !S.sheet && !S.chart;
      if (idle) { location.reload(); return; }
      if (S.updateReady !== latest) {
        S.updateReady = latest;
        renderTop();
      }
    } catch (_) { /* offline — try again next time */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });

  render();
  refreshRates(false);

})();
