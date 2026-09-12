import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { isEngineUnavailable } from "@/lib/aria2";
import { TASK_LOOKUP_KEYS, TASK_PAUSE_KEYS } from "@/lib/rpc-keys";
import { aria2, useAppStore } from "@/store/app";
import { taskOptions, useSettingsStore } from "@/store/settings";
import { taskFilePath, taskName } from "./format";
import { isPayloadPath } from "./task-files";
import { t } from "./i18n";
import {
  isRedundantIntegrityCheck,
  isVerifying,
  pausedGids,
  SKIP_INTEGRITY_OPTION,
} from "./integrity";
import { retryUri } from "./retry";
import {
  controlFilePath,
  magnetInfoHash,
  normalizeInfoHash,
  torrentMeta,
} from "./torrent";
import type {
  Aria2File,
  Aria2Options,
  Aria2Peer,
  Aria2ServerEntry,
  Aria2Task,
} from "./types";

function refresh(): void {
  void useAppStore.getState().refresh();
}

/** Per-task defaults from preferences, with an explicit dir taking priority. */
function newTaskOptions(dir?: string): Aria2Options {
  const { settings, trackers } = useSettingsStore.getState();
  const options = taskOptions(settings, trackers);
  if (dir) options.dir = dir;
  return options;
}

export interface AddUrisResult {
  added: number;
  resumed: number;
  failed: { uri: string; error: string }[];
}

export type AddBtResult =
  | { action: "added" }
  | { action: "resumed"; dir: string; name: string }
  | { action: "alreadyActive"; dir: string; name: string }
  | { action: "complete"; dir: string; name: string };

const MAX_LISTED = 1000;

async function listKnownTasks(): Promise<Aria2Task[]> {
  const client = aria2();
  const [active, waiting, stopped] = await Promise.all([
    client.call<Aria2Task[]>("tellActive", TASK_LOOKUP_KEYS),
    client.call<Aria2Task[]>("tellWaiting", 0, MAX_LISTED, TASK_LOOKUP_KEYS),
    client
      .call<Aria2Task[]>("tellStopped", 0, MAX_LISTED, TASK_LOOKUP_KEYS)
      .catch(() => [] as Aria2Task[]),
  ]);
  return [...active, ...waiting, ...stopped];
}

async function findTaskByInfoHash(
  infoHash: string
): Promise<Aria2Task | undefined> {
  const wanted = normalizeInfoHash(infoHash);
  if (!wanted) return undefined;
  const tasks = await listKnownTasks();
  return tasks.find(
    (task) => normalizeInfoHash(task.infoHash ?? "") === wanted
  );
}

async function continueExistingBt(
  task: Aria2Task
): Promise<AddBtResult | null> {
  const name = taskName(task);
  const dir = task.dir;
  if (task.status === "complete") return { action: "complete", dir, name };
  if (task.status === "active" || task.status === "waiting") {
    return { action: "alreadyActive", dir, name };
  }
  if (task.status === "paused") {
    await resumeTask(task);
    return { action: "resumed", dir, name };
  }
  return null;
}

async function skipIntegrityIfControlFile(
  dir: string | undefined,
  name: string
): Promise<Aria2Options> {
  const options = newTaskOptions(dir);
  if (!dir || !name) return options;
  try {
    const exists = await invoke<boolean>("path_exists", {
      path: controlFilePath(dir, name),
    });
    if (exists) options["check-integrity"] = "false";
  } catch {
    // Missing fs probe should not block adding the task.
  }
  return options;
}

