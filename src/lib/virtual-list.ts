export interface VirtualListLayout {
  keys: readonly string[];
  offsets: readonly number[];
  heights: readonly number[];
  totalHeight: number;
}

// This is only an initial estimate. Mounted rows always use their measured height.
export const ESTIMATED_TASK_HEIGHT = 94;
export const TASK_ROW_GAP = 8;
export const TASK_LIST_OVERSCAN = 320;

export function createVirtualListLayout(
  keys: readonly string[],
  measuredHeights: ReadonlyMap<string, number>,
  estimate = ESTIMATED_TASK_HEIGHT,
  gap = TASK_ROW_GAP
): VirtualListLayout {
  const offsets: number[] = [];
  const heights: number[] = [];
  let offset = 0;
  for (const key of keys) {
    const measured = measuredHeights.get(key);
    const height = measured && Number.isFinite(measured) && measured > 0
      ? measured
      : estimate;
    offsets.push(offset);
    heights.push(height);
    offset += height + gap;
  }
  return {
    keys,
    offsets,
    heights,
    totalHeight: keys.length ? offset - gap : 0,
  };
}

// Find the first row whose bottom extends past the requested offset.
export function virtualRowAtOffset(layout: VirtualListLayout, offset: number) {
  let low = 0;
  let high = layout.keys.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (layout.offsets[middle] + layout.heights[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.min(low, Math.max(0, layout.keys.length - 1));
}

export function virtualRowsInView(
  layout: VirtualListLayout,
  scrollTop: number,
  viewportHeight: number,
  retainedKey: string | null = null,
  overscan = TASK_LIST_OVERSCAN
): number[] {
  if (!layout.keys.length) return [];
  const start = virtualRowAtOffset(layout, Math.max(0, scrollTop - overscan));
  const endOffset = Math.max(0, scrollTop) + Math.max(0, viewportHeight) + overscan;
  const rows: number[] = [];
  for (let index = start; index < layout.keys.length; index += 1) {
    if (layout.offsets[index] > endOffset) break;
    rows.push(index);
  }
  // Keeping one focused row mounted also lets a portalled menu restore its trigger.
  const retained = retainedKey === null ? -1 : layout.keys.indexOf(retainedKey);
  if (retained !== -1 && !rows.includes(retained)) {
    rows.push(retained);
    rows.sort((a, b) => a - b);
  }
  return rows;
}

export function virtualScrollAdjustment(
  previous: VirtualListLayout,
  next: VirtualListLayout,
  scrollTop: number
) {
  if (scrollTop <= 0 || !previous.keys.length) return 0;
  const anchor = virtualRowAtOffset(previous, scrollTop);
  const nextAnchor = next.keys.indexOf(previous.keys[anchor]);
  return nextAnchor < 0 ? 0 : next.offsets[nextAnchor] - previous.offsets[anchor];
}

/** Use the viewport captured before DOM changes, which can clamp scrollTop. */
export function virtualScrollTarget(
  previous: VirtualListLayout,
  next: VirtualListLayout,
  previousViewport: { scrollTop: number; listTop: number },
  nextListTop: number
) {
  const top = Math.max(0, previousViewport.scrollTop - previousViewport.listTop);
  if (top === 0) return previousViewport.scrollTop;
  return Math.max(
    0,
    previousViewport.scrollTop + virtualScrollAdjustment(previous, next, top)
      + nextListTop - previousViewport.listTop
  );
}
