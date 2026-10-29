import { useCallback, useEffect, useMemo, useState } from "react";
import type { Aria2Task } from "@/lib/types";

export function useTaskSelection(visibleTasks: readonly Aria2Task[]) {
  const [selectedGids, setSelectedGids] = useState<Set<string>>(new Set());

  // Selection belongs to the current view; hidden tasks must not reappear selected.
  useEffect(() => {
    setSelectedGids((current) => {
      if (current.size === 0) return current;
      const alive = new Set(visibleTasks.map((task) => task.gid));
      const next = new Set([...current].filter((gid) => alive.has(gid)));
      return next.size === current.size ? current : next;
    });
  }, [visibleTasks]);

  const selectedTasks = useMemo(
    () => visibleTasks.filter((task) => selectedGids.has(task.gid)),
    [selectedGids, visibleTasks]
  );

  const setTaskSelected = useCallback(
    (task: Aria2Task, isSelected: boolean) => {
      setSelectedGids((current) => {
        if (current.has(task.gid) === isSelected) return current;
        const next = new Set(current);
        if (isSelected) next.add(task.gid);
        else next.delete(task.gid);
        return next;
      });
    },
    []
  );

  const clearSelection = useCallback(() => {
    setSelectedGids(new Set());
  }, []);

  const selectAll = useCallback(
    (selected: boolean) => {
      setSelectedGids(
        new Set(selected ? visibleTasks.map((task) => task.gid) : [])
      );
    },
    [visibleTasks]
  );

  const deselectTasks = useCallback((gids: readonly string[]) => {
    if (gids.length === 0) return;
    const removed = new Set(gids);
    setSelectedGids((current) => {
      const next = new Set([...current].filter((gid) => !removed.has(gid)));
      return next.size === current.size ? current : next;
    });
  }, []);

  return {
    selectedGids,
    selectedTasks,
    setTaskSelected,
    clearSelection,
    selectAll,
    deselectTasks,
  };
}
