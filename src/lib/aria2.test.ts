import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Aria2Client } from "./aria2";

class Socket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: { id: number; method: string }[] = [];
  constructor() {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

let client: Aria2Client;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", globalThis);
  Socket.instances = [];
  client = new Aria2Client(6800, "test");
  client.connect();
  Socket.instances[0].open();
});
afterEach(() => {
  client.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("aria2 request lifecycle", () => {
  it("times out a silent engine so UI controls can recover", async () => {
    const pending = client.call("addUri", ["https://example.com/file.zip"]);
    const check = expect(pending).rejects.toThrow(/超时|timed out/);
    await vi.advanceTimersByTimeAsync(15000);
    await check;
    expect(Socket.instances[0].sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never replays a mutation when the connection drops after sending", async () => {
    const pending = client.call("addUri", ["https://example.com/file.zip"]);
    const check = expect(pending).rejects.toThrow();
    await Promise.resolve();
    Socket.instances[0].close();
    await check;
    await vi.advanceTimersByTimeAsync(1000);
    Socket.instances[1].open();
    await Promise.resolve();
    expect(Socket.instances.flatMap((socket) => socket.sent)).toHaveLength(1);
  });

  it("retries read requests after reconnecting", async () => {
    const pending = client.call("getGlobalStat");
    await Promise.resolve();
    Socket.instances[0].close();
    await Promise.resolve();
    await Promise.resolve();
    const reconnected = Socket.instances[Socket.instances.length - 1];
    reconnected.open();
    await Promise.resolve();
    const sent = reconnected.sent[0];
    reconnected.onmessage?.({
      data: JSON.stringify({ id: sent.id, result: { numActive: "2" } }),
    });
    await expect(pending).resolves.toEqual({ numActive: "2" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up the timeout on a successful response", async () => {
    const pending = client.call("pause", "gid");
    await Promise.resolve();
    const socket = Socket.instances[0];
    socket.onmessage?.({
      data: JSON.stringify({ id: socket.sent[0].id, result: "gid" }),
    });
    await expect(pending).resolves.toBe("gid");
    expect(vi.getTimerCount()).toBe(0);
  });
});
