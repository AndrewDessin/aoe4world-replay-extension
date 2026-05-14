(() => {
  type EarlyHideSettings = {
    settings?: {
      parseGameData?: boolean;
      recolorSwatches?: boolean;
    };
  };

  if (document.getElementById('__aoe4-color-ext-hide')) return;

  const HINT_KEY = '__aoe4-color-ext-recolor-v1';

  function readHint(): string | null {
    try { return localStorage.getItem(HINT_KEY); }
    catch (_) { return null; }
  }
  function writeHint(enabled: boolean): void {
    try { localStorage.setItem(HINT_KEY, enabled ? '1' : '0'); }
    catch (_) {}
  }

  const STYLE_ID = '__aoe4-color-ext-hide';
  const css = `
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

  function injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
  function removeStyle(): void {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  const hint = readHint();
  const skipped = hint === '0';

  if (!skipped) {
    injectStyle();
  }

  try {
    chrome.storage.local.get('settings', ({ settings }: EarlyHideSettings): void => {
      const enabled = settings?.parseGameData === true && settings?.recolorSwatches === true;
      writeHint(enabled);
      if (!enabled && !skipped) removeStyle();
    });
  } catch (_) {}
})();

