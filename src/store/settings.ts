import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { aria2 } from "./app";
import { setLocale, type LocaleSetting } from "@/lib/i18n";
import {
  normalizeSpeedLimit,
  normalizeUploadSpeedLimit,
  speedLimitToAria2,
} from "@/lib/speed-limit";
import { pausedGids, SKIP_INTEGRITY_OPTION } from "@/lib/integrity";
import { TASK_GID_KEYS, TASK_PAUSE_KEYS } from "@/lib/rpc-keys";
import type { Aria2Options, Aria2Task } from "@/lib/types";

export type ThemeMode = "system" | "light" | "dark";

export interface Settings {
  downloadDir: string;
  maxConcurrentDownloads: number;
  maxConnectionPerServer: number;
  split: number;
  /** Human-friendly speed strings: "0" unlimited, else e.g. "512K", "2M". */
  maxOverallDownloadLimit: string;
  maxOverallUploadLimit: string;
  seedRatio: number;
  /** BitTorrent listen port; pinned so a UPnP mapping is meaningful. */
  btPort: number;
  upnp: boolean;
  /** 0 keeps the RPC port random; a fixed port also pins the secret. */
  rpcPort: number;
  notifyOnComplete: boolean;
  watchClipboard: boolean;
  autoUpdateTrackers: boolean;
  theme: ThemeMode;
  language: LocaleSetting;
  autostart: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  downloadDir: "",
  maxConcurrentDownloads: 5,
  maxConnectionPerServer: 16,
  split: 16,
  maxOverallDownloadLimit: "0",
  maxOverallUploadLimit: "0",
  seedRatio: 1,
  btPort: 51413,
  upnp: false,
  rpcPort: 0,
  notifyOnComplete: true,
  watchClipboard: false,
  autoUpdateTrackers: true,
  theme: "system",
  language: "system",
  autostart: false,
};

/**
 * Only these are changeable on a live aria2 via changeGlobalOption; the rest
 * are per-download options we attach when a task is created.
 *
 * NOTE: do not set max-upload-limit / max-download-limit here as global
 * defaults — those belong on each task so changeOption can update the live
 * RequestGroup::maxUploadSpeedLimit_ field. Overall limits are process-wide.
 */
function globalOptions(settings: Settings): Aria2Options {
  const download = speedLimitToAria2(settings.maxOverallDownloadLimit);
  const upload = normalizeUploadSpeedLimit(settings.maxOverallUploadLimit);
  return {
    "max-concurrent-downloads": String(settings.maxConcurrentDownloads),
    "max-overall-download-limit": download,
    "max-overall-upload-limit": upload,
  };
}

function taskSpeedOptions(settings: Settings): Aria2Options {
  const download = speedLimitToAria2(settings.maxOverallDownloadLimit);
  const upload = normalizeUploadSpeedLimit(settings.maxOverallUploadLimit);
  return {
    "max-download-limit": download,
    "max-upload-limit": upload,
  };
}

/** Options stamped onto every new task, since aria2 cannot change them live. */
export function taskOptions(settings: Settings, trackers: string): Aria2Options {
  const options: Aria2Options = {
    split: String(settings.split),
    "max-connection-per-server": String(settings.maxConnectionPerServer),
    "seed-ratio": String(settings.seedRatio),
    ...taskSpeedOptions(settings),
    // One-shot for new BT tasks: piece-hash existing files when there is no
    // *.aria2 control file (Folx-style resume). Pause/unpause then turns this
    // off so remounting a disk does not re-verify the whole torrent.
    "check-integrity": "true",
  };
  if (settings.downloadDir) options.dir = settings.downloadDir;
  if (trackers) options["bt-tracker"] = trackers;
  return options;
}

const STORE_FILE = "settings.json";
const TRACKER_KEY = "btTrackers";
const MAX_LISTED = 1000;

let store: Store | null = null;

function normalizeSettingsSpeeds(settings: Settings): Settings {
  return {
    ...settings,
    maxOverallDownloadLimit: normalizeSpeedLimit(settings.maxOverallDownloadLimit),
    maxOverallUploadLimit: normalizeUploadSpeedLimit(
      settings.maxOverallUploadLimit
    ),
  };
}

/** Push per-task speed ceilings onto every live download (active + waiting). */
async function applySpeedLimitsToTasks(settings: Settings): Promise<void> {
  const client = aria2();
  const speed = taskSpeedOptions(settings);
  const [active, waiting] = await Promise.all([
    client.call<Aria2Task[]>("tellActive", TASK_GID_KEYS),
    client.call<Aria2Task[]>("tellWaiting", 0, MAX_LISTED, TASK_GID_KEYS),
  ]);
  await Promise.all(
    [...active, ...waiting].map((task) =>
      client.call("changeOption", task.gid, speed).catch(() => {
        // Task may have disappeared between list and change; ignore.
      })
    )
  );
}

/** Session-restored paused tasks still carry check-integrity=true from add. */
async function skipIntegrityOnPausedTasks(): Promise<void> {
  const client = aria2();
  const waiting = await client.call<Aria2Task[]>(
    "tellWaiting",
    0,
    MAX_LISTED,
    TASK_PAUSE_KEYS
  );
  const gids = pausedGids(waiting);
  if (gids.length === 0) return;
  await Promise.all(
    gids.map((gid) =>
      client.call("changeOption", gid, SKIP_INTEGRITY_OPTION).catch(() => {})
    )
  );
  await client.call("saveSession").catch(() => {});
}

interface SettingsState {
  settings: Settings;
  trackers: string;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  setTrackers: (trackers: string) => Promise<void>;
  /** Push the runtime-changeable subset to a (re)connected engine. */
  syncToEngine: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  trackers: "",
  loaded: false,

  async load() {
    if (get().loaded) return;
    store = await load(STORE_FILE, { autoSave: true });
    const saved = await store.get<Partial<Settings>>("settings");
    const trackers = (await store.get<string>(TRACKER_KEY)) ?? "";
    const settings = normalizeSettingsSpeeds({
      ...DEFAULT_SETTINGS,
      ...saved,
    });
    // Persist normalized speeds so the Rust engine sees the same units and
    // upload minimum before the frontend reconnects on the next launch.
    await store.set("settings", settings);
    setLocale(settings.language);
    set({ settings, trackers, loaded: true });
  },

  async update(patch) {
    const settings = normalizeSettingsSpeeds({ ...get().settings, ...patch });
    setLocale(settings.language);
    set({ settings });
    await store?.set("settings", settings);
    await get().syncToEngine();
  },

  async setTrackers(trackers) {
    set({ trackers });
    await store?.set(TRACKER_KEY, trackers);
  },

  async syncToEngine() {
    const { settings } = get();
    await aria2().call("changeGlobalOption", globalOptions(settings));
    // Overall limits cover the process; also re-stamp every live task so
    // session-restored downloads cannot keep a stale unlimited ceiling.
    try {
      await applySpeedLimitsToTasks(settings);
      await skipIntegrityOnPausedTasks();
    } catch {
      // tellActive/tellWaiting may race a reconnect; overall limit still holds.
    }
  },
}));
