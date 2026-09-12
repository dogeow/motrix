import { t } from "./i18n";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcResponse {
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: Array<{ gid: string }>;
}

export type NotificationHandler = (method: string, gid: string) => void;
export type StatusHandler = (connected: boolean) => void;

const RECONNECT_DELAY = 1000;
const OPEN_TIMEOUT = 8000;
const CONNECT_TIMEOUT = 4000;
const REQUEST_TIMEOUT = 15000;

export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineUnavailableError";
  }
}

export function isEngineUnavailable(error: unknown): boolean {
  return error instanceof EngineUnavailableError;
}

/**
 * Minimal aria2 JSON-RPC client over WebSocket.
 * Runs entirely in the webview — the Rust side only owns the aria2c process.
 */
export class Aria2Client {
  private ws: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private notificationHandlers = new Set<NotificationHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private openWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    private readonly port: number,
    private readonly secret: string
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.detachSocket();
    this.statusHandlers.forEach((handler) => handler(false));
    this.rejectAll(new EngineUnavailableError(t("engine.disconnected")));
    this.rejectOpenWaiters(new EngineUnavailableError(t("engine.notReady")));
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  async call<T>(method: string, ...params: unknown[]): Promise<T> {
    await this.ensureOpen();
    try {
      return await this.sendNow<T>(method, params);
    } catch (error) {
      // A disconnected reply does not mean a mutation failed. Replaying an
      // add/remove/unpause could duplicate work that aria2 already accepted.
      if (
        !isEngineUnavailable(error) ||
        this.closed ||
        !/^(get|tell)/.test(method)
      )
        throw error;
      await this.ensureOpen();
      return this.sendNow<T>(method, params);
    }
  }

  private sendNow<T>(method: string, params: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new EngineUnavailableError(t("engine.disconnected")));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(t("engine.requestTimeout")));
      }, REQUEST_TIMEOUT);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: `aria2.${method}`,
            params: [`token:${this.secret}`, ...params],
          })
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureOpen(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.closed) {
      return Promise.reject(new EngineUnavailableError(t("engine.notReady")));
    }
    if (this.ws?.readyState !== WebSocket.CONNECTING) {
      this.open();
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.openWaiters = this.openWaiters.filter(
          (waiter) => waiter.resolve !== onOpen
        );
        reject(new EngineUnavailableError(t("engine.notReady")));
      }, OPEN_TIMEOUT);
      const onOpen = () => {
        window.clearTimeout(timer);
        resolve();
      };
      const onFail = (error: Error) => {
        window.clearTimeout(timer);
        reject(error);
      };
      this.openWaiters.push({ resolve: onOpen, reject: onFail });
    });
  }

  private resolveOpenWaiters(): void {
    const waiters = this.openWaiters;
    this.openWaiters = [];
    waiters.forEach((waiter) => waiter.resolve());
  }

  private rejectOpenWaiters(error: Error): void {
    const waiters = this.openWaiters;
    this.openWaiters = [];
    waiters.forEach((waiter) => waiter.reject(error));
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private detachSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    if (
      ws.readyState === WebSocket.CONNECTING ||
      ws.readyState === WebSocket.OPEN
    ) {
      ws.close();
    }
  }

  private open(): void {
    if (this.closed) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;

    this.clearTimers();
    this.detachSocket();

    const ws = new WebSocket(`ws://127.0.0.1:${this.port}/jsonrpc`);
    this.ws = ws;
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) {
        ws.close();
      }
    }, CONNECT_TIMEOUT);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.clearTimers();
      this.resolveOpenWaiters();
      this.statusHandlers.forEach((handler) => handler(true));
    };
    ws.onmessage = (event) => {
      this.handleMessage(String(event.data));
    };
    ws.onerror = () => {
      // onclose follows; required so WKWebView actually tears the socket down.
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.clearTimers();
      this.ws = null;
      this.statusHandlers.forEach((handler) => handler(false));
      this.rejectAll(new EngineUnavailableError(t("engine.disconnected")));
      if (this.closed) {
        this.rejectOpenWaiters(
          new EngineUnavailableError(t("engine.notReady"))
        );
        return;
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.closed) this.open();
      }, RECONNECT_DELAY);
    };
  }

  private handleMessage(data: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(data) as JsonRpcResponse;
    } catch {
      return;
    }

    if (message.method) {
      const gid = message.params?.[0]?.gid ?? "";
      this.notificationHandlers.forEach((handler) =>
        handler(message.method as string, gid)
      );
      return;
    }

    if (message.id === undefined || message.id === null) return;
    const pending = this.pending.get(Number(message.id));
    if (!pending) return;
    this.pending.delete(Number(message.id));
    clearTimeout(pending.timer);

    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error): void {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.pending.clear();
  }
}
