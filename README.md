# Currency Converter — web / iPhone

The iPhone version of the Currency Converter Calculator: a web app you add to the home
screen, rebuilt from the Android app (`../Currency Converter Calculator`, Kotlin/Compose).

**Live:** https://indigo166.github.io/currency-converter/

## Install on iPhone

1. Open the link above in **Safari** (not Chrome — only Safari can install to the home screen).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it from the home screen. It runs full-screen, keeps your pins, tape and history on
   the phone, and works offline with the last rates it fetched.

## What's in it

- **Currency** — calculator that converts while you compute; quick pairs USD⇄JPY and
  USD⇄COP, any of 32 currencies behind the title; rate line quoted on a readable base
  (100 JPY, 10,000 COP) with today's move and the rate's date; pins with tap-two-to-compare
  (difference in both currencies + ratio), hold a pin to load it back; history of every `=`.
- **History chart** — tap the rate line. 1W / 1M / 1Y / 5Y / Max, y-axis values, dated
  x-axis, drag to read any day, low/high/then/now.
- **Calculator** — adding-machine tape: `=` stacks the line and clears; tap a line to fix it
  in place.
- **Units** — length, mass, temperature, volume.

## Rates

| Use | Source | Notes |
|---|---|---|
| Live (primary) | jsDelivr `@fawazahmed0/currency-api` | ~338 codes incl. COP; filtered to the 32 offered |
| Live (fallback) | Frankfurter (ECB) | no COP — the rate line says `ECB` when this is in use |
| History, non-COP | Frankfurter time series | ECB daily fixings back to 1999 |
| History, COP | Colombia's official TRM (datos.gov.co) | back to 1991; the official rate, a hair off market mid |

The two live sources are never merged — first usable table wins — because every pair is
crossed via USD and mixing providers would bake their disagreement into the cross rate.
All sources are keyless and send CORS headers, so there's no server.

## Files

| File | What |
|---|---|
| `core.js` | Pure logic — engine, keypad editing, formatting, parsing, series maths, units. No DOM. |
| `app.js` | UI, storage (localStorage), network. |
| `styles.css` | Dark theme + iPhone safe-area layout. |
| `sw.js` | Offline shell. **Bump `CACHE` on every release.** |
| `test/core.test.js` | Logic tests — `node --test` |

## Releasing

Every change that reaches the phone is the next version number: Version 6, Version 7 …
(a single counting number, like Better Translator). It's written **only in `version.js`**,
with plain-English notes per release, and shows at the bottom of the app, on the ⓘ screen
and in the "Updated to" notice.

1. In `version.js`: `VERSION` + 1, and add an entry at the top of `RELEASES` with today's
   date and notes written for the person using the app.
2. `node --test` — fails if the numbers skip or repeat, if notes are missing, if a version is
   hardcoded anywhere else, or if a file is loaded without its `?v=`.
3. `git commit -am "…" && git push` — GitHub Pages redeploys in about a minute.

On the phone: opening the app fresh loads the new version immediately. Switching back to
an app that was already running checks for a newer version; if nothing is half-typed it
reloads straight into it, otherwise the bottom line turns blue ("Version 7 is ready · tap to
update") and waits for a tap.
