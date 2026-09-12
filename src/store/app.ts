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
    const { tasks: previous, startingGids: starting } = useAppStore.getState();
    const merged = keepFiles(stabilizeTaskOrder(tasks, previous), previous);
    const startingGids = starting.filter((gid) => {
      const task = merged.find((item) => item.gid === gid);
      return !task || task.status === "paused";
    });
    useAppStore.setState({
      stat,
      tasks: merged,
      startingGids,
      loading: false,
      refreshError: null,
    });
    void hydrateMissingNames(currentClient);
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
  fileCache.delete(gid);
  fileCache.set(gid, files.slice(0, 1));
  if (fileCache.size > MAX_LISTED * 3) {
    fileCache.delete(fileCache.keys().next().value!);
  }
}

function keepFiles(tasks: Aria2Task[], previous: Aria2Task[]): Aria2Task[] {
  const prev = new Map(previous.map((task) => [task.gid, task.files]));
  return tasks.map((task) => {
    const previousFiles = prev.get(task.gid);
    const incoming = task.files?.length
      ? task.files
      : previousFiles?.length
        ? previousFiles
        : fileCache.get(task.gid);
    if (!incoming?.length) return { ...task, files: [] };
    rememberFiles(task.gid, incoming);
    return { ...task, files: incoming.length > 1 ? [incoming[0]] : incoming };
  });
}

let hydrating = false;

/** HTTP tasks have no bittorrent.name; pull files[0] once for the display name. */
async function hydrateMissingNames(client: Aria2Client): Promise<void> {
  if (hydrating) return;
  const missing = useAppStore
    .getState()
    .tasks.find(
      (task) =>
        !task.bittorrent?.info?.name && !task.files?.length && !task.infoHash
    );
  if (!missing) return;
  hydrating = true;
  try {
    const detail = await client.call<Pick<Aria2Task, "files">>(
      "tellStatus",
      missing.gid,
      ["files"]
    );
    const files = detail.files?.slice(0, 1) ?? [];
    if (files.length === 0) return;
    rememberFiles(missing.gid, files);
    useAppStore.setState((state) => ({
      tasks: state.tasks.map((task) =>
        task.gid === missing.gid ? { ...task, files } : task
      ),
    }));
  } catch {
    // Next refresh retries.
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
