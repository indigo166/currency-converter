/*
 * version.js — the app's version and what changed in each release. The ONLY place a
 * version number is written.
 *
 * Everything else reads from here: the About screen, the "Updated to vX" notice, and the
 * service worker (which receives the version through its registration URL, so its cache
 * name can't drift from the app's). A test fails if the newest release entry doesn't
 * match VERSION — so a version bump without notes can't ship.
 *
 * Numbering: small fixes bump the last number (1.1.0 → 1.1.1), new features bump the
 * middle one (1.1.x → 1.2.0).
 *
 * To release: bump VERSION, add an entry at the TOP of RELEASES, run `node --test`, push.
 */
(function (root) {
  'use strict';

  const VERSION = '1.1.2';

  /** Newest first. Notes are written for the person using the app, not for the code. */
  const RELEASES = [
    {
      version: '1.1.2',
      date: '2026-09-23',
      notes: [
        'Fixed: the "Updated to v…" notice could be skipped when the app reloaded itself to finish an update.',
      ],
    },
    {
      version: '1.1.1',
      date: '2026-09-23',
      notes: [
        'Fixed: an update could load half-old, half-new for up to 10 minutes after it was published. Every file is now tied to the version it belongs to.',
      ],
    },
    {
      version: '1.1.0',
      date: '2026-09-23',
      notes: [
        'This screen: tap ⓘ on any tab to see the version and what changed.',
        'After an update the app tells you once — "Updated to v…" — so you know it arrived.',
      ],
    },
    {
      version: '1.0.1',
      date: '2026-09-23',
      notes: [
        'Bigger keys: the keypad now fills the screen instead of leaving empty space above it.',
        'Pins are more compact, and the display shrinks before the keys do when space is tight.',
        'Updates show up the next time you open the app.',
      ],
    },
    {
      version: '1.0.0',
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
