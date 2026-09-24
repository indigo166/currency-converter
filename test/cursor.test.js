// Editing in the middle of an expression — "I meant a 5, not a 6, and I've already typed
// more after it."
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

// "|" marks the cursor in both input and expected output.
const split = (s) => ({ text: s.replace('|', ''), cur: s.indexOf('|') });
const join = ({ text, cur }) => text.slice(0, cur) + '|' + text.slice(cur);
const press = (s, ...keys) => {
  let st = split(s);
  for (const k of keys) st = C.editAt(st.text, st.cur, k);
  return join(st);
};

test('the reported case: fix one digit with more typed after it', () => {
  // typed 12648+300, meant 12548: put the cursor after the 6, backspace, type 5
  assert.equal(press('126|48+300', 'back', '5'), '125|48+300');
  assert.equal(C.evaluate('12548+300'), 12848);
});
test('backspace deletes the character before the cursor, not the last one', () => {
  assert.equal(press('12|34', 'back'), '1|34');
  assert.equal(press('|1234', 'back'), '|1234');
});
test('digits insert at the cursor', () => assert.equal(press('1|5', '0'), '10|5'));
test('a bare zero is replaced only at the end of its number', () => {
  assert.equal(press('0|', '5'), '5|');
  assert.equal(press('3+0|', '7'), '3+7|');
  assert.equal(press('|0', '5'), '5|0'); // cursor before the zero: insert, don't replace
});
test('00 / 000 extend the digits to the left of the cursor', () => {
  assert.equal(press('1|5', '00'), '100|5');
  assert.equal(press('5+|3', '000'), '5+|3');   // nothing to the left to extend
  assert.equal(press('0|', '00'), '0|');
});
test('decimal: one per number, judged across the whole number around the cursor', () => {
  assert.equal(press('12|', '.'), '12.|');
  assert.equal(press('1|2.5', '.'), '1|2.5');   // that number already has one
  assert.equal(press('5+|', '.'), '5+0.|');
});
test('operators: replace a neighbour instead of stacking', () => {
  assert.equal(press('5+|3', '×'), '5×|3');      // operator before the cursor
  assert.equal(press('5|+3', '×'), '5×|3');      // operator after the cursor
  assert.equal(press('12|34', '+'), '12+|34');   // splitting a number is allowed
  assert.equal(press('|5+3', '+'), '|5+3');      // can't start with +
  assert.equal(press('|5+3', '-'), '-|5+3');     // but a leading minus is fine
});
test('percent works on the number the cursor is in', () => {
  const r = press('100+8|+50', '%');
  assert.equal(C.evaluate(r.replace('|', '')), 158);
});
test('AC clears everything', () => assert.equal(press('12|34', 'AC'), '|'));
test('the cursor is clamped to the text', () => {
  assert.deepEqual(C.editAt('12', 99, '3'), { text: '123', cur: 3 });
  assert.deepEqual(C.editAt('12', -4, 'back'), { text: '12', cur: 0 });
});

test('comma positions match the display, so a tap maps to the right raw digit', () => {
  // "12000×3-1234.56" displays as "12,000×3−1,234.56"
  assert.deepEqual([...C.commaPositions('12000×3-1234.56')], [2, 9]);
  assert.deepEqual([...C.commaPositions('999')], []);
  assert.deepEqual([...C.commaPositions('.1234')], []);
});

test('two-way quote text reads the way people say it', () => {
  assert.equal(C.quoteText('JPY', 'USD', 1 / 157.63), '¥100 = $0.634');
  assert.equal(C.quoteText('USD', 'JPY', 157.63), '$1 = ¥157.63');
  assert.equal(C.quoteText('COP', 'USD', 1 / 3205.8), 'COP 10,000 = $3.119');
});
test('quick pairs are the two yen directions, JPY → USD first', () =>
  assert.deepEqual(C.QUICK_PAIRS, [['JPY', 'USD'], ['USD', 'JPY']]));
