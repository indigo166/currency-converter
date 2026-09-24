// A release can't ship with a version number that has no notes, notes out of order,
// or a second copy of the number hardcoded somewhere else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VERSION, RELEASES } = require('../version.js');

const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

test('VERSION is x.y.z', () => assert.match(VERSION, /^\d+\.\d+\.\d+$/));
test('the newest release entry is the current VERSION', () => assert.equal(RELEASES[0].version, VERSION));
test('releases are newest first and never repeat', () => {
  for (let i = 1; i < RELEASES.length; i++) assert.ok(cmp(RELEASES[i - 1].version, RELEASES[i].version) > 0);
});
test('every release has a date and at least one note', () => {
  for (const r of RELEASES) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, r.version);
    assert.ok(Array.isArray(r.notes) && r.notes.length && r.notes.every((n) => n.trim()), r.version);
  }
});
// The files that deal in versions. core.js is left out on purpose: it legitimately
// contains "1.2.3" as an example of a malformed number, which isn't a version.
test('no other file hardcodes a version number', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['app.js', 'sw.js', 'index.html', 'manifest.webmanifest']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    // Version-shaped only: quoted "1.2.3", or v1.2.3 / v=1.2.3. A bare 3.89.07 is an icon
    // path coordinate, not a version, and must not trip this.
    const hit = src.match(/['"`]v?\d+\.\d+\.\d+['"`]|\bv=?\d+\.\d+\.\d+\b|cc-v\d/);
    assert.equal(hit, null, `${f} hardcodes "${hit && hit[0]}" — versions live only in version.js`);
  }
});
