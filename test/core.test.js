// Run with: node --test test/
// Ported from the Android app's JVM tests (CalculatorEngineTest, ZeroKeyTest,
// RateFormattingTest, JsDelivrParsingTest, RateHistoryTest) plus web-only cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// ---- engine -------------------------------------------------------------------

test('precedence: × and ÷ before + and −', () => {
  assert.equal(C.evaluate('2+3×4'), 14);
  assert.equal(C.evaluate('20-10÷2'), 15);
});
test('left-associative', () => assert.equal(C.evaluate('10-3-2'), 5));
test('unary minus at start and after an operator', () => {
  assert.equal(C.evaluate('-5+2'), -3);
  assert.equal(C.evaluate('2×-3'), -6);
});
test('ASCII operators accepted', () => assert.equal(C.evaluate('6*2/3'), 4));
test('decimals', () => near(C.evaluate('0.1+0.2'), 0.3, 1e-12));
test('divide by zero is an error, not Infinity', () =>
  assert.throws(() => C.evaluate('5÷0'), C.CalcError));
test('malformed numbers are errors, not silently different numbers', () => {
  // parseFloat("1.2.3") would give 1.2
  assert.throws(() => C.evaluate('1.2.3+1'), C.CalcError);
});
test('dangling operator is an error', () => assert.throws(() => C.evaluate('5+'), C.CalcError));
test('evaluateLoose previews through a trailing operator', () => {
  assert.equal(C.evaluateLoose('100+'), 100);
  assert.equal(C.evaluateLoose(''), null);
  assert.equal(C.evaluateLoose('5÷0'), null);
});

// ---- keypad editing -------------------------------------------------------------

test('00 / 000 extend a number being typed', () => {
  assert.equal(C.pressZeros('1', 3), '1000');
  assert.equal(C.pressZeros('48', 2), '4800');
  assert.equal(C.pressZeros('2+1', 2), '2+100');
});
test('00 / 000 refuse to invent a value', () => {
  assert.equal(C.pressZeros('', 3), '');
  assert.equal(C.pressZeros('0', 2), '0');
  assert.equal(C.pressZeros('5+', 2), '5+');
  assert.equal(C.pressZeros('0.0', 2), '0.0');
});
test('a bare leading zero is replaced, not extended', () => {
  assert.equal(C.pressDigit('0', '5'), '5');
  assert.equal(C.pressDigit('10', '5'), '105');
  assert.equal(C.pressDigit('3+0', '7'), '3+7');
});
test('decimal: one per number, leading zero when needed', () => {
  assert.equal(C.pressDecimal(''), '0.');
  assert.equal(C.pressDecimal('5+'), '5+0.');
  assert.equal(C.pressDecimal('1.5'), '1.5');
});
test('a second operator replaces the first', () => {
  assert.equal(C.pressOperator('5+', '×'), '5×');
  assert.equal(C.pressOperator('', '+'), '');
  assert.equal(C.pressOperator('', '-'), '-');
  assert.equal(C.pressOperator('-', '+'), '-');
});
test('percent follows the phone-calculator convention', () => {
  assert.equal(C.evaluate(C.pressPercent('100+8')), 108);
  assert.equal(C.evaluate(C.pressPercent('200-25')), 150);
  assert.equal(C.evaluate(C.pressPercent('60×50')), 30);
  assert.equal(C.pressPercent('100'), '100'); // no base yet — no-op
});
test('results never re-enter as scientific notation', () => {
  assert.equal(C.formatNumberForExpression(1e7), '10000000');
  assert.equal(C.formatNumberForExpression(0.1 + 0.2), '0.3');
  assert.equal(C.formatNumberForExpression(-0), '0');
  assert.ok(!/e/i.test(C.formatNumberForExpression(1e22)));
});
test('display groups thousands and prints a real minus', () =>
  assert.equal(C.displayExpression('12000×3-5.25'), '12,000×3−5.25'));

// ---- formatting -----------------------------------------------------------------

