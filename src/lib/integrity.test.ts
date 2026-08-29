import { describe, expect, it } from "vitest";
import {
  btPeerCounts,
  isConnectingTask,
  isRedundantIntegrityCheck,
  isStartingTask,
  isStoppingVerify,
  isVerifying,
  pausedGids,
  SKIP_INTEGRITY_OPTION,
  verifyBadge,
} from "./integrity";
import type { Aria2Task } from "./types";

function task(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: "gid",
    status: "active",
    totalLength: "100",
    completedLength: "0",
    uploadLength: "0",
    downloadSpeed: "0",
    uploadSpeed: "0",
    connections: "0",
    dir: "/data",
    files: [],
    ...overrides,
  };
}

describe("integrity resume policy", () => {
  it("turns check-integrity off so unpause trusts the control file", () => {
    expect(SKIP_INTEGRITY_OPTION).toEqual({ "check-integrity": "false" });
  });

  it("treats verifiedLength and a pending flag as verifying", () => {
    expect(isVerifying(task({ verifiedLength: "64" }))).toBe(true);
    expect(isVerifying(task({ verifyIntegrityPending: "true" }))).toBe(true);
    expect(isVerifying(task())).toBe(false);
  });

  it("aborts a remount re-hash that already has BT progress", () => {
    expect(
      isRedundantIntegrityCheck(
        task({
          bittorrent: { info: { name: "Cospuri" } },
          completedLength: "800",
          verifiedLength: "64",
        })
      )
    ).toBe(true);
  });

  it("leaves a first-time Folx-style hash check running", () => {
    expect(
      isRedundantIntegrityCheck(
        task({
          bittorrent: { info: { name: "Cospuri" } },
          completedLength: "0",
          verifiedLength: "64",
        })
      )
    ).toBe(false);
  });

  it("does not treat HTTP checksum verification as a remount re-hash", () => {
    expect(
      isRedundantIntegrityCheck(
        task({ completedLength: "800", verifiedLength: "64" })
      )
    ).toBe(false);
  });

  it("collects paused gids before unpauseAll", () => {
    expect(
      pausedGids([
        task({ gid: "a", status: "paused" }),
        task({ gid: "b", status: "waiting" }),
        task({ gid: "c", status: "paused" }),
      ])
    ).toEqual(["a", "c"]);
  });

  it("shows stopping while a user pause waits for hash check to leave active", () => {
    const verifying = task({
      gid: "a",
      verifiedLength: "64",
      bittorrent: { info: { name: "Cospuri" } },
    });
    expect(isStoppingVerify(verifying, ["a"])).toBe(true);
    expect(verifyBadge(verifying, ["a"])).toBe("stopping");
    expect(verifyBadge(verifying, [])).toBe("verifying");
    expect(verifyBadge({ ...verifying, status: "paused" }, ["a"])).toBe(null);
  });

  it("shows starting while unpause is still opening files on disk", () => {
    const paused = task({ gid: "a", status: "paused" });
    expect(isStartingTask(paused, ["a"])).toBe(true);
    expect(isStartingTask(paused, [])).toBe(false);
    expect(isStartingTask(task({ gid: "a", status: "active" }), ["a"])).toBe(
      false
    );
  });

  it("treats an active BT with 0/0 connections as still seeking peers", () => {
    const idle = task({
      bittorrent: { info: { name: "Cospuri" } },
      connections: "0",
      downloadSpeed: "0",
      numSeeders: "0",
    });
    expect(isConnectingTask(idle)).toBe(true);
    expect(btPeerCounts(idle)).toEqual({ seeders: 0, connections: 0 });
  });

  it("does not treat missing numSeeders as a formatting hole", () => {
    expect(btPeerCounts(task({ connections: "12" }))).toEqual({
      seeders: 0,
      connections: 12,
    });
  });

  it("stops seeking once a peer or download speed appears", () => {
    expect(
      isConnectingTask(task({ connections: "2", downloadSpeed: "0" }))
    ).toBe(false);
    expect(
      isConnectingTask(task({ connections: "0", downloadSpeed: "1024" }))
    ).toBe(false);
  });

  it("does not show seeking over starting, verifying, or paused", () => {
    expect(
      isConnectingTask(task({ gid: "a", status: "paused" }), ["a"])
    ).toBe(false);
    expect(isConnectingTask(task({ status: "paused" }))).toBe(false);
    expect(isConnectingTask(task({ verifiedLength: "64" }))).toBe(false);
  });
});
