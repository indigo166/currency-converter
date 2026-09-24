// A release can't ship with a version that has no notes, a number that skips or
// repeats, or a second copy of the number written somewhere else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VERSION, RELEASES } = require('../version.js');

test('VERSION is a whole number', () => assert.ok(Number.isInteger(VERSION) && VERSION > 0));
test('the newest release entry is the current VERSION', () => assert.equal(RELEASES[0].version, VERSION));
test('versions count down by exactly one to 1 — no gaps, no repeats', () => {
  RELEASES.forEach((r, i) => assert.equal(r.version, VERSION - i, `entry ${i} should be version ${VERSION - i}`));
  assert.equal(RELEASES[RELEASES.length - 1].version, 1);
});
test('every release has a date and at least one note', () => {
  for (const r of RELEASES) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, `version ${r.version}`);
    assert.ok(Array.isArray(r.notes) && r.notes.length && r.notes.every((n) => n.trim()), `version ${r.version}`);
  }
});

// The files that deal in versions. A plain integer is too common to search for, so this
// looks for the shapes a hardcoded version takes: "Version 6", v=6, cc-v6, or "1.2.3".
test('no other file hardcodes a version number', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['app.js', 'sw.js', 'index.html', 'manifest.webmanifest']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const hit = src.match(/['"`]v?\d+\.\d+\.\d+['"`]|\bv=\d|cc-v\d|Version \d/i);
    assert.equal(hit, null, `${f} hardcodes "${hit && hit[0]}" — versions live only in version.js`);
  }
});

// Every file the page loads (other than version.js itself) must carry the version on its
// URL, or a stale copy can be mixed into a new release — as happened on the 1.1.0 deploy.
test('index.html loads app files only with the version on the URL', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const f of ['app.js', 'core.js', 'styles.css']) {
    assert.ok(!new RegExp(`(src|href)="${f.replace('.', '\\.')}"`).test(html), `${f} is loaded without ?v=`);
    assert.ok(html.includes(`${f}?v=`), `${f} is not loaded with ?v=`);
  }
});
