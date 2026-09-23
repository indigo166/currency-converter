/*
 * core.js — the app's pure logic: calculator engine, keypad editing, formatting,
 * rate parsing, history-series maths, unit tables. No DOM, no network.
 *
 * Loaded two ways: by the page as a classic script (exposes window.Core), and by the
 * tests under Node (module.exports). Keeping it free of the browser is what makes the
 * fiddly parts — percent handling, quote bases, aligning two holiday calendars —
 * testable without a phone.
 *
 * Ported from the Android app (Currency Converter Calculator, Kotlin/Compose). Where a
 * rule has a reason, the reason came across with it.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Currencies
  // ---------------------------------------------------------------------------

  /**
   * The curated picker list. Deliberately NOT "whatever the rate API returns": the
   * primary source serves ~338 entries including crypto, which would make the picker
   * useless. Every fetched table is filtered down to these codes, so adding a currency
   * is one line here.
   */
  const CURRENCIES = [
    ['AUD', 'Australian Dollar'], ['BGN', 'Bulgarian Lev'], ['BRL', 'Brazilian Real'],
    ['CAD', 'Canadian Dollar'], ['CHF', 'Swiss Franc'], ['CNY', 'Chinese Yuan'],
    ['COP', 'Colombian Peso'], ['CZK', 'Czech Koruna'], ['DKK', 'Danish Krone'],
    ['EUR', 'Euro'], ['GBP', 'British Pound'], ['HKD', 'Hong Kong Dollar'],
    ['HUF', 'Hungarian Forint'], ['IDR', 'Indonesian Rupiah'], ['ILS', 'Israeli Shekel'],
    ['INR', 'Indian Rupee'], ['ISK', 'Icelandic Króna'], ['JPY', 'Japanese Yen'],
    ['KRW', 'South Korean Won'], ['MXN', 'Mexican Peso'], ['MYR', 'Malaysian Ringgit'],
    ['NOK', 'Norwegian Krone'], ['NZD', 'New Zealand Dollar'], ['PHP', 'Philippine Peso'],
    ['PLN', 'Polish Złoty'], ['RON', 'Romanian Leu'], ['SEK', 'Swedish Krona'],
    ['SGD', 'Singapore Dollar'], ['THB', 'Thai Baht'], ['TRY', 'Turkish Lira'],
    ['USD', 'US Dollar'], ['ZAR', 'South African Rand'],
  ].map(([code, name]) => ({ code, name }));

  const CODES = new Set(CURRENCIES.map((c) => c.code));

  /** The pairs actually used — one tap each. The long tail lives behind the title. */
  const QUICK_PAIRS = [['USD', 'JPY'], ['JPY', 'USD'], ['USD', 'COP'], ['COP', 'USD']];

  // ---------------------------------------------------------------------------
  // Calculator engine — + − × ÷ with normal precedence, left-associative
  // ---------------------------------------------------------------------------

  class CalcError extends Error {}

  const OPS = '+-×÷';
  const NUM_RE = /^(\d+\.?\d*|\.\d+)$/;
  const isNumChar = (c) => (c >= '0' && c <= '9') || c === '.';

  function evaluate(expr) {
    const s = String(expr)
      .replace(/\*/g, '×').replace(/\//g, '÷').replace(/−/g, '-').replace(/\s+/g, '');
    if (!s) throw new CalcError('empty expression');

    const toks = [];
    let i = 0;
    // parseFloat("1.2.3") is 1.2 — validate the whole token so a malformed number is an
    // error rather than a silently different number.
    const readNum = () => {
      const st = i;
      while (i < s.length && isNumChar(s[i])) i++;
      const n = s.slice(st, i);
      if (!NUM_RE.test(n)) throw new CalcError(`bad number '${n}'`);
      return parseFloat(n);
    };
    while (i < s.length) {
      const c = s[i];
      const afterOp = toks.length === 0 || toks[toks.length - 1].op !== undefined;
      if (isNumChar(c)) {
        toks.push({ num: readNum() });
      } else if (c === '-' && afterOp) {
        i++;
        if (i >= s.length || !isNumChar(s[i])) throw new CalcError("dangling '-'");
        toks.push({ num: -readNum() });
      } else if (OPS.includes(c)) {
        toks.push({ op: c });
        i++;
      } else {
        throw new CalcError(`unexpected '${c}'`);
      }
    }

    const p1 = [];
    for (let j = 0; j < toks.length; j++) {
      const t = toks[j];
      if (t.op === '×' || t.op === '÷') {
        const left = p1.pop();
        const right = toks[j + 1];
        if (!left || left.num === undefined) throw new CalcError('operator without left operand');
        if (!right || right.num === undefined) throw new CalcError('operator without right operand');
        if (t.op === '÷' && right.num === 0) throw new CalcError('divide by zero');
        p1.push({ num: t.op === '×' ? left.num * right.num : left.num / right.num });
        j++;
      } else {
        p1.push(t);
      }
    }
    if (!p1.length || p1[0].num === undefined) throw new CalcError('no leading number');
    let acc = p1[0].num;
    for (let j = 1; j < p1.length; j += 2) {
      const op = p1[j];
      const rhs = p1[j + 1];
      if (op.op === undefined) throw new CalcError('expected operator');
      if (!rhs || rhs.num === undefined) throw new CalcError(`dangling operator '${op.op}'`);
      acc = op.op === '+' ? acc + rhs.num : acc - rhs.num;
    }
    return acc;
  }

  function trimTrailingOps(text) {
    let e = text.length;
    while (e > 0 && OPS.includes(text[e - 1])) e--;
    return text.slice(0, e);
  }

  /** Live preview: "100+" still previews 100. Null when there's nothing valid to show. */
  function evaluateLoose(text) {
    const t = trimTrailingOps(text || '');
    if (!t) return null;
    try {
      const v = evaluate(t);
      return Number.isFinite(v) ? v : null;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Keypad editing. Input always lands at the end — there's no movable cursor on the
  // web version, which keeps every key a pure function of (text) → text.
  // ---------------------------------------------------------------------------

  function trailingOperand(text) {
    let l = text.length;
    while (l > 0 && isNumChar(text[l - 1])) l--;
    return text.slice(l);
  }

  /** A bare leading "0" is replaced rather than extended, so "0" then "5" reads "5". */
  function pressDigit(text, d) {
    if (trailingOperand(text) === '0') return text.slice(0, -1) + d;
    return text + d;
  }

  /**
   * The "00" / "000" keys. ¥1,000 and 15,000 COP are everyday amounts. They can only
   * ever EXTEND a number already being typed — on an empty operand or a bare zero they
   * do nothing, because "000" there is noise, not a value.
   */
  function pressZeros(text, count) {
    const op = trailingOperand(text);
    if (op === '' || parseFloat(op) === 0) return text;
    return text + '0'.repeat(count);
  }

  function pressDecimal(text) {
    const op = trailingOperand(text);
    if (op.includes('.')) return text;
    return text + (op === '' ? '0.' : '.');
  }

  /** A second operator replaces the first rather than stacking ("5+×" → "5×"). */
  function pressOperator(text, op) {
    if (!text) return op === '-' ? '-' : text;
    if (text === '-') return text;
    if (OPS.includes(text[text.length - 1])) return text.slice(0, -1) + op;
    return text + op;
  }

  function pressBackspace(text) {
    return text.slice(0, -1);
  }

  /**
   * Percent, the phone-calculator way:
   *   "100+8%"  → 108   (8% OF the running total)
   *   "200-25%" → 150
   *   "60×50%"  → 30    (a fraction)
   *   "100%"    → no-op (no base yet; "100 → 1" surprised people and they asked it stop)
   * The trailing operand is rewritten so the expression on screen matches the maths.
   */
  function pressPercent(text) {
    if (!text) return text;
    let right = text.length;
    let left = right;
    while (left > 0 && isNumChar(text[left - 1])) left--;
    if (left === right) return text; // ends in an operator — nothing to take a percent of
    const v = parseFloat(text.slice(left, right));
    if (!Number.isFinite(v)) return text;
    const opChar = left > 0 ? text[left - 1] : null;
    let newVal;
    if (opChar === '+' || opChar === '-') {
      const leftExpr = text.slice(0, left - 1);
      if (!leftExpr.trim()) return text;
      let base;
      try { base = evaluate(leftExpr); } catch (_) { return text; }
      newVal = (v / 100) * base;
    } else if (opChar === '×' || opChar === '÷') {
      newVal = v / 100;
    } else {
      return text;
    }
    return text.slice(0, left) + formatNumberForExpression(newVal);
  }

  /**
   * A result re-entered into the expression. Must never produce scientific notation —
   * the engine rejects "e", so "1e+21" would break the preview the moment "=" landed.
   * Rounds at 10 decimals to kill float dust (0.1 + 0.2).
   */
  function formatNumberForExpression(v) {
    if (!Number.isFinite(v)) return '0';
    if (Math.abs(v) >= 1e21) return BigInt(Math.round(v)).toString();
    let s = v.toFixed(10);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0' || s === '') s = '0';
    return s;
  }

  const groupInt = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  /** "12000×3-5" → "12,000×3−5" for display. Stored text never contains the commas. */
  function displayExpression(text) {
    return String(text)
      .replace(/\d+(\.\d*)?|\.\d+/g, (m) => {
        const dot = m.indexOf('.');
        if (dot < 0) return groupInt(m);
        return groupInt(m.slice(0, dot)) + m.slice(dot);
      })
      .replace(/-/g, '−');
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  /**
   * Decimals by magnitude. The pairs span six orders of magnitude — 0.87974 EUR vs
   * 3,205.8 COP per USD — so any fixed count is wrong at one end.
   */
  function digitsFor(v) {
    const a = Math.abs(v);
    if (a >= 1000) return 0;
    if (a >= 10) return 2;
    if (a >= 1) return 3;
    return 5;
  }

  function fmt(v, d) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: d, maximumFractionDigits: d,
    }).format(v);
  }

  function formatRateValue(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    return fmt(v, digitsFor(v));
  }

  /**
   * A daily move. Precision follows the RATE, not the move — keyed off the move, a
   * 0.0993 change beside "163.70" read "0.0993", four decimals on a two-decimal number.
   * Floor of one decimal so a zero-decimal COP rate still shows its "8.4" moves.
   */
  function formatRateDelta(change, rate) {
    return fmt(Math.abs(change), Math.max(digitsFor(rate), 1));
  }

  /**
   * Picks a readable quote base. "1 JPY = 0.00611 USD" is right and useless — nobody
   * prices anything one yen at a time. Smallest power of ten lifting the quote to 0.5:
   *   JPY→USD  →    100 JPY = 0.611 USD   (the per-100 convention)
   *   COP→USD  → 10,000 COP = 3.119 USD
   *   USD→EUR  →      1 USD = 0.88 EUR   (already readable)
   * 0.5 rather than 1.0: at 1.0 the yen lands on per-1,000 and the euro on per-10.
   */
  function quoteFor(rate) {
    if (!(rate > 0) || !Number.isFinite(rate)) return { baseUnits: 1, value: rate };
    for (const units of [1, 10, 100, 1000, 10000]) {
      const scaled = rate * units;
      if (scaled >= 0.5) return { baseUnits: units, value: scaled };
    }
    return { baseUnits: 100000, value: rate * 100000 };
  }

  /** Scaled quotes cap at 3 decimals — their magnitude is fixed, more would be noise. */
  function formatQuoteValue(q) {
    const d = digitsFor(q.value);
    return fmt(q.value, q.baseUnits > 1 ? Math.min(d, 3) : d);
  }

  /** Plain-calculator numbers: grouped, up to 6 decimals, no trailing zeros. */
  function formatPlainNumber(v) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(v);
  }

  /**
   * Money in its own currency's conventions — yen in whole yen, dollars in cents.
   * Letter symbols ("COP") get a space before the digits; some ICU builds run them
   * together and "COP38,433" reads as one token.
   */
  function formatAmount(v, code) {
    let s;
    try {
      s = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(v);
    } catch (_) {
      s = code + ' ' + fmt(v, 2);
    }
    return s.replace(/^(-?)([A-Za-z]+)(\d)/, '$1$2 $3');
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "2026-07-28" → "Jul 28". An unparseable value falls through unchanged. */
  function shortDate(iso) {
    const p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    const m = parseInt(p[1], 10);
    const d = parseInt(p[2], 10);
    if (!(m >= 1 && m <= 12) || !(d >= 1)) return String(iso);
    return `${MONTHS[m - 1]} ${d}`;
  }

  // ---------------------------------------------------------------------------
  // Live rates
  // ---------------------------------------------------------------------------

  function filterRates(entries) {
    const rates = {};
    for (const [k, v] of entries) {
      const code = String(k).toUpperCase();
      if (!CODES.has(code)) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      rates[code] = v;
    }
    rates.USD = 1;
    return rates;
  }

  /**
   * jsDelivr currency-api: { date, usd: { jpy: 163.7, cop: 3202.8, ... } }.
   * The table hangs off a key NAMED AFTER THE BASE, codes are lowercase, and ~338
   * entries include crypto. A payload yielding nothing usable returns null rather than
   * a table of just USD:1, which would overwrite good cached rates.
   */
  function parseJsDelivr(body) {
    if (!body || typeof body.date !== 'string') return null;
    const t = body.usd;
    if (!t || typeof t !== 'object') return null;
    const rates = filterRates(Object.entries(t));
    if (Object.keys(rates).length <= 1) return null;
    return { date: body.date, rates };
  }

  /** Frankfurter (ECB): { date, rates: { JPY: 163.9, ... } }. No COP. */
  function parseFrankfurter(body) {
    if (!body || typeof body.date !== 'string' || !body.rates) return null;
    const rates = filterRates(Object.entries(body.rates));
    if (Object.keys(rates).length <= 1) return null;
    return { date: body.date, rates };
  }

  /** Units of `to` per 1 `from`, crossing two USD-base rates. */
  function rateBetween(rates, from, to) {
    if (!rates) return null;
    const f = rates[from];
    const t = rates[to];
    if (!f || !t) return null;
    return t / f;
  }

  // ---------------------------------------------------------------------------
  // History series
  // ---------------------------------------------------------------------------

  const RANGES = [
    { key: '1W', days: 7 }, { key: '1M', days: 30 }, { key: '1Y', days: 365 },
    { key: '5Y', days: 1826 }, { key: 'Max', days: null },
  ];

  /** Comfortably before the ECB (1999) and TRM (1991) archives begin. */
  const EARLIEST = '1990-01-01';

  const pad2 = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  function todayIso(now) {
    return isoOf(now ? new Date(now) : new Date());
  }

  function minusDaysIso(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - n);
    return isoOf(dt);
  }

  function startDateFor(rangeKey, now) {
    const r = RANGES.find((x) => x.key === rangeKey);
    if (!r || r.days == null) return EARLIEST;
    return minusDaysIso(todayIso(now), r.days);
  }

  /** Frankfurter time series → [{d, v}] for `code`, oldest first. */
  function parseTimeSeries(body, code) {
    if (!body || !body.rates) return [];
    return Object.entries(body.rates)
      .map(([d, m]) => (m && typeof m[code] === 'number' ? { d, v: m[code] } : null))
      .filter(Boolean)
      .sort((a, b) => (a.d < b.d ? -1 : 1));
  }

  /** Colombia's TRM rows: `valor` is a STRING, `vigenciadesde` a floating timestamp. */
  function parseTrm(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => ({ d: String(r.vigenciadesde || '').split('T')[0], v: parseFloat(r.valor) }))
      .filter((p) => p.d && Number.isFinite(p.v) && p.v > 0)
      .sort((a, b) => (a.d < b.d ? -1 : 1));
  }

  /**
   * As-of join onto the union of dates, carrying each side's last value forward. The
   * TRM and the ECB keep different holiday calendars; an inner join would drop about
   * one day in twenty, clustered round holidays. A rate that hasn't reprinted is still
   * the rate. Dates before both series have started are dropped.
   */
  function alignAsOf(a, b) {
    if (!a.length || !b.length) return [];
    const am = new Map(a.map((p) => [p.d, p.v]));
    const bm = new Map(b.map((p) => [p.d, p.v]));
    const dates = [...new Set([...am.keys(), ...bm.keys()])].sort();
    const out = [];
    let la = null;
    let lb = null;
    for (const d of dates) {
      if (am.has(d)) la = am.get(d);
      if (bm.has(d)) lb = bm.get(d);
      if (la == null || lb == null) continue;
      out.push([d, la, lb]);
    }
    return out;
  }

  /** numerator ÷ denominator per date; zero denominators dropped, not infinities. */
  function crossSeries(num, den) {
    return alignAsOf(num, den).filter(([, , d]) => d !== 0).map(([d, n, x]) => ({ d, v: n / x }));
  }

  function invertSeries(points) {
    return points.filter((p) => p.v !== 0).map((p) => ({ d: p.d, v: 1 / p.v }));
  }

  /**
   * Evenly thins to at most `max` points, endpoints pinned — the header reads "Then"
   * and "Now" off them, and a line that doesn't end where the number says is worse
   * than no chart.
   */
  function downsample(points, max) {
    if (max < 2) throw new Error('max must leave room for both endpoints');
    if (points.length <= max) return points;
    const out = [];
    const step = (points.length - 1) / (max - 1);
    for (let i = 0; i < max; i++) {
      const p = points[Math.min(points.length - 1, Math.round(i * step))];
      if (!out.length || out[out.length - 1].d !== p.d) out.push(p);
    }
    if (out[out.length - 1].d !== points[points.length - 1].d) out.push(points[points.length - 1]);
    return out;
  }

  function seriesStats(points) {
    if (!points.length) return null;
    const first = points[0].v;
    const last = points[points.length - 1].v;
    let low = Infinity;
    let high = -Infinity;
    for (const p of points) { if (p.v < low) low = p.v; if (p.v > high) high = p.v; }
    return {
      first, last, low, high,
      change: last - first,
      changePct: first !== 0 ? (last - first) / first : null,
    };
  }

  /**
   * X-axis labels at the granularity the range can show: days for 1W/1M, months for
   * 1Y/5Y, years for Max. Returned with their point index so they sit under the exact
   * spot they name.
   */
  function axisLabels(points, rangeKey, count) {
    const n = count || 5;
    if (points.length < 2) return [];
    const out = [];
    for (let k = 0; k < n; k++) {
      const i = Math.round((k * (points.length - 1)) / (n - 1));
      const [y, m, d] = points[i].d.split('-').map(Number);
      let label;
      if (rangeKey === '1W' || rangeKey === '1M') label = `${MONTHS[m - 1]} ${d}`;
      else if (rangeKey === 'Max') label = String(y);
      else label = `${MONTHS[m - 1]} '${String(y).slice(2)}`;
      if (!out.length || out[out.length - 1].label !== label) out.push({ i, label });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Units
  // ---------------------------------------------------------------------------

  const u = (code, symbol, name, factor, offset) => ({ code, symbol, name, factor, offset: offset || 0 });

  /** Each category normalises through one base unit, so a table is O(N) not O(N²). */
  const UNITS = {
    Length: [
      u('mi', 'mi', 'Mile', 1609.344), u('yd', 'yd', 'Yard', 0.9144), u('ft', 'ft', 'Foot', 0.3048),
      u('in', 'in', 'Inch', 0.0254), u('km', 'km', 'Kilometer', 1000), u('m', 'm', 'Meter', 1),
      u('cm', 'cm', 'Centimeter', 0.01), u('mm', 'mm', 'Millimeter', 0.001),
    ],
    Mass: [
      u('lb', 'lb', 'Pound', 453.592), u('oz', 'oz', 'Ounce', 28.3495), u('kg', 'kg', 'Kilogram', 1000),
      u('g', 'g', 'Gram', 1), u('mg', 'mg', 'Milligram', 0.001), u('t', 't', 'Metric Ton', 1e6),
    ],
    Temperature: [
      u('F', '°F', 'Fahrenheit', 5 / 9, (-32 * 5) / 9), u('C', '°C', 'Celsius', 1, 0),
      u('K', 'K', 'Kelvin', 1, -273.15),
    ],
    Volume: [
      u('gal_us', 'gal', 'US Gallon', 3785.41), u('qt_us', 'qt', 'US Quart', 946.353),
      u('pt_us', 'pt', 'US Pint', 473.176), u('cup_us', 'cup', 'US Cup', 236.588),
      u('fl_oz_us', 'fl oz', 'US Fluid Ounce', 29.5735), u('tbsp', 'tbsp', 'Tablespoon', 14.7868),
      u('tsp', 'tsp', 'Teaspoon', 4.92892), u('L', 'L', 'Liter', 1000), u('mL', 'mL', 'Milliliter', 1),
    ],
  };

  const UNIT_DEFAULTS = {
    Length: ['mi', 'km'], Mass: ['lb', 'kg'], Temperature: ['F', 'C'], Volume: ['gal_us', 'L'],
  };

  /** Temperature is affine (offset + slope); everything else is a plain ratio. */
  function convertUnits(value, from, to) {
    const base = value * from.factor + from.offset;
    return (base - to.offset) / to.factor;
  }

  const Core = {
    CURRENCIES, CODES, QUICK_PAIRS, CalcError,
    evaluate, evaluateLoose, trimTrailingOps, trailingOperand,
    pressDigit, pressZeros, pressDecimal, pressOperator, pressBackspace, pressPercent,
    formatNumberForExpression, displayExpression,
    digitsFor, formatRateValue, formatRateDelta, quoteFor, formatQuoteValue,
    formatPlainNumber, formatAmount, shortDate, MONTHS,
    parseJsDelivr, parseFrankfurter, rateBetween,
    RANGES, EARLIEST, todayIso, minusDaysIso, startDateFor,
    parseTimeSeries, parseTrm, alignAsOf, crossSeries, invertSeries, downsample,
    seriesStats, axisLabels,
    UNITS, UNIT_DEFAULTS, convertUnits,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : this);
