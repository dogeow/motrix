import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import {
  abortRedundantIntegrityCheck,
  addTargets,
  pauseAll,
  persistSkipIntegrity,
  resumeAll,
  retryTask,
  tellStatus,
  toastError,
} from "./actions";
import { isRedundantIntegrityCheck } from "./integrity";
import { isRecoverableDirError } from "./retry";
import { formatSpeed, taskName } from "./format";
import { t } from "./i18n";
import { onAria2Notification, useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";

const CLIPBOARD_INTERVAL = 1500;
const LINK_PATTERN = /^(magnet:\?|https?:\/\/|ftp:\/\/)\S+$/i;
const DOCK_SPEED_UNITS = ["B", "KB", "MB", "GB", "TB"];

type Cleanup = () => void;

/** Dock labels stay legible at small sizes by using rounded whole units. */
function formatDockSpeed(value: number): string {
  let speed = Number.isFinite(value) && value > 0 ? value : 0;
  let unit = 0;
  while (speed >= 1024 && unit < DOCK_SPEED_UNITS.length - 1) {
    speed /= 1024;
    unit += 1;
  }
  return `${Math.round(speed)} ${DOCK_SPEED_UNITS[unit]}/s`;
}

async function handleTargets(targets: string[]): Promise<void> {
  if (targets.length === 0) return;
  try {
    const { added, resumed } = await addTargets(targets);
    if (resumed > 0) toast.success(t("add.continued", { count: resumed }));
    if (added > 0) toast.success(t("add.added", { count: added }));
  } catch (error) {
    toastError(error);
  }
}

/** Deep links, file associations and second-instance launches. */
async function wireOpenTargets(): Promise<Cleanup> {
  const unlisten = await listen<string[]>("open-targets", (event) => {
    void handleTargets(event.payload);
  });
  // Anything that arrived before this listener existed.
  const pending = await invoke<string[]>("take_pending_targets");
  void handleTargets(pending);
  return unlisten;
}

async function wireTrayCommands(): Promise<Cleanup> {
  return listen<string>("tray-command", (event) => {
    const run = event.payload === "pause-all" ? pauseAll : resumeAll;
    void run().catch(toastError);
  });
}

async function wireEngineEvents(): Promise<Cleanup> {
  const down = await listen<string>("engine-down", (event) => {
    toast.error(t("engine.down", { reason: event.payload }), { id: "engine" });
  });
  const started = await listen("engine-started", () => {
    toast.success(t("engine.ready"), { id: "engine" });
  });
  return () => {
    down();
    started();
  };
}

/**
 * Apply persisted runtime settings once both the store and aria2 RPC are
 * ready. Re-arm after every reconnect so an engine restart cannot lose them.
 */
function wireSettingsSync(): Cleanup {
  let syncedForConnection = false;

  const syncIfReady = () => {
    const connected = useAppStore.getState().connected;
    const loaded = useSettingsStore.getState().loaded;
    if (!connected) {
      syncedForConnection = false;
      return;
    }
    if (!loaded || syncedForConnection) return;

    syncedForConnection = true;
    void useSettingsStore
      .getState()
      .syncToEngine()
      .catch(() => {
        // A reconnect re-arms this; direct edits surface their own error toast.
        syncedForConnection = false;
      });
  };

  const unsubscribeApp = useAppStore.subscribe(syncIfReady);
  const unsubscribeSettings = useSettingsStore.subscribe(syncIfReady);
  syncIfReady();

  return () => {
    unsubscribeApp();
    unsubscribeSettings();
  };
}

/** Dropping .torrent files or a link onto the window adds them. */
async function wireDragDrop(): Promise<Cleanup> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") return;
    const paths = event.payload.paths.filter((path) =>
      /\.torrent$/i.test(path)
    );
    if (paths.length === 0) {
      toast.info(t("add.dropOnlyTorrent"));
      return;
    }
    void handleTargets(paths);
  });
}

/** Offer to download a link the moment it lands on the clipboard. */
function wireClipboard(): Cleanup {
  let lastSeen = "";
  const timer = setInterval(async () => {
    if (!useSettingsStore.getState().settings.watchClipboard) return;
    let text: string;
    try {
      text = (await readText())?.trim() ?? "";
    } catch {
      return;
    }
    if (!text || text === lastSeen || !LINK_PATTERN.test(text)) return;
    lastSeen = text;

    const alreadyQueued = useAppStore
      .getState()
      .tasks.some((task) => task.files?.[0]?.uris[0]?.uri === text);
    if (alreadyQueued) return;

    toast(t("clipboard.found"), {
      description: text.length > 60 ? `${text.slice(0, 60)}…` : text,
      action: {
        label: t("clipboard.download"),
        onClick: () => void handleTargets([text]),
      },
    });
  }, CLIPBOARD_INTERVAL);

  return () => clearInterval(timer);
}

/**
 * After the first createInitialCommand, persist check-integrity=false so the
 * next unpause or app launch trusts the *.aria2 bitfield instead of re-hashing.
 */
function wireSkipIntegrityAfterStart(): Cleanup {
  return onAria2Notification((method, gid) => {
    if (method !== "aria2.onDownloadStart" && method !== "aria2.onDownloadPause") {
      return;
    }
    void persistSkipIntegrity(gid).catch(() => {
      // Task may have finished or been removed before the option write.
    });
  });
}

