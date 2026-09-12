import { describe, expect, it, vi } from "vitest";
import { createRefreshQueue } from "./refresh-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("refresh queue", () => {
  it("coalesces overlapping polls and notifications into one follow-up", async () => {
    const first = deferred();
    const refresh = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const request = createRefreshQueue(refresh);
    const pending = request();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(request()).toBe(pending);
    request();
    request();
    expect(refresh).toHaveBeenCalledTimes(1);
    first.resolve();
    await pending;
    expect(refresh).toHaveBeenCalledTimes(2);
    await request();
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("releases the lock after a failed refresh", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const request = createRefreshQueue(refresh);
    await expect(request()).rejects.toThrow("offline");
    await request();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
