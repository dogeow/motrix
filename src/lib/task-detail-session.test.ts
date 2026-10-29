import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFileSelectionDraft,
  startDetailPolling,
} from "./task-detail-session";
import type { Aria2File } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function files(selected: string[]): Aria2File[] {
  return ["1", "2", "10"].map((index) => ({
    index,
    path: `/downloads/${index}.mp4`,
    length: "100",
    completedLength: "0",
    selected: selected.includes(index) ? "true" : "false",
    uris: [],
  }));
}

describe("task detail polling", () => {
  afterEach(() => vi.useRealTimers());

  it("does not overlap slow requests and waits an interval after settlement", async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("next");
    const onResult = vi.fn();
    const stop = startDetailPolling({ load, onResult, interval: 2000 });

    await vi.advanceTimersByTimeAsync(10000);
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve("first");
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenLastCalledWith("first");
    await vi.advanceTimersByTimeAsync(1999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores pending responses after a dialog or tab session ends", async () => {
    vi.useFakeTimers();
    const pending = deferred<string>();
    const onResult = vi.fn();
    const onSettled = vi.fn();
    const load = vi.fn(() => pending.promise);
    const stop = startDetailPolling({ load, onResult, onSettled, interval: 2000 });
    stop();
    pending.resolve("old task");
    await vi.advanceTimersByTimeAsync(10000);
    expect(onResult).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retains successful data on a transient failure and continues polling", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockResolvedValueOnce(["peer"])
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(["new peer"]);
    const onResult = vi.fn();
    const onSettled = vi.fn();
    const stop = startDetailPolling({ load, onResult, onSettled, interval: 2000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenLastCalledWith(["peer"]);
    expect(onSettled).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onResult).toHaveBeenLastCalledWith(["new peer"]);
    stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe("file selection draft", () => {
  it("protects edits from a file response requested before the edit", () => {
    const draft = createFileSelectionDraft(files(["1", "2"]));
    const revision = draft.snapshot().revision;
    draft.toggle(["2"], false);
    draft.sync(files(["1", "2"]), revision);
    expect([...draft.snapshot().selection]).toEqual(["1"]);
    expect(draft.snapshot().dirty).toBe(true);
  });

  it("becomes clean when an edit is undone without accepting an older response", () => {
    const draft = createFileSelectionDraft(files(["1"]));
    const revision = draft.snapshot().revision;
    draft.toggle(["2"], true);
    draft.toggle(["2"], false);
    expect(draft.snapshot().dirty).toBe(false);
    draft.sync(files(["1", "2"]), revision);
    expect([...draft.snapshot().selection]).toEqual(["1"]);
    draft.sync(files(["1", "10"]), draft.snapshot().revision);
    expect([...draft.snapshot().selection]).toEqual(["1", "10"]);
  });

  it("discards immediately to the last confirmed selection", () => {
    const draft = createFileSelectionDraft(files(["1", "2"]));
    draft.toggle(["2"], false);
    const revision = draft.snapshot().revision;
    draft.discard();
    expect([...draft.snapshot().selection]).toEqual(["1", "2"]);
    expect(draft.snapshot().dirty).toBe(false);
    draft.sync(files(["1"]), revision);
    expect([...draft.snapshot().selection]).toEqual(["1", "2"]);
  });

  it("saves the submitted snapshot while retaining edits made during the request", () => {
    const draft = createFileSelectionDraft(files(["1"]));
    draft.toggle(["10", "2"], true);
    const submitted = draft.beginSave()!;
    expect(submitted.indexes).toEqual(["1", "2", "10"]);
    expect(draft.beginSave()).toBeNull();
    draft.toggle(["2"], false);
    draft.completeSave(submitted);
    expect([...draft.snapshot().selection]).toEqual(["1", "10"]);
    expect(draft.snapshot()).toMatchObject({ dirty: true, saving: false });
    draft.discard();
    expect([...draft.snapshot().selection]).toEqual(["1", "2", "10"]);
  });

  it("ignores snapshots from before or during a successful save", () => {
    const draft = createFileSelectionDraft(files(["1", "2"]));
    const beforeSave = draft.snapshot().revision;
    draft.toggle(["2"], false);
    const submitted = draft.beginSave()!;
    const duringSave = draft.snapshot().revision;
    draft.sync(files(["1", "2"]), duringSave);
    expect([...draft.snapshot().selection]).toEqual(["1"]);
    draft.completeSave(submitted);
    expect(draft.snapshot().dirty).toBe(false);
    draft.sync(files(["1", "2"]), beforeSave);
    draft.sync(files(["1", "2"]), duringSave);
    expect([...draft.snapshot().selection]).toEqual(["1"]);
  });

  it("preserves the draft and confirmed baseline when saving fails", () => {
    const draft = createFileSelectionDraft(files(["1", "2"]));
    draft.toggle(["2"], false);
    const submitted = draft.beginSave()!;
    draft.failSave(submitted);
    expect(draft.snapshot()).toMatchObject({ dirty: true, saving: false });
    expect([...draft.snapshot().selection]).toEqual(["1"]);
    draft.discard();
    expect([...draft.snapshot().selection]).toEqual(["1", "2"]);
  });

  it("rejects an empty selection because aria2 would interpret it as all files", () => {
    const draft = createFileSelectionDraft(files(["1"]));
    draft.toggle(["1"], false);
    expect(draft.beginSave()).toBeNull();
    expect(draft.snapshot().saving).toBe(false);
  });
});
