import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Aria2Task } from "./types";

const { call, invoke, state } = vi.hoisted(() => ({
  call: vi.fn(),
  invoke: vi.fn(),
  state: {
    refresh: vi.fn(),
    clearStarting: vi.fn(),
    markPausedByUser: vi.fn(),
    clearPausedByUser: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/store/app", () => ({
  aria2: () => ({ call }),
  useAppStore: { getState: () => state },
}));
vi.mock("@/store/settings", () => ({
  taskOptions: vi.fn(),
  useSettingsStore: { getState: vi.fn() },
}));
import { batch, pauseTask, removeTask } from "./actions";

const task = {
  gid: "gid",
  status: "active",
  files: [],
  dir: "/downloads",
} as unknown as Aria2Task;
beforeEach(() => {
  vi.clearAllMocks();
  call.mockReset();
  call.mockResolvedValue("OK");
});

describe("task actions", () => {
  it("uses the current status when a task finishes while deletion is being confirmed", async () => {
    call.mockImplementation(async (method: string) =>
      method === "tellStatus" ? { status: "complete" } : "OK"
    );
    await removeTask(task, false);
    expect(call).toHaveBeenCalledWith("removeDownloadResult", "gid");
    expect(
      call.mock.calls.some(
        ([method]) => method === "remove" || method === "forceRemove"
      )
    ).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic pause marker when the pause fails", async () => {
    call.mockRejectedValue(new Error("pause failed"));
    await expect(pauseTask(task)).rejects.toThrow("pause failed");
    expect(state.markPausedByUser).toHaveBeenCalledWith(["gid"]);
    expect(state.clearPausedByUser).toHaveBeenCalledWith(["gid"]);
  });

  it("reports exactly which tasks succeeded so failed selections can be retained", async () => {
    const tasks = [task, { ...task, gid: "failed" }];
    const action = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("failed"));
    expect(await batch(tasks, action)).toEqual({
      done: 1,
      failed: 1,
      succeededGids: ["gid"],
    });
  });
});
