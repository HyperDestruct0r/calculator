# Custom Graphing Calculator — PWA

This is the standalone Progressive Web App edition of the calculator.

## Publish with GitHub Pages
1. Create a repository for the calculator, or use a folder in an existing repository.
2. Upload the **contents** of this folder (not the outer folder itself) to the repository location you want to publish.
3. In GitHub, open **Settings → Pages** and configure Pages for the branch/folder containing `index.html` (usually `main` and `/root`).
4. This project currently uses `popup.html` as its app page. Rename `popup.html` to `index.html` before publishing, or change the Pages entry point accordingly. The recommended option is to rename it to `index.html`.
5. Open the published HTTPS URL in Chrome.
6. If Chrome offers **Install app** in the address bar or menu, use it. If not, check the three-dot menu for **Cast, save, and share → Install page as app** or **Create shortcut** (wording varies).

## Features
- Graphs one expression in `x` at a time.
- Pan by dragging and zoom with the wheel or buttons.
- Fractions are approximated for evaluated results.
- Calculation history and memory are saved in this browser using localStorage.
- Service worker caches app files for offline use after the first successful visit.
- Trigonometry uses radians.

## Important
A school-managed Chromebook may restrict PWA installation too. This project does not bypass administrator controls. If installation is blocked, you can still use the hosted calculator as a normal website if the site is allowed.
