import { t } from "./i18n";
import type { Aria2Task, Aria2Uri } from "./types";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** aria2 names a magnet task "[METADATA]<infoHash>" until the torrent arrives. */
const METADATA_PREFIX = "[METADATA]";

export function formatBytes(value: number | string): string {
  let bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  let unit = 0;
  while (bytes >= 1024 && unit < UNITS.length - 1) {
    bytes /= 1024;
    unit += 1;
  }
  return `${bytes.toFixed(unit === 0 ? 0 : 1)} ${UNITS[unit]}`;
}

export function formatSpeed(value: number | string): string {
  return `${formatBytes(value)}/s`;
}

export function formatEta(task: Aria2Task): string {
  const total = Number(task.totalLength);
  const completed = Number(task.completedLength);
  const speed = Number(task.downloadSpeed);
  if (total <= 0 || speed <= 0) return "--";
  const seconds = Math.round((total - completed) / speed);
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** Display name from a magnet link's `dn` parameter, if it carries one. */
function magnetDisplayName(uris: Aria2Uri[]): string | null {
  for (const { uri } of uris) {
    const query = uri.indexOf("?");
    if (!uri.startsWith("magnet:") || query < 0) continue;
    const dn = new URLSearchParams(uri.slice(query + 1)).get("dn");
    if (dn) return dn;
  }
  return null;
}

export function taskName(task: Aria2Task): string {
  const btName = task.bittorrent?.info?.name;
  if (btName) return btName;

  const file = task.files?.[0];

  if (file?.path?.startsWith(METADATA_PREFIX)) {
    // aria2 suffixes the magnet's dn when it has one, else the info hash.
    const suffix = file.path.slice(METADATA_PREFIX.length);
    if (suffix && !/^[0-9a-f]{40}$/i.test(suffix)) return suffix;

    const dn = magnetDisplayName(file.uris);
    if (dn) return dn;

    const hash = suffix || task.infoHash || "";
    return hash
      ? t("task.magnet", { hash: hash.slice(0, 8) })
      : t("task.magnetPending");
  }

  if (file?.path) {
    const segments = file.path.replace(/\\/g, "/").split("/");
    const name = segments[segments.length - 1];
    if (name) return name;
  }
  const uri = file?.uris[0]?.uri;
  if (uri) {
    try {
      const url = new URL(uri);
      const name = decodeURIComponent(
        url.pathname.split("/").filter(Boolean).pop() ?? ""
      );
      if (name) return name;
      return url.hostname;
    } catch {
      return uri;
    }
  }
  if (task.infoHash) return task.infoHash;
  return task.gid;
}

export function taskProgress(task: Aria2Task): number {
  const total = Number(task.totalLength);
  const completed = Number(task.completedLength);
  if (total <= 0) return 0;
  return Math.min(100, (completed / total) * 100);
}

/** Absolute path of the task's primary payload on disk. */
export function taskFilePath(task: Aria2Task): string | null {
  // Magnet metadata placeholder tasks have no real payload on disk.
  if (task.files?.[0]?.path?.startsWith(METADATA_PREFIX)) return null;

  const btName = task.bittorrent?.info?.name;
  if (btName) {
    const sep = task.dir.includes("\\") ? "\\" : "/";
    return `${task.dir}${sep}${btName}`;
  }
  return task.files?.[0]?.path || null;
}
