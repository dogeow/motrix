import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createVirtualListLayout,
  virtualRowsInView,
  virtualScrollTarget,
  type VirtualListLayout,
} from "@/lib/virtual-list";

export function useVirtualTaskList(keys: readonly string[], resetKey: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const rowObserver = useRef<ResizeObserver | null>(null);
  const previousLayout = useRef<VirtualListLayout | null>(null);
  const previousViewport = useRef({ top: 0, height: 0, scrollTop: 0, listTop: 0 });
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  );
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [retainedKey, retainFocusedRow] = useState<string | null>(null);

  const readViewport = useCallback(() => {
    const element = viewportRef.current;
    const list = listRef.current;
    if (!element || !list) {
      return { top: 0, height: element?.clientHeight ?? 0, scrollTop: element?.scrollTop ?? 0, listTop: 0 };
    }
    const listTop = list.getBoundingClientRect().top - element.getBoundingClientRect().top
      + element.scrollTop;
    return {
      top: Math.max(0, element.scrollTop - listTop),
      height: element.clientHeight,
      scrollTop: element.scrollTop,
      listTop,
    };
  }, []);

  const updateViewport = useCallback(() => {
    const next = readViewport();
    previousViewport.current = next;
    setViewport((current) => current.top === next.top && current.height === next.height
      ? current
      : { top: next.top, height: next.height });
  }, [readViewport]);

  const measureRows = useCallback((reset = false) => {
    const measurements = [...rowElements.current].map(([key, element]) =>
      [key, element.getBoundingClientRect().height] as const
    );
    setMeasuredHeights((current) => {
      const next = new Map(reset ? [] : current);
      let changed = reset && current.size > 0;
      for (const [key, height] of measurements) {
        if (height > 0 && Math.abs((next.get(key) ?? 0) - height) > 0.5) {
          next.set(key, height);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  const measureRow = useCallback((key: string, element: HTMLDivElement | null) => {
    const previous = rowElements.current.get(key);
    if (previous) rowObserver.current?.unobserve(previous);
    if (element) {
      rowElements.current.set(key, element);
      rowObserver.current?.observe(element);
    } else {
      rowElements.current.delete(key);
    }
  }, []);

  const layout = useMemo(
    () => createVirtualListLayout(keys, measuredHeights),
    [keys, measuredHeights]
  );
  const rows = useMemo(
    () => virtualRowsInView(layout, viewport.top, viewport.height, retainedKey),
    [layout, retainedKey, viewport]
  );

  useLayoutEffect(() => {
    previousLayout.current = null;
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    updateViewport();
  }, [resetKey, updateViewport]);

  // A status banner can move the list without changing its rows, so check every commit.
  useLayoutEffect(() => {
    const previous = previousLayout.current;
    const before = previousViewport.current;
    const current = readViewport();
    if (previous && viewportRef.current && listRef.current &&
      (previous !== layout || before.listTop !== current.listTop)) {
      // Height changes and new tasks above the viewport should not move the row being read.
      // Use the old position: shrinking content may already have clamped the DOM scrollTop.
      viewportRef.current.scrollTop = virtualScrollTarget(previous, layout, before, current.listTop);
    }
    previousLayout.current = layout;
    updateViewport();
  });

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let frame: number | null = null;
    let width = element.clientWidth;
    const onScroll = () => {
      const current = previousViewport.current;
      previousViewport.current = {
        ...current,
        top: Math.max(0, element.scrollTop - current.listTop),
        scrollTop: element.scrollTop,
      };
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateViewport();
      });
    };
    rowObserver.current = new ResizeObserver(() => measureRows());
    for (const row of rowElements.current.values()) rowObserver.current.observe(row);
    const viewportObserver = new ResizeObserver(() => {
      const widthChanged = width !== element.clientWidth;
      width = element.clientWidth;
      // Unmounted rows may wrap differently after resizing; discard their old measurements.
      measureRows(widthChanged);
      updateViewport();
    });
    viewportObserver.observe(element);
    element.addEventListener("scroll", onScroll, { passive: true });
    measureRows();
    updateViewport();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
      rowObserver.current?.disconnect();
      rowObserver.current = null;
      viewportObserver.disconnect();
    };
  }, [measureRows, updateViewport]);

  useLayoutEffect(() => {
    const alive = new Set(keys);
    setMeasuredHeights((current) => {
      if ([...current.keys()].every((key) => alive.has(key))) return current;
      return new Map([...current].filter(([key]) => alive.has(key)));
    });
  }, [keys]);

  return { viewportRef, listRef, layout, rows, measureRow, retainFocusedRow };
}
