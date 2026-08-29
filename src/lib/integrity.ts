import type { Aria2Options, Aria2Task } from "./types";

/**
 * aria2 re-hashes every piece on createInitialCommand when check-integrity is
 * true, even if a *.aria2 control file already restored the bitfield. Pause
 * then unpause (or remounting a disk and clicking start) therefore restarts a
 * full verify. New tasks still pass check-integrity=true once via taskOptions
 * so Folx-style first-time resume can piece-hash in place.
 */
export const SKIP_INTEGRITY_OPTION: Aria2Options = {
  "check-integrity": "false",
};

type IntegrityTask = Pick<
  Aria2Task,
  | "bittorrent"
  | "completedLength"
  | "connections"
  | "downloadSpeed"
  | "gid"
  | "numSeeders"
  | "status"
  | "verifiedLength"
  | "verifyIntegrityPending"
>;

export function isVerifying(task: IntegrityTask): boolean {
  return (
    task.verifiedLength !== undefined || task.verifyIntegrityPending === "true"
  );
}

/**
 * A BT hash check that already has download progress from the control file.
 * First-time cross-client resume has completedLength 0 until the check
 * finishes, so it is left alone.
 */
export function isRedundantIntegrityCheck(task: IntegrityTask): boolean {
  return (
    Boolean(task.bittorrent) &&
    isVerifying(task) &&
    Number(task.completedLength) > 0
  );
}

export function pausedGids(tasks: IntegrityTask[]): string[] {
  return tasks
    .filter((task) => task.status === "paused")
    .map((task) => task.gid);
}

export function isStoppingVerify(
  task: IntegrityTask,
  pausedByUserGids: readonly string[]
): boolean {
  return (
    pausedByUserGids.includes(task.gid) &&
    isVerifying(task) &&
    task.status === "active"
  );
}

export function isStartingTask(
  task: Pick<IntegrityTask, "gid" | "status">,
  startingGids: readonly string[]
): boolean {
  return startingGids.includes(task.gid) && task.status === "paused";
}

/**
 * aria2 reports status=active as soon as unpause returns — before trackers,
 * DHT, or the HTTP server have produced a peer/connection. 0 B/s and 0/0
 * connections are then truthful, not stale poll data.
 */
export function isConnectingTask(
  task: IntegrityTask,
  startingGids: readonly string[] = []
): boolean {
  if (task.status !== "active") return false;
  if (isStartingTask(task, startingGids)) return false;
  if (isVerifying(task)) return false;
  return (
    Number(task.connections || 0) === 0 &&
    Number(task.downloadSpeed || 0) === 0
  );
}

/** BT list line: connected seeders / total peer connections. */
export function btPeerCounts(
  task: Pick<IntegrityTask, "numSeeders" | "connections">
): { seeders: number; connections: number } {
  return {
    seeders: Number(task.numSeeders || 0),
    connections: Number(task.connections || 0),
  };
}

export type VerifyBadge = "stopping" | "verifying" | "pending" | null;

export function verifyBadge(
  task: IntegrityTask,
  pausedByUserGids: readonly string[]
): VerifyBadge {
  if (task.status === "paused") return null;
  if (isStoppingVerify(task, pausedByUserGids)) return "stopping";
  if (task.verifiedLength !== undefined) return "verifying";
  if (task.verifyIntegrityPending === "true") return "pending";
  return null;
}
