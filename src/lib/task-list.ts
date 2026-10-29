import { taskName } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Aria2Task, Category, GlobalStat, TaskStatus } from "@/lib/types";

export type SortKey = "added" | "name" | "size" | "progress" | "speed";
export type TaskStatusFilter = "all" | TaskStatus;

export const STATUS_FILTERS: Record<Category, readonly TaskStatusFilter[]> = {
  all: ["all", "active", "waiting", "paused", "complete", "error", "removed"],
  active: ["all"],
  waiting: ["all", "waiting", "paused"],
  stopped: ["all", "complete", "error", "removed"],
};

const nameCollators: Record<Locale, Intl.Collator> = {
  "zh-CN": new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" }),
  en: new Intl.Collator("en", { numeric: true, sensitivity: "base" }),
};

export const SORT_KEYS: readonly SortKey[] = [
  "added",
  "name",
  "size",
  "progress",
  "speed",
];

export const CATEGORY_TABS: readonly Category[] = [
  "all",
  "active",
  "waiting",
  "stopped",
];

export function categoryTaskCount(
  stat: GlobalStat,
  category: Category
): number {
  switch (category) {
    case "all":
      return (
        Number(stat.numActive) +
        Number(stat.numWaiting) +
        Number(stat.numStopped)
      );
    case "active":
      return Number(stat.numActive);
    case "waiting":
      return Number(stat.numWaiting);
    case "stopped":
      return Number(stat.numStopped);
  }
}

export function sortTasks(
  tasks: readonly Aria2Task[],
  key: SortKey,
  locale: Locale = "zh-CN"
): Aria2Task[] {
  const sorted = [...tasks];
  switch (key) {
    case "added":
      return sorted;
    case "name":
      return sorted.sort((a, b) =>
        nameCollators[locale].compare(taskName(a), taskName(b))
      );
    case "size":
      return sorted.sort(
        (a, b) => Number(b.totalLength) - Number(a.totalLength)
      );
    case "speed":
      return sorted.sort(
        (a, b) => Number(b.downloadSpeed) - Number(a.downloadSpeed)
      );
    case "progress":
      return sorted.sort((a, b) => progress(b) - progress(a));
  }
}

export function filterAndSortTasks(
  tasks: readonly Aria2Task[],
  query: string,
  sortKey: SortKey,
  statusFilter: TaskStatusFilter = "all",
  locale: Locale = "zh-CN"
): Aria2Task[] {
  const needle = query.trim().toLowerCase();
  const filtered = needle || statusFilter !== "all"
    ? tasks.filter((task) =>
        (statusFilter === "all" || task.status === statusFilter) &&
        (!needle || taskName(task).toLowerCase().includes(needle))
      )
    : tasks;
  return sortTasks(filtered, sortKey, locale);
}

/**
 * Keep the list stable across aria2's one-second snapshots.
 *
 * aria2 does not expose a creation timestamp and does not guarantee the order
 * of tellActive(), so using each response verbatim makes rows swap places.
 * Existing tasks retain their previous order; genuinely new tasks are placed
 * first. A first snapshot is expected in aria2's oldest-to-newest order and is
 * reversed so the default view is newest first.
 */
export function stabilizeTaskOrder(
  incoming: readonly Aria2Task[],
  previous: readonly Aria2Task[]
): Aria2Task[] {
  if (previous.length === 0) return [...incoming].reverse();

  const byGid = new Map(incoming.map((task) => [task.gid, task]));
  const previousGids = new Set(previous.map((task) => task.gid));
  const added = incoming.filter((task) => !previousGids.has(task.gid)).reverse();
  const existing = previous.flatMap((task) => {
    const current = byGid.get(task.gid);
    return current ? [current] : [];
  });

  return [...added, ...existing];
}

function progress(task: Aria2Task): number {
  const total = Number(task.totalLength);
  return total > 0 ? Number(task.completedLength) / total : 0;
}
