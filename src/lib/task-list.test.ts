import { describe, expect, it } from "vitest";
import {
  categoryTaskCount,
  filterAndSortTasks,
  stabilizeTaskOrder,
  sortTasks,
} from "@/lib/task-list";
import type { Aria2Task, GlobalStat } from "@/lib/types";

function task(
  gid: string,
  name: string,
  overrides: Partial<Aria2Task> = {}
): Aria2Task {
  return {
    gid,
    status: "active",
    totalLength: "100",
    completedLength: "0",
    uploadLength: "0",
    downloadSpeed: "0",
    uploadSpeed: "0",
    connections: "0",
    dir: "/downloads",
    files: [
      {
        index: "1",
        path: `/downloads/${name}`,
        length: "100",
        completedLength: "0",
        selected: "true",
        uris: [],
      },
    ],
    ...overrides,
  };
}

describe("filterAndSortTasks", () => {
  const tasks = [
    task("a", "Beta.iso", {
      totalLength: "200",
      completedLength: "100",
      downloadSpeed: "20",
    }),
    task("b", "Alpha.iso", {
      totalLength: "100",
      completedLength: "90",
      downloadSpeed: "10",
    }),
  ];

  it("filters task names case-insensitively", () => {
    expect(filterAndSortTasks(tasks, "ALPHA", "added").map(({ gid }) => gid)).toEqual([
      "b",
    ]);
  });

  it("sorts without mutating the source list", () => {
    expect(sortTasks(tasks, "name").map(({ gid }) => gid)).toEqual(["b", "a"]);
    expect(sortTasks(tasks, "size").map(({ gid }) => gid)).toEqual(["a", "b"]);
    expect(sortTasks(tasks, "progress").map(({ gid }) => gid)).toEqual([
      "b",
      "a",
    ]);
    expect(sortTasks(tasks, "speed").map(({ gid }) => gid)).toEqual(["a", "b"]);
    expect(tasks.map(({ gid }) => gid)).toEqual(["a", "b"]);
  });
});

describe("categoryTaskCount", () => {
  const stat: GlobalStat = {
    downloadSpeed: "0",
    uploadSpeed: "0",
    numActive: "2",
    numWaiting: "3",
    numStopped: "4",
  };

  it("returns per-category and aggregate counts", () => {
    expect(categoryTaskCount(stat, "active")).toBe(2);
    expect(categoryTaskCount(stat, "waiting")).toBe(3);
    expect(categoryTaskCount(stat, "stopped")).toBe(4);
    expect(categoryTaskCount(stat, "all")).toBe(9);
  });
});

describe("stabilizeTaskOrder", () => {
  const older = task("old", "Older.iso");
  const newer = task("new", "Newer.iso");

  it("shows the newest task first on the initial snapshot", () => {
    expect(stabilizeTaskOrder([older, newer], []).map(({ gid }) => gid)).toEqual([
      "new",
      "old",
    ]);
  });

  it("preserves the previous order when aria2 changes response order", () => {
    expect(
      stabilizeTaskOrder([newer, older], [older, newer]).map(({ gid }) => gid)
    ).toEqual(["old", "new"]);
  });

  it("prepends newly discovered tasks without moving existing rows", () => {
    const latest = task("latest", "Latest.iso");
    expect(
      stabilizeTaskOrder([older, newer, latest], [newer, older]).map(
        ({ gid }) => gid
      )
    ).toEqual(["latest", "new", "old"]);
  });

  it("drops tasks that are no longer in the snapshot", () => {
    expect(
      stabilizeTaskOrder([newer], [newer, older]).map(({ gid }) => gid)
    ).toEqual(["new"]);
  });
});
