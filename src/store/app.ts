import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { Aria2Client, EngineUnavailableError } from "@/lib/aria2";
import { t } from "@/lib/i18n";
import { TASK_LIST_KEYS } from "@/lib/rpc-keys";
import { createRefreshQueue } from "@/lib/refresh-queue";
import { stabilizeTaskOrder } from "@/lib/task-list";
import type {
  Aria2File,
  Aria2Task,
  Category,
  EngineInfo,
  GlobalStat,
} from "@/lib/types";

export type { Category } from "@/lib/types";

let client: Aria2Client | null = null;
let initStarted = false;
let pollId: ReturnType<typeof setInterval> | null = null;
let categoryVersion = 0;
const fileCache = new Map<string, Aria2File[]>();

/** The singleton aria2 client. Only valid after init() resolves. */
export function aria2(): Aria2Client {
  if (!client) throw new EngineUnavailableError(t("engine.notReady"));
  return client;
}

type NotificationHandler = (method: string, gid: string) => void;
const notificationHandlers = new Set<NotificationHandler>();

/**
 * Subscribe to aria2's push notifications (onDownloadComplete, onDownloadError,
 * …). Survives engine restarts, unlike a handler bound to the client itself.
 */
export function onAria2Notification(handler: NotificationHandler): () => void {
  notificationHandlers.add(handler);
  return () => {
    notificationHandlers.delete(handler);
  };
}

const POLL_INTERVAL = 1000;

interface AppState {
  engine: EngineInfo | null;
  connected: boolean;
  category: Category;
  tasks: Aria2Task[];
  stat: GlobalStat | null;
  initError: string | null;
  loading: boolean;
  refreshError: string | null;
  /** User-paused GIDs; hash check can stay active until forcePause finishes. */
  pausedByUserGids: string[];
  markPausedByUser: (gids: string[]) => void;
  clearPausedByUser: (gids: string[]) => void;
  /** Clicked start, but aria2 is still opening files / leaving paused. */
  startingGids: string[];
  markStarting: (gids: string[]) => void;
  clearStarting: (gids: string[]) => void;
  init: () => Promise<void>;
  setCategory: (category: Category) => void;
  refresh: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  engine: null,
  connected: false,
  category: "all",
  tasks: [],
  stat: null,
  initError: null,
  loading: true,
  refreshError: null,
  pausedByUserGids: [],
  startingGids: [],

  markPausedByUser(gids) {
    if (gids.length === 0) return;
    const current = new Set(get().pausedByUserGids);
    for (const gid of gids) current.add(gid);
    set({ pausedByUserGids: [...current] });
  },

  clearPausedByUser(gids) {
    if (gids.length === 0) return;
    const drop = new Set(gids);
    set({
      pausedByUserGids: get().pausedByUserGids.filter((gid) => !drop.has(gid)),
    });
  },

  markStarting(gids) {
    if (gids.length === 0) return;
    const current = new Set(get().startingGids);
    for (const gid of gids) current.add(gid);
    set({ startingGids: [...current] });
  },

  clearStarting(gids) {
    if (gids.length === 0) return;
    const drop = new Set(gids);
    set({
      startingGids: get().startingGids.filter((gid) => !drop.has(gid)),
    });
  },

  async init() {
    // Guard synchronously — React StrictMode mounts effects twice in dev.
    if (initStarted) return;
    initStarted = true;

    let engine: EngineInfo;
    try {
      engine = await invoke<EngineInfo>("get_engine_info");
    } catch (error) {
      initStarted = false;
      set({ initError: String(error), loading: false });
      return;
    }
    set({ engine, initError: null });

    client = new Aria2Client(engine.rpcPort, engine.rpcSecret);
    client.onStatus((connected) => {
      set({ connected });
      // Let the status bar paint before the first RPC round-trip.
      if (connected) window.setTimeout(() => void get().refresh(), 0);
    });
    client.onNotification((method, gid) => {
      void get().refresh();
      notificationHandlers.forEach((handler) => handler(method, gid));
    });
    client.connect();

    pollId = setInterval(() => {
      if (get().connected) void get().refresh();
    }, POLL_INTERVAL);
  },

  setCategory(category) {
    if (category === get().category) return;
    for (const task of get().tasks) rememberFiles(task.gid, task.files);
    categoryVersion += 1;
    set({ category, tasks: [], loading: true, refreshError: null });
    void get().refresh();
  },

  async refresh() {
    await refreshTasks();
  },
}));

const refreshTasks = createRefreshQueue(async () => {
  const currentClient = client;
  if (!currentClient?.connected) return;
  const version = categoryVersion;
  const { category } = useAppStore.getState();
  try {
    const [stat, tasks] = await Promise.all([
      currentClient.call<GlobalStat>("getGlobalStat"),
      fetchTasks(currentClient, category),
    ]);
    // A → B → A is also a new view, even though the category matches again.
    if (version !== categoryVersion || client !== currentClient) return;
    const state = useAppStore.getState();
    const { tasks: previous, startingGids: starting } = state;
    const merged = keepFiles(stabilizeTaskOrder(tasks, previous), previous);
    const byGid = starting.length
      ? new Map(merged.map((task) => [task.gid, task]))
      : null;
    const stillStarting = starting.filter((gid) => {
      const task = byGid?.get(gid);
      return !task || task.status === "paused";
    });
    const startingGids =
      stillStarting.length === starting.length ? starting : stillStarting;
    const nextStat = sameSnapshot(stat, state.stat) ? state.stat : stat;
    if (
      merged !== previous ||
      nextStat !== state.stat ||
      startingGids !== starting ||
      state.loading ||
      state.refreshError !== null
    ) {
      useAppStore.setState({
        stat: nextStat,
        tasks: merged,
        startingGids,
        loading: false,
        refreshError: null,
      });
    }
    void hydrateMissingNames(currentClient, version);
  } catch (error) {
    if (version !== categoryVersion || client !== currentClient) return;
    useAppStore.setState({
      loading: false,
      refreshError: error instanceof Error ? error.message : String(error),
    });
  }
});

