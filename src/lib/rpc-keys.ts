/** Keys for the 1s task list. Never include `files` or `bitfield`. */
export const TASK_LIST_KEYS = [
  "gid",
  "status",
  "totalLength",
  "completedLength",
  "uploadLength",
  "downloadSpeed",
  "uploadSpeed",
  "connections",
  "dir",
  "infoHash",
  "bittorrent",
  "errorCode",
  "errorMessage",
  "numSeeders",
  "seeder",
  "verifiedLength",
  "verifyIntegrityPending",
] as const;

/** Duplicate lookup when adding a torrent; still no file list / bitfield. */
export const TASK_LOOKUP_KEYS = [
  "gid",
  "status",
  "dir",
  "infoHash",
  "bittorrent",
  "verifiedLength",
  "verifyIntegrityPending",
] as const;

export const TASK_GID_KEYS = ["gid"] as const;

export const TASK_PAUSE_KEYS = [
  "gid",
  "status",
  "bittorrent",
  "completedLength",
  "verifiedLength",
  "verifyIntegrityPending",
] as const;
