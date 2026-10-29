import { describe, expect, it } from "vitest";
import {
  createVirtualListLayout,
  virtualRowAtOffset,
  virtualRowsInView,
  virtualScrollAdjustment,
  virtualScrollTarget,
} from "@/lib/virtual-list";

describe("measured virtual task lists", () => {
  it("uses measured heights without truncating tall rows or adding a trailing gap", () => {
    const layout = createVirtualListLayout(
      ["short", "error", "unknown"],
      new Map([["short", 70], ["error", 158]]),
      94,
      8
    );
    expect(layout.offsets).toEqual([0, 78, 244]);
    expect(layout.heights).toEqual([70, 158, 94]);
    expect(layout.totalHeight).toBe(338);
    expect(virtualRowsInView(layout, 170, 20, null, 0)).toEqual([1]);
  });

  it("bounds mounted rows for thousands of tasks and can reach the final task", () => {
    const keys = Array.from({ length: 3000 }, (_, index) => `task-${index}`);
    const layout = createVirtualListLayout(keys, new Map());
    expect(virtualRowsInView(layout, 150000, 700).length).toBeLessThan(20);
    const atEnd = virtualRowsInView(layout, layout.totalHeight - 700, 700);
    expect(atEnd[atEnd.length - 1]).toBe(2999);
    const last = atEnd[atEnd.length - 1];
    expect(layout.offsets[last] + layout.heights[last]).toBe(layout.totalHeight);
  });

  it("retains a focused row once, in DOM order, even when it scrolls off screen", () => {
    const keys = Array.from({ length: 100 }, (_, index) => `task-${index}`);
    const layout = createVirtualListLayout(keys, new Map());
    const rows = virtualRowsInView(layout, 5000, 500, "task-2");
    expect(rows[0]).toBe(2);
    expect(rows.filter((index) => index === 2)).toHaveLength(1);
    expect(virtualRowsInView(layout, 0, 500, "task-2").filter((index) => index === 2)).toHaveLength(1);
    expect(virtualRowsInView(layout, 0, 500, "removed")).not.toContain(-1);
  });

  it("anchors the same visible task when preceding rows grow or new tasks arrive", () => {
    const previous = createVirtualListLayout(["a", "b", "c"], new Map(), 100, 8);
    const grown = createVirtualListLayout(["a", "b", "c"], new Map([["a", 170]]), 100, 8);
    expect(virtualScrollAdjustment(previous, grown, 135)).toBe(70);
    const inserted = createVirtualListLayout(["new", "a", "b", "c"], new Map(), 100, 8);
    expect(virtualScrollAdjustment(previous, inserted, 135)).toBe(108);
    expect(virtualScrollAdjustment(previous, inserted, 0)).toBe(0);
  });

  it("keeps measurements with task identity when tasks reorder and safely handles removal", () => {
    const sizes = new Map([["a", 80], ["b", 140]]);
    const previous = createVirtualListLayout(["a", "b"], sizes);
    const reordered = createVirtualListLayout(["b", "a"], sizes);
    expect(reordered.heights).toEqual([140, 80]);
    expect(virtualScrollAdjustment(previous, reordered, 100)).toBe(-88);
    expect(virtualScrollAdjustment(previous, createVirtualListLayout(["a"], sizes), 100)).toBe(0);
  });

  it("keeps the bottom reading position when removing preceding tasks clamps native scrollTop", () => {
    const keys = Array.from({ length: 100 }, (_, index) => `task-${index}`);
    const previous = createVirtualListLayout(keys, new Map(), 100, 8);
    const next = createVirtualListLayout(keys.slice(1), new Map(), 100, 8);
    const padding = 12;
    const viewportHeight = 700;
    const before = { scrollTop: previous.totalHeight + padding * 2 - viewportHeight, listTop: padding };
    const clamped = next.totalHeight + padding * 2 - viewportHeight;
    const target = virtualScrollTarget(previous, next, before, padding);
    expect(target).toBe(clamped);
    const oldAnchor = virtualRowAtOffset(previous, before.scrollTop - padding);
    const nextAnchor = next.keys.indexOf(previous.keys[oldAnchor]);
    expect(target - padding - next.offsets[nextAnchor]).toBe(
      before.scrollTop - padding - previous.offsets[oldAnchor]
    );
    // Adding the correction to the already-clamped position would jump up another row.
    expect(clamped + virtualScrollAdjustment(previous, next, clamped - padding)).toBe(target - 108);
  });

  it("uses the old viewport when measured rows shrink and compensates for a changed banner offset", () => {
    const keys = Array.from({ length: 100 }, (_, index) => `task-${index}`);
    const previous = createVirtualListLayout(keys, new Map([["task-0", 170]]), 100, 8);
    const next = createVirtualListLayout(keys, new Map([["task-0", 100]]), 100, 8);
    const before = { scrollTop: previous.totalHeight + 24 - 700, listTop: 12 };
    expect(virtualScrollTarget(previous, next, before, 12)).toBe(before.scrollTop - 70);
    expect(virtualScrollTarget(previous, next, before, 54)).toBe(before.scrollTop - 70 + 42);
    expect(virtualScrollTarget(previous, previous, { scrollTop: 0, listTop: 12 }, 54)).toBe(0);
  });

  it("handles gaps, empty lists and invalid measurements", () => {
    const layout = createVirtualListLayout(["a", "b"], new Map([["a", NaN], ["b", 0]]), 100, 8);
    expect(virtualRowAtOffset(layout, 99)).toBe(0);
    expect(virtualRowAtOffset(layout, 100)).toBe(1);
    expect(virtualRowsInView(layout, -20, 50, null, 0)).toEqual([0]);
    const empty = createVirtualListLayout([], new Map());
    expect(empty.totalHeight).toBe(0);
    expect(virtualRowsInView(empty, 0, 700)).toEqual([]);
  });
});