export async function addUris(
  uris: string[],
  dir?: string
): Promise<AddUrisResult> {
  const failed: AddUrisResult["failed"] = [];
  let added = 0;
  let resumed = 0;
  for (const uri of uris) {
    try {
      const hash = magnetInfoHash(uri);
      if (hash) {
        const existing = await findTaskByInfoHash(hash);
        if (existing) {
          const continued = await continueExistingBt(existing);
          if (continued) {
            resumed += 1;
            continue;
          }
          await aria2().call(
            "addUri",
            [uri],
            await skipIntegrityIfControlFile(existing.dir, taskName(existing))
          );
          added += 1;
          continue;
        }
      }
      await aria2().call("addUri", [uri], newTaskOptions(dir));
      added += 1;
    } catch (error) {
      failed.push({
        uri,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  refresh();
  return { added, resumed, failed };
}

/** Route anything dropped/pasted/deep-linked to the right aria2 call. */
export async function addTargets(
  targets: string[]
): Promise<{ added: number; resumed: number }> {
  let added = 0;
  let resumed = 0;
  const uris: string[] = [];
  for (const target of targets) {
    if (/\.torrent$/i.test(target) && !/^[a-z]+:\/\//i.test(target)) {
      try {
        const result = await addTorrent(target);
        if (result.action === "added") added += 1;
        else resumed += 1;
      } catch (error) {
        toastError(error);
      }
    } else {
      uris.push(target);
    }
  }
  if (uris.length > 0) {
    const result = await addUris(uris);
    added += result.added;
    resumed += result.resumed;
    if (result.failed.length > 0) toast.error(result.failed[0].error);
  }
  return { added, resumed };
}

export async function pickTorrentFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: t("add.tabTorrent"), extensions: ["torrent"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function addTorrent(
  path: string,
  dir?: string
): Promise<AddBtResult> {
  const base64 = await invoke<string>("read_file_base64", { path });
  const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  let taskDir = dir;
  let name = "";
  try {
    const meta = await torrentMeta(binary);
    name = meta.name;
    const existing = await findTaskByInfoHash(meta.infoHash);
    if (existing) {
      const continued = await continueExistingBt(existing);
      if (continued) return continued;
      taskDir = existing.dir;
    }
  } catch {
    // Still add; aria2 will reject an invalid torrent.
  }
  await aria2().call(
    "addTorrent",
    base64,
    [],
    await skipIntegrityIfControlFile(taskDir, name)
  );
  refresh();
  return { action: "added" };
}

export async function pickDirectory(
  defaultPath?: string
): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
  });
  return typeof selected === "string" ? selected : null;
}

async function skipIntegrityCheck(gid: string): Promise<void> {
  await aria2().call("changeOption", gid, SKIP_INTEGRITY_OPTION);
}

async function skipIntegrityChecks(gids: string[]): Promise<void> {
  await Promise.all(
    gids.map((gid) =>
      skipIntegrityCheck(gid).catch(() => {
        // Task may have disappeared between list and change.
      })
    )
  );
}

/** Keep check-integrity off after the first start so session restore won't re-hash. */
export async function persistSkipIntegrity(gid: string): Promise<void> {
  await skipIntegrityCheck(gid);
}

export async function pauseTask(task: Aria2Task): Promise<void> {
  useAppStore.getState().clearStarting([task.gid]);
  useAppStore.getState().markPausedByUser([task.gid]);
  try {
    if (isVerifying(task) && task.status === "active") {
      await aria2().call("forcePause", task.gid);
    } else {
      try {
        await aria2().call("pause", task.gid);
      } catch (error) {
        if (isEngineUnavailable(error)) throw error;
        await aria2().call("forcePause", task.gid);
      }
    }
  } catch (error) {
    useAppStore.getState().clearPausedByUser([task.gid]);
    throw error;
  }
  await skipIntegrityCheck(task.gid).catch(() => {});
  refresh();
}

export async function resumeTask(task: Aria2Task): Promise<void> {
  const store = useAppStore.getState();
  store.markStarting([task.gid]);
  store.clearPausedByUser([task.gid]);
  try {
    await skipIntegrityCheck(task.gid).catch(() => {});
    await aria2().call("unpause", task.gid);
  } catch (error) {
    store.clearStarting([task.gid]);
    throw error;
  }
  refresh();
}

export async function pauseAll(): Promise<void> {
  const store = useAppStore.getState();
  store.clearStarting(store.startingGids);
  store.markPausedByUser(
    store.tasks
      .filter((task) => task.status === "active" || task.status === "waiting")
      .map((task) => task.gid)
  );
  const [active, waiting] = await Promise.all([
    aria2().call<Aria2Task[]>("tellActive", TASK_PAUSE_KEYS),
    aria2().call<Aria2Task[]>("tellWaiting", 0, MAX_LISTED, TASK_PAUSE_KEYS),
  ]);
  const live = [...active, ...waiting];
  useAppStore.getState().markPausedByUser(live.map((task) => task.gid));
  await skipIntegrityChecks(live.map((task) => task.gid));
  const verifying = active.filter(
    (task) => isVerifying(task) && task.status === "active"
  );
  await Promise.all(
    verifying.map((task) =>
      aria2()
        .call("forcePause", task.gid)
        .catch(() => {})
    )
  );
  await aria2().call("pauseAll");
  refresh();
}

export async function resumeAll(): Promise<void> {
  const store = useAppStore.getState();
  const localGids = pausedGids(store.tasks);
  store.markStarting(localGids);
  store.clearPausedByUser(localGids);
  try {
    const waiting = await aria2().call<Aria2Task[]>(
      "tellWaiting",
      0,
      MAX_LISTED,
      TASK_PAUSE_KEYS
    );
    const gids = pausedGids(waiting);
    store.markStarting(gids);
    store.clearPausedByUser(gids);
    await skipIntegrityChecks(gids);
    await aria2().call("unpauseAll");
  } catch (error) {
    const current = useAppStore.getState();
    current.clearStarting(current.startingGids);
    throw error;
  }
  refresh();
}

export async function purgeStopped(): Promise<void> {
  await aria2().call("purgeDownloadResult");
  refresh();
}

const STOPPED: ReadonlySet<string> = new Set(["complete", "error", "removed"]);

const REMOVE_PAUSE_POLL_MS = 100;
const REMOVE_PAUSE_ATTEMPTS = 30;

/** Hash checking must leave the active state before aria2 can remove it. */
async function stopIntegrityCheck(task: Aria2Task): Promise<void> {
  if (!isVerifying(task) || task.status !== "active") return;

  await aria2().call("forcePause", task.gid);
  for (let attempt = 0; attempt < REMOVE_PAUSE_ATTEMPTS; attempt += 1) {
    const current = await aria2().call<Pick<Aria2Task, "status">>(
      "tellStatus",
      task.gid,
      ["status"]
    );
    if (current.status !== "active") return;
    await new Promise((resolve) => setTimeout(resolve, REMOVE_PAUSE_POLL_MS));
  }
}

/**
 * Stop a remount/unpause re-hash and continue from the *.aria2 bitfield.
 * First-time Folx-style checks (no recorded progress yet) are left running.
 */
export async function abortRedundantIntegrityCheck(
  task: Aria2Task
): Promise<void> {
  if (!isRedundantIntegrityCheck(task)) return;
  if (useAppStore.getState().pausedByUserGids.includes(task.gid)) return;
  await skipIntegrityCheck(task.gid);
  await stopIntegrityCheck(task);
  if (useAppStore.getState().pausedByUserGids.includes(task.gid)) return;
  await aria2().call("unpause", task.gid);
  refresh();
}

export async function removeTask(
  task: Aria2Task,
  deleteFiles: boolean
): Promise<void> {
  // The confirmation keeps a stable target, but its status can change while
  // it is open (for example, a download may finish before confirmation).
  const current = await aria2().call<Partial<Aria2Task>>(
    "tellStatus",
    task.gid,
    TASK_PAUSE_KEYS
  );
  task = { ...task, ...current };
  // Snapshot paths before remove — the RPC gid is gone afterwards.
  const listed = deleteFiles
    ? (task.files?.length ?? 0) > 1
      ? task.files
      : await getFiles(task.gid).catch(() => task.files ?? [])
    : [];

  if (STOPPED.has(task.status)) {
    await aria2().call("removeDownloadResult", task.gid);
  } else {
    if (isVerifying(task)) {
      await stopIntegrityCheck(task);
      await aria2().call("forceRemove", task.gid);
    } else {
      try {
        await aria2().call("remove", task.gid);
      } catch {
        await aria2().call("forceRemove", task.gid);
      }
    }
    // Drop the stopped record too so the task disappears entirely.
    try {
      await aria2().call("removeDownloadResult", task.gid);
    } catch {
      // aria2 moves the task to the stopped list asynchronously; retry once
      // shortly after so no ghost "removed" record lingers there.
      setTimeout(() => {
        void aria2()
          .call("removeDownloadResult", task.gid)
          .catch(() => {})
          .finally(refresh);
      }, 800);
    }
  }

  if (deleteFiles) {
    // Trash only the files aria2 registered for this task — never the
    // whole "<dir>/<torrent name>" directory, which may pre-date the
    // download and contain unrelated user files.
    const files = listed
      .map((file) => file.path)
      .filter((path) => path && !path.startsWith("[METADATA]"));
    if (files.length > 0) {
      await invoke("trash_task_files", {
        files,
        baseDir: task.dir,
        controlRoot: taskFilePath(task),
      });
    }
  }
  refresh();
}

export async function revealTask(task: Aria2Task): Promise<void> {
  const path = taskFilePath(task);
  try {
    await invoke("reveal_in_folder", { path: path ?? task.dir });
  } catch {
    // File may not exist yet (e.g. metadata-only stage); fall back to the dir.
    await invoke("reveal_in_folder", { path: task.dir });
  }
}

/** Open a downloaded file with the system default app. */
export async function openFile(path: string): Promise<void> {
  if (!isPayloadPath(path)) throw new Error(t("detail.fileMissing"));
  try {
    await invoke("open_path", { path });
  } catch {
    throw new Error(t("detail.fileMissing"));
  }
}

/** Reveal `path` in the file manager and select it when the file exists. */
export async function revealFile(path: string): Promise<void> {
  if (!isPayloadPath(path)) throw new Error(t("detail.fileMissing"));
  await invoke("reveal_in_folder", { path });
}

/** Open a task's payload (the file, or the torrent folder). */
export async function openTask(task: Aria2Task): Promise<void> {
  const path = taskFilePath(task) ?? task.dir;
  await openFile(path);
}

export async function copyTaskLink(task: Aria2Task): Promise<boolean> {
  const uri = task.files?.[0]?.uris[0]?.uri;
  if (!uri) return false;
  await navigator.clipboard.writeText(uri);
  return true;
}

/** Re-queue a failed task from its original URI or torrent info hash. */
export async function retryTask(
  task: Aria2Task,
  options?: { dir?: string; promptForDir?: boolean }
): Promise<void> {
  const uri = retryUri(task);
  if (!uri) throw new Error(t("task.noRetryLink"));
  const dest = options?.dir ?? task.dir;
  try {
    await invoke("ensure_download_dir", { path: dest });
  } catch {
    if (options?.promptForDir === false) throw new Error(t("task.dirDenied"));
    const selected = await pickDirectory(dest);
    if (!selected) throw new Error(t("task.dirDenied"));
    await retryTask(task, { dir: selected, promptForDir: false });
    return;
  }
  const addOptions = await skipIntegrityIfControlFile(dest, taskName(task));
  await aria2().call("addUri", [uri], addOptions);
  try {
    await aria2().call("removeDownloadResult", task.gid);
  } catch {
    // Record may already be gone.
  }
  refresh();
}

/** Run an action over many tasks, collecting failures instead of aborting. */
export async function batch(
  tasks: Aria2Task[],
  action: (task: Aria2Task) => Promise<unknown>
): Promise<{ done: number; failed: number; succeededGids: string[] }> {
  const results = await Promise.allSettled(tasks.map(action));
  refresh();
  return {
    done: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
    succeededGids: results.flatMap((result, index) =>
      result.status === "fulfilled" ? [tasks[index].gid] : []
    ),
  };
}

export function tellStatus(gid: string): Promise<Aria2Task> {
  return aria2().call<Aria2Task>("tellStatus", gid);
}

export function getFiles(gid: string): Promise<Aria2File[]> {
  return aria2().call<Aria2File[]>("getFiles", gid);
}

export function getPeers(gid: string): Promise<Aria2Peer[]> {
  return aria2().call<Aria2Peer[]>("getPeers", gid);
}

export function getServers(gid: string): Promise<Aria2ServerEntry[]> {
  return aria2().call<Aria2ServerEntry[]>("getServers", gid);
}

/** aria2 wants 1-based file indexes, comma separated; empty means "all". */
export async function selectFiles(
  gid: string,
  indexes: string[]
): Promise<void> {
  await aria2().call("changeOption", gid, {
    "select-file": indexes.join(","),
  });
  refresh();
}

const TRACKER_SOURCE =
  "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt";

/**
 * Refresh the tracker list from ngosang/trackerslist and push it to running
 * BT tasks. Goes through the Rust HTTP client because the webview would be
 * blocked by CORS.
 */
export async function updateTrackers(): Promise<number> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  const response = await tauriFetch(TRACKER_SOURCE, { method: "GET" });
  if (!response.ok) {
    throw new Error(t("tracker.fetchFailed", { status: response.status }));
  }

  const list = (await response.text())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (list.length === 0) throw new Error(t("tracker.empty"));

  const joined = list.join(",");
  await useSettingsStore.getState().setTrackers(joined);

  // Live BT tasks accept a new tracker list without a restart.
  const tasks = useAppStore.getState().tasks.filter((task) => task.bittorrent);
  await Promise.allSettled(
    tasks.map((task) =>
      aria2().call("changeOption", task.gid, { "bt-tracker": joined })
    )
  );
  return list.length;
}

export function toastAddBtResult(result: AddBtResult): void {
  switch (result.action) {
    case "added":
      toast.success(t("add.torrentAdded"));
      break;
    case "resumed":
      toast.success(t("add.resumed", { dir: result.dir }));
      break;
    case "alreadyActive":
      toast.info(t("add.alreadyActive", { dir: result.dir }));
      break;
    case "complete":
      toast.info(t("add.alreadyComplete", { dir: result.dir }));
      break;
  }
}

export function toastError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error));
}

export function describeTask(task: Aria2Task): string {
  return taskName(task);
}
