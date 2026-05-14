import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  appendUpgradeTooltipLabel,
  readableTooltipAccentColor,
} from '../../src/content/tooltip-content.ts';

describe('tooltip-content upgrade labels', () => {
  it('brightens dark player colors for tooltip accents', () => {
    const readable = readableTooltipAccentColor('#166534');

    assert.notEqual(readable, '#166534');
    assert.match(readable, /^#[0-9A-F]{6}$/);
  });

  it('keeps already-readable light colors as accents', () => {
    assert.equal(readableTooltipAccentColor('#FACC15'), '#FACC15');
  });

  it('renders upgrade text with readable classes instead of coloring the full row', () => {
    const { document } = parseHTML('<div id="tooltip"></div>');
    globalThis.document = document;
    const tooltip = document.getElementById('tooltip');

    const row = appendUpgradeTooltipLabel(tooltip, 'Twon LEGEND', 'Hardened Atgeirmadr', '#166534', true);

    assert.equal(row.textContent, '⬆Twon LEGEND: Hardened Atgeirmadr');
    assert.equal(row.className, 'aoe4-summary-tooltip-upgrade');
    assert.ok(row.querySelector('.aoe4-summary-tooltip-upgrade-marker'));
    assert.equal(row.querySelector('.aoe4-summary-tooltip-upgrade-player')?.textContent, 'Twon LEGEND');
    assert.equal(row.querySelector('.aoe4-summary-tooltip-upgrade-name')?.textContent, 'Hardened Atgeirmadr');
    assert.ok(!String(row.getAttribute('style') || '').includes('color:'));
    assert.ok(row.style.getPropertyValue('--aoe4-upgrade-accent'));
  });
});
