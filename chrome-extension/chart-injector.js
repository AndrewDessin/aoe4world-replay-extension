// chart-injector.js — runs in the page MAIN world, mutates aoe4world's Chart.js
// instances AND the small player-color swatches scattered around the page
// (Timeline panel, Comparison rows, Build Order headers).
//
// Communicates with content.js via window.postMessage.
(() => {
  const SOURCE = 'aoe4-color-ext';
  const RECOLOR_ATTR = 'data-aoe4-recolored';
  const HIDE_STYLE_ID = '__aoe4-color-ext-hide';
  let chartLib = null;
  let colorByName = new Map();
  // Once flipped to true by `disable-colors`, stay disabled for the lifetime
  // of this page. Defends against stale `apply-colors`/`clear-colors`
  // messages that may have been queued before disable arrived. Re-enable
  // requires page reload (popup banner tells the user).
  let disabled = false;
  let patched = false;
  let domObserver = null;
  let pendingRescan = null;
  const nameKeyFn = name => String(name || '').trim().toLowerCase();

  function findChartBundleUrl() {
    const candidates = [
      ...document.querySelectorAll('link[rel="modulepreload"]'),
      ...document.querySelectorAll('script[type="module"]'),
    ];
    for (const el of candidates) {
      const url = el.href || el.src;
      if (url && /\/chart-[a-f0-9]+\.js(?:\?|$)/i.test(url)) return url;
    }
    return null;
  }

  function findChartExport(mod) {
    for (const value of Object.values(mod)) {
      if (typeof value === 'function' && typeof value.getChart === 'function' && value.instances) {
        return value;
      }
    }
    return null;
  }

  async function ensureChartLib() {
    if (chartLib) return chartLib;
    const url = findChartBundleUrl();
    if (!url) throw new Error('chart_bundle_not_found');
    const mod = await import(url);
    const Chart = findChartExport(mod);
    if (!Chart) throw new Error('chart_export_not_found');
    chartLib = Chart;
    return Chart;
  }

  function applyColorsToChart(chart) {
    if (!chart || !chart.data || !Array.isArray(chart.data.datasets)) return false;
    if (!colorByName.size) return false;
    let changed = false;
    for (const ds of chart.data.datasets) {
      const key = nameKeyFn(ds.label);
      if (!key) continue;
      const hex = colorByName.get(key);
      if (!hex) continue;
      if (ds.borderColor !== hex) { ds.borderColor = hex; changed = true; }
      if (ds.backgroundColor !== hex && typeof ds.backgroundColor !== 'function') {
        ds.backgroundColor = hex;
        changed = true;
      }
      if (ds.pointBorderColor !== undefined && ds.pointBorderColor !== hex) {
        ds.pointBorderColor = hex;
        changed = true;
      }
      if (ds.pointBackgroundColor !== undefined && ds.pointBackgroundColor !== hex) {
        ds.pointBackgroundColor = hex;
        changed = true;
      }
    }
    return changed;
  }

  function patchChartPrototype(Chart) {
    if (patched) return;
    patched = true;
    const proto = Chart.prototype;
    const origUpdate = proto.update;
    proto.update = function patchedUpdate(...args) {
      try { applyColorsToChart(this); } catch (_) {}
      return origUpdate.apply(this, args);
    };
  }

  function applyToAllExistingCharts(Chart) {
    if (!Chart || !Chart.instances) return 0;
    let updated = 0;
    for (const chart of Object.values(Chart.instances)) {
      if (applyColorsToChart(chart)) {
        try { chart.update('none'); updated++; } catch (_) {}
      }
    }
    return updated;
  }

  // ---- DOM swatch coloring ---------------------------------------------------

  // Walk forward through siblings looking for an element whose normalized text
  // matches a known player name. We accept the immediate next sibling and the
  // one after that (some panels insert flag images in between).
  function findAdjacentPlayerName(startEl) {
    let cur = startEl?.nextElementSibling;
    let hops = 0;
    while (cur && hops < 4) {
      const text = (cur.textContent || '').trim();
      if (text && colorByName.has(nameKeyFn(text))) return nameKeyFn(text);
      // Also check if cur is a flag wrapper followed by a name link
      cur = cur.nextElementSibling;
      hops++;
    }
    // For Pattern B (timeline legend) the colored div may have a sibling div
    // whose direct child <a>/<div> contains the name.
    cur = startEl?.nextElementSibling;
    hops = 0;
    while (cur && hops < 4) {
      const inner = cur.firstElementChild?.textContent?.trim();
      if (inner && colorByName.has(nameKeyFn(inner))) return nameKeyFn(inner);
      cur = cur.nextElementSibling;
      hops++;
    }
    return null;
  }

  function recolorSpanSwatch(span) {
    const nameKey = findAdjacentPlayerName(span);
    if (!nameKey) return false;
    const hex = colorByName.get(nameKey);
    if (!hex) return false;
    if (span.style.background === hex || span.style.backgroundColor === hex) {
      if (!span.hasAttribute(RECOLOR_ATTR)) span.setAttribute(RECOLOR_ATTR, '1');
      return false;
    }
    span.style.background = hex;
    span.style.backgroundColor = hex;
    span.setAttribute(RECOLOR_ATTR, '1');
    return true;
  }

  function recolorIconSwatch(icon) {
    const wrapper = icon.parentElement;
    if (!wrapper || !wrapper.style?.color) return false;
    const nameKey = findAdjacentPlayerName(wrapper);
    if (!nameKey) return false;
    const hex = colorByName.get(nameKey);
    if (!hex) return false;
    if (wrapper.style.color === hex) {
      if (!icon.hasAttribute(RECOLOR_ATTR)) icon.setAttribute(RECOLOR_ATTR, '1');
      return false;
    }
    wrapper.style.color = hex;
    icon.setAttribute(RECOLOR_ATTR, '1');
    return true;
  }

  function applyDomSwatchColors() {
    if (!colorByName.size) return 0;
    let count = 0;
    // Pattern A: small rounded-full spans with inline background
    document.querySelectorAll('span.rounded-full.w-2.h-2[style*="background"]').forEach(el => {
      try { if (recolorSpanSwatch(el)) count++; } catch (_) {}
    });
    // Pattern B: fa-circle-check icons inside an inline-color wrapper
    document.querySelectorAll('div[style*="color"] > i.fa-circle-check').forEach(el => {
      try { if (recolorIconSwatch(el)) count++; } catch (_) {}
    });
    return count;
  }

  function scheduleDomRescan() {
    if (pendingRescan) return;
    pendingRescan = requestAnimationFrame(() => {
      pendingRescan = null;
      applyDomSwatchColors();
    });
  }

  function ensureDomObserver() {
    if (domObserver) return;
    domObserver = new MutationObserver(mutations => {
      // Filter: only react to mutations that could plausibly affect swatches.
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
          scheduleDomRescan();
          return;
        }
        if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
          scheduleDomRescan();
          return;
        }
      }
    });
    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }

  function clearRecoloredAttrs() {
    document.querySelectorAll('[' + RECOLOR_ATTR + ']').forEach(el => {
      el.removeAttribute(RECOLOR_ATTR);
    });
  }

  function ensureHideStyle() {
    // If early-hide.js already injected, nothing to do.
    if (document.getElementById(HIDE_STYLE_ID)) return;
    // SPA navigation may have brought us back to a game page after the
    // early-hide style was removed. Re-inject it so new dots stay hidden
    // until we recolor them.
    const css = `
      span.rounded-full.w-2.h-2[style*="background"]:not([${RECOLOR_ATTR}]) {
        opacity: 0 !important;
        transition: opacity 0.18s ease-in;
      }
      div[style*="color"] > i.fa-circle-check:not([${RECOLOR_ATTR}]) {
        opacity: 0 !important;
        transition: opacity 0.18s ease-in;
      }
      span.rounded-full.w-2.h-2[${RECOLOR_ATTR}],
      div[style*="color"] > i.fa-circle-check[${RECOLOR_ATTR}] {
        opacity: 1 !important;
      }
    `;
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- Message handling ------------------------------------------------------

  async function handleApplyColors(payload) {
    if (disabled) return;
    const map = payload?.colorByName;
    if (!map || typeof map !== 'object') return;
    colorByName = new Map(Object.entries(map).map(([k, v]) => [nameKeyFn(k), v]));
    if (!colorByName.size) return;
    ensureHideStyle();
    ensureDomObserver();
    // Apply to DOM swatches immediately.
    applyDomSwatchColors();
    // Apply to Chart.js instances.
    try {
      const Chart = await ensureChartLib();
      patchChartPrototype(Chart);
      applyToAllExistingCharts(Chart);
    } catch (err) {
      window.postMessage({ source: SOURCE, type: 'error', error: err?.message || String(err) }, '*');
    }
  }

  function handleClearColors() {
    if (disabled) return;
    colorByName = new Map();
    // Strip our recolor markers so any leftover DOM nodes get re-hidden by
    // CSS until new colors arrive. (Most SPA frameworks unmount old nodes,
    // but in case any are reused this prevents stale colors leaking through.)
    clearRecoloredAttrs();
    ensureHideStyle();
  }

  // Live "user disabled the recolor setting" — different from clear-colors:
  // we do NOT re-inject the hide style and we DO disconnect the observer.
  // Already-recolored DOM stays as-is (reload required for full revert) but no
  // new mutations or messages will be acted on.
  function handleDisableColors() {
    disabled = true;
    colorByName = new Map();
    if (domObserver) {
      try { domObserver.disconnect(); } catch (_) {}
      domObserver = null;
    }
    if (pendingRescan) {
      try { cancelAnimationFrame(pendingRescan); } catch (_) {}
      pendingRescan = null;
    }
    const hideStyle = document.getElementById(HIDE_STYLE_ID);
    if (hideStyle) hideStyle.remove();
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === 'apply-colors') handleApplyColors(data);
    else if (data.type === 'clear-colors') handleClearColors();
    else if (data.type === 'disable-colors') handleDisableColors();
  });

  window.postMessage({ source: SOURCE, type: 'ready' }, '*');
})();
