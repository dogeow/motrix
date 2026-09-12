import { describe, expect, it } from "vitest";
import { canPauseTask, canResumeTask } from "./task-actions";
import type { Aria2Task, TaskStatus } from "./types";

describe("task action eligibility", () => {
  it.each<[TaskStatus, boolean, boolean]>([
    ["active", true, false],
    ["waiting", true, false],
    ["paused", false, true],
    ["complete", false, false],
    ["error", false, false],
    ["removed", false, false],
  ])("enables only supported actions for %s tasks", (status, pause, resume) => {
    const task = { status } as Aria2Task;
    expect(canPauseTask(task)).toBe(pause);
    expect(canResumeTask(task)).toBe(resume);
  });
});
