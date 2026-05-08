import type { TimelineElements } from './types.ts';

export function normalizeName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function closestWith(start: HTMLElement | null, predicate: (element: HTMLElement) => boolean): HTMLElement | null {
  let current: HTMLElement | null = start;
  while (current && current !== document.body) {
    if (predicate(current)) return current;
    current = current.parentElement;
  }
  return null;
}

export function findTimelineElements(): TimelineElements | null {
  const select = [...document.querySelectorAll('select')]
    .find(element => element.querySelector('option[value="army"]') && element.querySelector('option[value="workers"]'));
  if (!select) return null;
  const root = closestWith(select, element => Boolean(element.querySelector?.('h3')?.textContent?.trim().includes('Timeline'))) ||
    closestWith(select, element => Boolean(element.querySelector?.('canvas')));
  if (!root) return null;
  const chartBox = [...root.querySelectorAll('div')]
    .find(element => {
      const directHeading = [...element.children].find(child => child.tagName === 'H3');
      return directHeading && element.querySelector('canvas');
    });
  const canvas = chartBox?.querySelector('canvas');
  const heading = chartBox ? [...chartBox.children].find(child => child.tagName === 'H3') : null;
  if (!chartBox || !canvas || !heading) return null;
  return { root, select, chartBox: chartBox as HTMLElement, canvas, heading: heading as HTMLElement };
}

export function findAnchor(row: Element): HTMLAnchorElement | null {
  const dateCell = row.querySelector<HTMLAnchorElement>('a[role="cell"]');
  return dateCell || null;
}

export function getGameIdFromUrl(url: string | null | undefined): string | null {
  const m = String(url || '').match(/\/players\/\d+(?:-[^/]+)?\/games\/(\d+)/);
  return m ? m[1] : null;
}

export function findCivIconPosition(row: Element): Element | null {
  const children = [...row.children];
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.tagName === 'IMG' ||
        child.classList?.contains('ml-auto') ||
        child.querySelector?.('img[src*="assets/"]')) {
      return child;
    }
  }
  return null;
}

export function parseTimeToSeconds(str: string | null | undefined): number | null {
  if (typeof str !== 'string') return null;
  const parts = str.split(':');
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s)) return null;
  return m * 60 + s;
}

export function escapeHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
