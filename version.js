/*
 * version.js — the app's version and what changed in each release. The ONLY place a
 * version number is written.
 *
 * The version is a single counting number, same as Better Translator: every update the
 * phone receives is the next number up — Version 6, Version 7 — never skipping, never a
 * dotted 1.2.3. It shows at the bottom of the app, on the ⓘ screen, in the "Updated to"
 * notice, and in the service worker's cache name (which receives it through its
 * registration URL, so nothing else needs bumping). Tests fail a release if the newest
 * entry isn't VERSION, if the numbers skip or repeat, or if a note is missing.
 *
 * To release: VERSION + 1, add an entry at the TOP of RELEASES, `node --test`, push.
 */
(function (root) {
  'use strict';

  const VERSION = 9;

  /** Newest first. Notes are written for the person using the app, not for the code. */
  const RELEASES = [
    {
      version: 9,
      date: '2026-09-24',
      notes: [
        'Pressing = no longer hides how you got there: the sum stays above the answer (12,548+300 =), and when you keep going the earlier steps stay stacked above. Tap any of them to go back and edit it.',
        'Undo (↶) takes back the last =, an AC, or starting a new number. In the Calculator tab it also takes back a line added to — or deleted from — the list.',
      ],
    },
    {
      version: 8,
      date: '2026-09-23',
      notes: [
        'Fix a digit in the middle: tap anywhere in the number you\'re typing to put the cursor there (or press and slide), then backspace or type. Works in both the Currency and Calculator tabs.',
        'Quick pairs are now just JPY → USD and USD → JPY. Other currencies are still under the title.',
        'The rate line shows both directions at once: ¥100 = $0.634 · $1 = ¥157.63.',
      ],
    },
    {
      version: 7,
      date: '2026-09-23',
      notes: [
        'The version number now sits at the top, beside ⓘ. It turns blue when an update is waiting; tap it to load.',
        'No more pop-ups about updates.',
        'Fixed: the ⓘ screen (and the other panels) couldn\'t be closed on iPhone. Each now has a ✕.',
      ],
    },
    {
      version: 6,
      date: '2026-09-23',
      notes: [
        'Version number at the bottom of the screen. It goes up by one with every update.',
        'Updates arrive when you switch back to the app, not only after a full restart. If you\'re in the middle of a calculation it asks before reloading.',
      ],
    },
    {
      version: 5,
      date: '2026-09-23',
      notes: ['Fixed: the "Updated to…" notice could be skipped when the app reloaded itself to finish an update.'],
    },
    {
      version: 4,
      date: '2026-09-23',
      notes: ['Fixed: an update could load half-old, half-new for up to 10 minutes after it was published.'],
    },
    {
      version: 3,
      date: '2026-09-23',
      notes: [
        'The ⓘ screen: version and what changed in each update.',
        'After an update the app tells you once, so you know it arrived.',
      ],
    },
    {
      version: 2,
      date: '2026-09-23',
      notes: [
        'Bigger keys: the keypad now fills the screen instead of leaving empty space above it.',
        'Pins are more compact, and the display shrinks before the keys do when space is tight.',
      ],
    },
    {
      version: 1,
      date: '2026-09-23',
      notes: [
        'First iPhone version, ported from the Android app.',
        'Currency calculator with USD⇄JPY and USD⇄COP quick pairs, plus 29 more currencies.',
        'Pins with tap-two-to-compare, history of every =, and a rate chart from 1 week to all time.',
        'Calculator tab with a running tape you can edit, and a Units tab.',
      ],
    },
  ];

  const AppVersion = { VERSION, RELEASES };
  if (typeof module !== 'undefined' && module.exports) module.exports = AppVersion;
  else root.AppVersion = AppVersion;
})(typeof self !== 'undefined' ? self : this);