test('rate decimals follow magnitude', () => {
  assert.equal(C.formatRateValue(3205.8), '3,206');
  assert.equal(C.formatRateValue(163.70254319), '163.70');
  assert.equal(C.formatRateValue(1.435), '1.435');
  assert.equal(C.formatRateValue(0.87974), '0.87974');
  assert.equal(C.formatRateValue(null), '—');
});
test('delta precision comes from the rate, not the move', () => {
  assert.equal(C.formatRateDelta(0.0993, 163.7), '0.10');
  assert.equal(C.formatRateDelta(-0.0993, 163.7), '0.10'); // arrow carries the sign
  assert.equal(C.formatRateDelta(8.43, 3205.8), '8.4');
});
test('yen is quoted per 100, peso per 10,000, readable rates per 1', () => {
  assert.equal(C.quoteFor(163.7).baseUnits, 1);
  assert.equal(C.quoteFor(0.87974).baseUnits, 1);
  assert.equal(C.quoteFor(0.00611).baseUnits, 100);
  assert.equal(C.quoteFor(1 / 3205.8).baseUnits, 10000);
});
test('a quote always preserves the rate', () => {
  for (const r of [163.7, 0.00611, 0.000312, 0.87974, 1.435]) {
    const q = C.quoteFor(r);
    near(q.value / q.baseUnits, r, 1e-15);
  }
});
test('scaled quotes show no false precision', () => {
  assert.equal(C.formatQuoteValue(C.quoteFor(1 / 163.7)), '0.611');
  assert.equal(C.formatQuoteValue(C.quoteFor(163.7)), '163.70');
});
test('degenerate rates do not loop', () => {
  assert.equal(C.quoteFor(0).baseUnits, 1);
  assert.equal(C.quoteFor(NaN).baseUnits, 1);
});
test('plain numbers: grouped, no trailing zeros', () => {
  assert.equal(C.formatPlainNumber(48000), '48,000');
  assert.equal(C.formatPlainNumber(12.5), '12.5');
  assert.equal(C.formatPlainNumber(1 / 3), '0.333333');
});
test('money: word symbols get a space, yen is whole yen', () => {
  assert.match(C.formatAmount(38433.56, 'COP'), /^COP\s\d/);
  assert.equal(C.formatAmount(200, 'USD'), '$200.00');
  assert.ok(!C.formatAmount(32740.51, 'JPY').includes('.'));
});
test('short date', () => {
  assert.equal(C.shortDate('2026-07-28'), 'Jul 28');
  assert.equal(C.shortDate('garbage'), 'garbage');
});

// ---- rate parsing (fixture sampled from the live jsDelivr endpoint) -------------

const jsd = () => ({
  date: '2026-07-28',
  usd: { jpy: 163.70254319, cop: 3202.79666423, eur: 0.87974, mxn: 17.4742,
    '1inch': 11.77, ada: 5.97, btc: 0.0000094, aed: 3.6725 },
});
test('jsDelivr: uppercases, keeps COP, filters crypto and unoffered codes', () => {
  const r = C.parseJsDelivr(jsd());
  assert.equal(r.date, '2026-07-28');
  near(r.rates.COP, 3202.79666423);
  assert.deepEqual(Object.keys(r.rates).sort(), ['COP', 'EUR', 'JPY', 'MXN', 'USD']);
});
test('jsDelivr: broken payloads are rejected rather than overwriting the cache', () => {
  assert.equal(C.parseJsDelivr({ usd: { jpy: 163 } }), null);
  assert.equal(C.parseJsDelivr({ date: '2026-07-28' }), null);
  assert.equal(C.parseJsDelivr({ date: '2026-07-28', eur: { jpy: 186 } }), null);
  assert.equal(C.parseJsDelivr({ date: '2026-07-28', usd: { btc: 0.00001 } }), null);
});
test('jsDelivr: non-numeric and non-positive rates are dropped', () => {
  const r = C.parseJsDelivr({ date: 'd', usd: { jpy: 163, cop: 'x', eur: 0, mxn: -1 } });
  assert.deepEqual(Object.keys(r.rates).sort(), ['JPY', 'USD']);
});
test('cross rates via USD', () => {
  const { rates } = C.parseJsDelivr(jsd());
  near(C.rateBetween(rates, 'JPY', 'COP'), 3202.79666423 / 163.70254319);
  assert.equal(C.rateBetween(rates, 'USD', 'ZAR'), null);
});