/** Remount/unpause re-hashes still in flight: stop them and continue. */
function wireRedundantIntegritySkip(): Cleanup {
  const inFlight = new Set<string>();
  const failed = new Set<string>();

  const scan = (tasks: ReturnType<typeof useAppStore.getState>["tasks"]) => {
    const pausedByUser = useAppStore.getState().pausedByUserGids;
    for (const task of tasks) {
      if (!isRedundantIntegrityCheck(task)) continue;
      if (pausedByUser.includes(task.gid)) continue;
      if (inFlight.has(task.gid) || failed.has(task.gid)) continue;
      inFlight.add(task.gid);
      void abortRedundantIntegrityCheck(task)
        .catch(() => {
          failed.add(task.gid);
        })
        .finally(() => {
          inFlight.delete(task.gid);
        });
    }
  };

  scan(useAppStore.getState().tasks);
  return useAppStore.subscribe((state) => scan(state.tasks));
}

/**
 * After a removable volume comes back, retry tasks that failed with
 * permission-denied / missing-directory errors.
 */
function wireDirErrorRecovery(): Cleanup {
  const inFlight = new Set<string>();
  const budget = new Map<string, number>();

  const scan = (tasks: ReturnType<typeof useAppStore.getState>["tasks"]) => {
    for (const task of tasks) {
      if (task.status !== "error") continue;
      if (!isRecoverableDirError(task.errorMessage)) continue;
      const key = `${task.infoHash ?? task.gid}:${task.dir}`;
      if (inFlight.has(key) || (budget.get(key) ?? 0) >= 2) continue;
      inFlight.add(key);
      void invoke<boolean>("dir_is_writable", { path: task.dir })
        .then((writable) => {
          if (!writable) return;
          budget.set(key, (budget.get(key) ?? 0) + 1);
          return retryTask(task, { promptForDir: false });
        })
        .catch(() => {
          // Volume still locked or retry failed; wait for the next scan.
        })
        .finally(() => {
          inFlight.delete(key);
        });
    }
  };

  scan(useAppStore.getState().tasks);
  return useAppStore.subscribe((state) => scan(state.tasks));
}

/** Notify once per finished download. */
function wireCompletionNotices(): Cleanup {
  let granted = false;
  void (async () => {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  })();

  const detach = onAria2Notification((method, gid) => {
    if (
      method !== "aria2.onDownloadComplete" &&
      method !== "aria2.onBtDownloadComplete"
    ) {
      return;
    }
    if (!useSettingsStore.getState().settings.notifyOnComplete) return;

    void tellStatus(gid)
      .then((task) => {
        const title = taskName(task);
        if (granted) {
          sendNotification({ title: t("notify.complete"), body: title });
        } else {
          toast.success(t("notify.completeBody", { name: title }));
        }
      })
      .catch(() => {
        // Task vanished between the notification and the status query.
      });
  });
  return detach;
}

/** Mirror aggregate speeds onto macOS system chrome and task progress. */
function wireStatusIndicators(): Cleanup {
  let lastTitle: string | undefined;
  let lastDockSpeeds: string | undefined;
  let lastProgress: number | null | undefined;

  const update = (state: ReturnType<typeof useAppStore.getState>) => {
    const active = state.tasks.filter((task) => task.status === "active");
    const downloadSpeed = Number(state.stat?.downloadSpeed ?? 0);
    const uploadSpeed = Number(state.stat?.uploadSpeed ?? 0);
    const title =
      downloadSpeed > 0
        ? `↓ ${formatSpeed(downloadSpeed)}`
        : "";
    if (title !== lastTitle) {
      lastTitle = title;
      void invoke("set_tray_title", { title: title || null });
      void invoke("set_tray_tooltip", {
        tooltip: title ? `Motrix — ${title}` : "Motrix",
      });
    }

    const showSpeeds =
      Number(state.stat?.numActive ?? 0) > 0 ||
      downloadSpeed > 0 ||
      uploadSpeed > 0;
    const download = showSpeeds ? formatDockSpeed(downloadSpeed) : "";
    const upload = showSpeeds ? formatDockSpeed(uploadSpeed) : "";
    const dockSpeeds = showSpeeds ? `${download}|${upload}` : "";
    if (dockSpeeds !== lastDockSpeeds) {
      lastDockSpeeds = dockSpeeds;
      void invoke("set_dock_speeds", {
        download: showSpeeds ? download : null,
        upload: showSpeeds ? upload : null,
      });
    }

    const total = active.reduce((sum, task) => sum + Number(task.totalLength), 0);
    const done = active.reduce(
      (sum, task) => sum + Number(task.completedLength),
      0
    );
    const progress = total > 0 ? (done / total) * 100 : null;
    if (progress !== lastProgress) {
      lastProgress = progress;
      void invoke("set_progress", { progress });
    }
  };

  update(useAppStore.getState());
  const unsubscribe = useAppStore.subscribe(update);
  return () => {
    unsubscribe();
    void invoke("set_tray_title", { title: null });
    void invoke("set_tray_tooltip", { tooltip: "Motrix" });
    void invoke("set_dock_speeds", { download: null, upload: null });
    void invoke("set_progress", { progress: null });
  };
}

/** Wire every OS-level integration; returns a single teardown. */
export async function initIntegrations(): Promise<Cleanup> {
  const cleanups = await Promise.all([
    wireOpenTargets(),
    wireTrayCommands(),
    wireEngineEvents(),
    wireDragDrop(),
    Promise.resolve(wireClipboard()),
    Promise.resolve(wireCompletionNotices()),
    Promise.resolve(wireSkipIntegrityAfterStart()),
    Promise.resolve(wireRedundantIntegritySkip()),
    Promise.resolve(wireDirErrorRecovery()),
    Promise.resolve(wireSettingsSync()),
    Promise.resolve(wireStatusIndicators()),
  ]);
  return () => cleanups.forEach((cleanup) => cleanup());
}
