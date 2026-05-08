import { armyIconElement } from './unit-icons.ts';
import { seriesColorChip } from './legend.ts';
import type { Chart, TooltipRow } from './types.ts';

export function appendArmyTooltipRows(tooltip: HTMLElement, rows: TooltipRow[], chart: Chart): void {
  const sidePlayerCounts = armySidePlayerCounts(chart);
  const teamGroups = [
    { key: 'team-1', fallbackLabel: 'Team 1', sign: 1, rows: rows.filter(row => (row.item.sign ?? Math.sign(row.value)) >= 0) },
    { key: 'team-2', fallbackLabel: 'Team 2', sign: -1, rows: rows.filter(row => (row.item.sign ?? Math.sign(row.value)) < 0) }
  ].filter(group => group.rows.length);

  teamGroups.forEach((team, teamIndex) => {
    if (teamIndex > 0) {
      const divider = document.createElement('div');
      divider.className = 'aoe4-summary-tooltip-divider';
      tooltip.appendChild(divider);
    }
    const playerNames = sortedArmyTooltipPlayers(team.rows);
    const isTeamGameSide = (sidePlayerCounts.get(team.sign) || playerNames.length) > 1;
    const header = document.createElement('div');
    header.className = 'aoe4-summary-tooltip-section';
    header.textContent = isTeamGameSide ? team.fallbackLabel : (playerNames[0] || team.fallbackLabel);
    tooltip.appendChild(header);

    if (isTeamGameSide) {
      for (const row of team.rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))) {
        appendTooltipRow(tooltip, row, { type: 'army' }, row.item.playerName || '');
      }
      return;
    }

    for (const row of team.rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))) {
      appendTooltipRow(tooltip, row, { type: 'army' }, playerNames[0] || '');
    }
  });
}

export function armySidePlayerCounts(chart: Chart): Map<number, number> {
  const playersBySide = new Map<number, Set<string>>([[1, new Set<string>()], [-1, new Set<string>()]]);
  for (const item of chart.data.series) {
    const sign = (item.sign ?? 1) >= 0 ? 1 : -1;
    const players = playersBySide.get(sign);
    if (item.playerName && players) players.add(item.playerName);
  }
  return new Map<number, number>([...playersBySide.entries()].map(([sign, players]) => [sign, players.size]));
}

export function sortedArmyTooltipPlayers(rows: TooltipRow[]): string[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const playerName = row.item.playerName || '';
    if (!playerName) continue;
    totals.set(playerName, (totals.get(playerName) || 0) + Math.abs(row.value));
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([playerName]) => playerName);
}

export function appendTooltipRow(
  tooltip: HTMLElement,
  row: TooltipRow,
  chart: Pick<Chart, 'type'>,
  omitPlayerName = '',
): void {
  const entry = document.createElement('div');
  entry.className = 'aoe4-summary-tooltip-row';
  if (row.isClosest) entry.classList.add('is-closest');
  const icon = armyIconElement(row.item);
  const value = document.createElement('span');
  value.className = 'aoe4-summary-tooltip-value';
  value.style.color = row.item.color;
  value.textContent = Math.round((chart.type === 'army' || chart.type === 'lead') ? Math.abs(row.value) : row.value).toLocaleString();
  const label = document.createElement('span');
  if (omitPlayerName) {
    // Cached base name avoids DOM scraping race with age variants.
    label.textContent = row.item.unitLabel || row.item.label || '';
  } else {
    label.textContent = row.item.label;
  }
  if (chart.type !== 'army' && row.delta !== 0) {
    const deltaValue = row.delta ?? 0;
    const delta = document.createElement('span');
    delta.className = `aoe4-summary-tooltip-delta ${deltaValue > 0 ? 'is-positive' : deltaValue < 0 ? 'is-negative' : 'is-zero'}`;
    delta.textContent = formatTooltipDelta(deltaValue);
    entry.append(icon, value, delta, seriesColorChip(row.item.color), label);
  } else {
    entry.append(icon, value, seriesColorChip(row.item.color), label);
  }
  tooltip.appendChild(entry);
}

export function formatTooltipDelta(delta: number | undefined): string {
  const rounded = Math.round(delta || 0);
  return `(${rounded > 0 ? '+' : ''}${rounded.toLocaleString()})`;
}
