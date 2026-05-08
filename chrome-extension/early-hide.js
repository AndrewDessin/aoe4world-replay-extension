// early-hide.js — runs at document_start on game-summary pages.
// Injects CSS that hides aoe4world's default red/blue/etc. player slot
// swatches so they don't briefly flash before the in-game colors arrive.
//
// Strategy: hide swatches by default; chart-injector marks each one with
// `data-aoe4-recolored="1"` after applying real colors, which makes the
// :not() selector stop matching and the swatch fades in.
//
// Settings-aware: if the user has disabled the recolor feature, we must
// NOT inject the hide style (otherwise swatches would be invisible until
// content.js loads and removes the style ~50–500 ms later — exactly the
// flash the feature is meant to prevent in reverse).
//
// chrome.storage is async-only. To skip the inject *synchronously* on the
// very first frame, we cache the user's preference in page-origin
// localStorage as a hint. content.js mirrors the authoritative
// chrome.storage.local.settings.recolorSwatches value to this key on every
// settings change, so subsequent page loads honour the latest preference
// from the first frame. The async chrome.storage read here is a safety
// net that reconciles the hint if it's stale.
//
// Safety net: a setTimeout removes the style entirely after a few seconds
// so swatches always become visible even if the extension fails.
(() => {
  if (document.getElementById('__aoe4-color-ext-hide')) return;

  const HINT_KEY = '__aoe4-color-ext-recolor-v1';

  function readHint() {
    try { return localStorage.getItem(HINT_KEY); }
    catch (_) { return null; }
  }
  function writeHint(enabled) {
    try { localStorage.setItem(HINT_KEY, enabled ? '1' : '0'); }
    catch (_) { /* storage denied (e.g. cookies blocked) — non-fatal */ }
  }

  const STYLE_ID = '__aoe4-color-ext-hide';
  const css = `
    /* aoe4world player slot swatches — hidden until our extension recolors them */
    span.rounded-full.w-2.h-2[style*="background"]:not([data-aoe4-recolored]),
    span.rounded-full.w-2.h-2[style*="background"]:not([data-aoe4-recolored]) {
      opacity: 0 !important;
      transition: opacity 0.18s ease-in;
    }
    div[style*="color"] > i.fas.fa-circle-check:not([data-aoe4-recolored]),
    div[style*="color"] > i.fa-circle-check:not([data-aoe4-recolored]) {
      opacity: 0 !important;
      transition: opacity 0.18s ease-in;
    }
    span.rounded-full.w-2.h-2[data-aoe4-recolored],
    div[style*="color"] > i.fas.fa-circle-check[data-aoe4-recolored],
    div[style*="color"] > i.fa-circle-check[data-aoe4-recolored] {
      opacity: 1 !important;
    }
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
  function removeStyle() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  // Sync hint: only an explicit '0' suppresses injection. Missing key, '1',
  // or any other value defaults to inject (the safer behaviour for the
  // common case where recolor is enabled).
  const hint = readHint();
  const skipped = hint === '0';

  if (!skipped) {
    injectStyle();
    // Safety net: if the extension fails to deliver colors, reveal the
    // original swatches after a few seconds so the page isn't broken.
    setTimeout(removeStyle, 6000);
  }

  // Async reconciliation: read the authoritative setting and mirror it to
  // the hint for the next page load. Also remove the style immediately if
  // we injected but the user has the feature off (corrects a stale hint).
  try {
    chrome.storage.local.get('settings', ({ settings }) => {
      const enabled = !settings || settings.recolorSwatches !== false;
      writeHint(enabled);
      if (!enabled && !skipped) removeStyle();
      // If enabled and we skipped, it's too late to inject usefully for
      // this page (the swatches have already painted with original colors).
      // Accepted limitation; the next page load will inject from frame 0.
    });
  } catch (_) { /* chrome.storage unavailable — fall back to hint-only */ }
})();

