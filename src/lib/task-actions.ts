import type { Aria2Task } from "./types";

export function canPauseTask(task: Aria2Task): boolean {
  return task.status === "active" || task.status === "waiting";
}

export function canResumeTask(task: Aria2Task): boolean {
  return task.status === "paused";
}