const MAX_LISTED = 1000;

/** Keep display names across category switches without retaining full file lists. */
function rememberFiles(gid: string, files: Aria2File[]): void {
  if (!files?.length) return;
  const cached = fileCache.get(gid);
  fileCache.delete(gid);
  fileCache.set(
    gid,
    cached?.[0] === files[0] ? cached : files.slice(0, 1)
  );
  if (fileCache.size > MAX_LISTED * 3) {
    fileCache.delete(fileCache.keys().next().value!);
  }
}

function keepFiles(tasks: Aria2Task[], previous: Aria2Task[]): Aria2Task[] {
  const prev = new Map(previous.map((task) => [task.gid, task]));
  const merged = tasks.map((task) => {
    const previousTask = prev.get(task.gid);
    const previousFiles = previousTask?.files;
    const incoming = task.files?.length
      ? task.files
      : previousFiles?.length
        ? previousFiles
        : fileCache.get(task.gid);
    if (incoming?.length) rememberFiles(task.gid, incoming);
    const next = {
      ...task,
      files: incoming?.length
        ? incoming.length > 1
          ? [incoming[0]]
          : incoming
        : [],
    };
    return previousTask && sameSnapshot(next, previousTask) ? previousTask : next;
  });
  return merged.length === previous.length &&
    merged.every((task, index) => task === previous[index])
    ? previous
    : merged;
}

/** RPC snapshots contain JSON values; preserve references when values match. */
function sameSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        sameSnapshot(a[key], b[key])
    )
  );
}

const NAME_HYDRATION_BATCH_SIZE = 8;
let hydrating = false;
let hydrationCursor = 0;

/** HTTP tasks have no bittorrent.name; pull files[0] once for the display name. */
async function hydrateMissingNames(
  currentClient: Aria2Client,
  version: number
): Promise<void> {
  if (hydrating) return;
  const tasks = useAppStore.getState().tasks;
  const missing: Aria2Task[] = [];
  // Rotate attempts so a failed or nameless task cannot starve later tasks.
  for (
    let scanned = 0;
    scanned < tasks.length && missing.length < NAME_HYDRATION_BATCH_SIZE;
    scanned += 1
  ) {
    const index = hydrationCursor % tasks.length;
    hydrationCursor = index + 1;
    const task = tasks[index];
    if (!task.bittorrent?.info?.name && !task.files?.length && !task.infoHash) {
      missing.push(task);
    }
  }
  if (missing.length === 0) return;
  hydrating = true;
  try {
    const results = await Promise.allSettled(
      missing.map(async (task) => {
        const detail = await currentClient.call<Pick<Aria2Task, "files">>(
          "tellStatus",
          task.gid,
          ["files"]
        );
        return { gid: task.gid, files: detail.files?.slice(0, 1) ?? [] };
      })
    );
    if (version !== categoryVersion || client !== currentClient) return;
    const byGid = new Map<string, Aria2File[]>();
    for (const result of results) {
      if (result.status !== "fulfilled" || result.value.files.length === 0) {
        continue; // A later refresh retries failures without blocking peers.
      }
      const { gid, files } = result.value;
      rememberFiles(gid, files);
      byGid.set(gid, files);
    }
    if (byGid.size === 0) return;
    useAppStore.setState((state) => {
      let changed = false;
      const tasks = state.tasks.map((task) => {
        const files = byGid.get(task.gid);
        if (!files || task.files?.length) return task;
        changed = true;
        return { ...task, files };
      });
      return changed ? { tasks } : state;
    });
  } finally {
    hydrating = false;
  }
}

/** aria2 appends stopped tasks chronologically; the stable sorter reverses it. */
function tellStopped(client: Aria2Client): Promise<Aria2Task[]> {
  return client.call<Aria2Task[]>("tellStopped", 0, MAX_LISTED, TASK_LIST_KEYS);
}

function fetchTasks(
  client: Aria2Client,
  category: Category
): Promise<Aria2Task[]> {
  switch (category) {
    case "active":
      return client.call<Aria2Task[]>("tellActive", TASK_LIST_KEYS);
    case "waiting":
      return client.call<Aria2Task[]>(
        "tellWaiting",
        0,
        MAX_LISTED,
        TASK_LIST_KEYS
      );
    case "stopped":
      return tellStopped(client);
    case "all":
      return Promise.all([
        client.call<Aria2Task[]>("tellActive", TASK_LIST_KEYS),
        client.call<Aria2Task[]>("tellWaiting", 0, MAX_LISTED, TASK_LIST_KEYS),
        tellStopped(client),
      ]).then(([active, waiting, stopped]) => [
        ...active,
        ...waiting,
        ...stopped,
      ]);
  }
}

// Dev-only: tear down the old WebSocket client and poll loop when Vite
// hot-replaces this module, so HMR doesn't stack duplicates.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    client?.close();
    if (pollId !== null) clearInterval(pollId);
  });
}
