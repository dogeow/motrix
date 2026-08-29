import type { Aria2Task } from "./types";

/** BT tasks often have no HTTP URI; the info hash is enough to resume. */
export function retryUri(task: Aria2Task): string | null {
  const uri = task.files?.[0]?.uris[0]?.uri;
  if (uri) return uri;
  if (task.infoHash) return `magnet:?xt=urn:btih:${task.infoHash}`;
  return null;
}

export function isRecoverableDirError(message?: string): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return (
    text.includes("permission denied") ||
    text.includes("no such file or directory") ||
    text.includes("failed to make the directory") ||
    text.includes("unable to open") ||
    text.includes("no such file")
  );
}
