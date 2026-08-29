import { describe, expect, it } from "vitest";
import { isRecoverableDirError, retryUri } from "./retry";
import type { Aria2Task } from "./types";

function task(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: "gid",
    status: "error",
    totalLength: "100",
    completedLength: "0",
    uploadLength: "0",
    downloadSpeed: "0",
    uploadSpeed: "0",
    connections: "0",
    dir: "/Volumes/未命名2",
    files: [
      {
        index: "1",
        path: "/Volumes/未命名2/Cospuri/a.bin",
        length: "100",
        completedLength: "0",
        selected: "true",
        uris: [],
      },
    ],
    ...overrides,
  };
}

describe("retryUri", () => {
  it("prefers an existing file URI", () => {
    expect(
      retryUri(
        task({
          files: [
            {
              index: "1",
              path: "a",
              length: "1",
              completedLength: "0",
              selected: "true",
              uris: [{ uri: "https://example.com/a", status: "used" }],
            },
          ],
        })
      )
    ).toBe("https://example.com/a");
  });

  it("rebuilds a magnet from the torrent info hash", () => {
    expect(retryUri(task({ infoHash: "ABCDEF0123456789" }))).toBe(
      "magnet:?xt=urn:btih:ABCDEF0123456789"
    );
  });

  it("returns null when nothing can be retried", () => {
    expect(retryUri(task())).toBeNull();
  });
});

describe("isRecoverableDirError", () => {
  it("detects aria2 mkdir failures after a volume remount", () => {
    expect(
      isRecoverableDirError(
        "Failed to make the directory /Volumes/未命名2/Cospuri, cause: Permission denied"
      )
    ).toBe(true);
    expect(isRecoverableDirError("checksum error")).toBe(false);
  });
});