// ---- history maths ----------------------------------------------------------------

const P = (...a) => a.map(([d, v]) => ({ d, v }));
test('as-of join carries the last value over a holiday', () => {
  const trm = P(['2026-01-01', 4000], ['2026-01-02', 4100], ['2026-01-03', 4200]);
  const ecb = P(['2026-01-01', 160], ['2026-01-03', 162]);
  assert.deepEqual(C.alignAsOf(trm, ecb)[1], ['2026-01-02', 4100, 160]);
});
test('as-of join drops dates before both series start', () => {
  const out = C.alignAsOf(P(['2026-01-01', 1], ['2026-01-02', 1]), P(['2026-01-02', 2]));
  assert.equal(out.length, 1);
});
test('cross divides and drops zero denominators', () => {
  const out = C.crossSeries(P(['d1', 4000], ['d2', 4100]), P(['d1', 0], ['d2', 160]));
  assert.equal(out.length, 1);
  near(out[0].v, 4100 / 160);
});
test('downsample caps, keeps order, pins both endpoints, spreads evenly', () => {
  const p = Array.from({ length: 5000 }, (_, i) => ({ d: `d${String(i).padStart(5, '0')}`, v: i }));
  const out = C.downsample(p, 400);
  assert.ok(out.length <= 401 && out.length > 300);
  assert.equal(out[0], p[0]);
  assert.equal(out[out.length - 1], p[p.length - 1]);
  const vals = out.map((x) => x.v);
  assert.deepEqual(vals, [...vals].sort((a, b) => a - b));
  const firstHalf = out.filter((x) => x.v < 2500).length;
  assert.ok(Math.abs(firstHalf - out.length / 2) < out.length * 0.05);
});
test('series stats', () => {
  const s = C.seriesStats(P(['a', 100], ['b', 150], ['c', 120]));
  assert.deepEqual([s.first, s.last, s.low, s.high, s.change], [100, 120, 100, 150, 20]);
  near(s.changePct, 0.2);
  assert.equal(C.seriesStats(P(['a', 0], ['b', 5])).changePct, null);
});
test('TRM rows parse string values and floating timestamps', () => {
  const pts = C.parseTrm([
    { vigenciadesde: '2026-07-28T00:00:00.000', valor: '3205.8' },
    { vigenciadesde: '2026-07-25T00:00:00.000', valor: '3210.56' },
    { vigenciadesde: 'bad', valor: 'x' },
  ]);
  assert.deepEqual(pts, [{ d: '2026-07-25', v: 3210.56 }, { d: '2026-07-28', v: 3205.8 }]);
});
test('axis labels: days / months / years by range', () => {
  const p = P(['2026-01-05', 1], ['2026-03-10', 1], ['2026-06-20', 1], ['2026-09-01', 1], ['2026-12-30', 1]);
  assert.equal(C.axisLabels(p, '1M')[0].label, 'Jan 5');
  assert.equal(C.axisLabels(p, '1Y')[0].label, "Jan '26");
  assert.equal(C.axisLabels(p, 'Max')[0].label, '2026');
});
test('Max reaches back past both archives', () =>
  assert.ok(C.startDateFor('Max') < '1991-12-02'));
test('minusDaysIso crosses month and year boundaries', () =>
  assert.equal(C.minusDaysIso('2026-01-01', 1), '2025-12-31'));

// ---- units ------------------------------------------------------------------------

const unit = (cat, code) => C.UNITS[cat].find((x) => x.code === code);
test('length and mass ratios', () => {
  near(C.convertUnits(1, unit('Length', 'mi'), unit('Length', 'km')), 1.609344);
  near(C.convertUnits(1, unit('Mass', 'kg'), unit('Mass', 'lb')), 1000 / 453.592);
});
test('temperature is affine', () => {
  near(C.convertUnits(212, unit('Temperature', 'F'), unit('Temperature', 'C')), 100, 1e-9);
  near(C.convertUnits(0, unit('Temperature', 'C'), unit('Temperature', 'K')), 273.15, 1e-9);
});
