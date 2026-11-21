# Graphing Calculator — TI-84-style PWA (v2)

A keypad-driven graphing calculator that runs entirely in the browser. No build step, no backend,
no external requests. Works offline after the first load and installs as an app.

## Publish with GitHub Pages
1. Upload the **contents** of this folder (not the outer folder) to your repository (root or a subfolder).
2. **Settings → Pages**: choose the branch/folder that contains `index.html`.
3. Open the HTTPS URL, then use *Install app* (Chrome menu / address bar) if offered.
All paths are relative, so it works under `https://user.github.io/repo/`.

`index.html` is now the entry point (no renaming needed). `popup.html` is kept for the Chrome-extension
build (`manifest.json`) and is identical apart from a fixed popup size.

## Modes (Alt+1…5, or Ctrl+←/→)
CALC · GRAPH · TABLE · HISTORY · SETTINGS. The app always opens on CALC.

## Features
- 2nd key (also `` ` `` on a keyboard) with secondary labels on keys; auto-cancels after one key, cancel with 2nd/Esc.
- RAD/DEG toggle, FRAC/DEC toggle (F↔D), mixed numbers (2nd F↔D), scientific/engineering/fixed decimals.
- Safe parser (no `eval`/`Function`): implicit multiplication, `x^2`, factorial, %, °, lists `{1,2,3}`,
  `nDeriv(f,x,a)`, `fnInt(f,x,a,b)`, nCr/nPr, mod/gcd/lcm, min/max/sum/mean, log(x,b), root(n,x), hyperbolics.
- Token editor with cursor, ▲/▼ entry recall, 2nd+ENTER = ENTRY, Ans, auto-Ans on a leading operator, live result preview.
- GRAPH: up to 10 functions (toggle, colour, remove), drag-pan, wheel/pinch zoom, Reset/Trig/Fit/Square,
  trace, zeros, min/max, intersections, derivative + tangent, shaded integral.
- TABLE: start/end/step (expressions allowed), one function or all enabled.
- HISTORY (200 entries, reuse/replay) and MEMORY (MC MR M+ M− MS) persist in localStorage.

## Maintenance
Bump `CACHE_VERSION` in `sw.js` whenever you change any file, so installed copies update.
Run the maths tests with `node tests/engine.test.mjs`.

## Migration from v1
Automatic: on first run v2 imports the old `cgcalc-memory` and `cgcalc-history` keys. Replace all files,
including `sw.js`; the old cache is deleted on activation. If a device shows the old UI, close all tabs/app
windows once or hard-reload.

## Known limits
Y= functions cannot reference each other (no `Y1(x)`); no complex numbers; no polar/parametric graphs;
no STO▸ variables other than Ans and memory. Installing is blocked on managed Chromebooks.
