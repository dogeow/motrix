import type { Aria2File } from "@/lib/types";

export type FileSortKey = "index" | "name" | "size" | "progress";
export type FileDownloadStatus = "complete" | "partial" | "empty";
export type FileKind =
  | "video"
  | "audio"
  | "image"
  | "archive"
  | "document"
  | "other";
export type FileStatusFilter = "all" | FileDownloadStatus;
export type FileKindFilter = "all" | FileKind;

export const FILE_SORT_KEYS: readonly FileSortKey[] = [
  "index",
  "name",
  "size",
  "progress",
];

export const FILE_STATUS_FILTERS: readonly FileStatusFilter[] = [
  "all",
  "complete",
  "partial",
  "empty",
];

export const FILE_KIND_FILTERS: readonly FileKindFilter[] = [
  "all",
  "video",
  "audio",
  "image",
  "archive",
  "document",
  "other",
];

export const FILE_SORT_DEFAULT_DIR: Record<FileSortKey, "asc" | "desc"> = {
  index: "asc",
  name: "asc",
  size: "desc",
  progress: "desc",
};

const KIND_BY_EXT: Record<string, Exclude<FileKind, "other">> = {
  mp4: "video",
  m4v: "video",
  mkv: "video",
  avi: "video",
  mov: "video",
  wmv: "video",
  flv: "video",
  webm: "video",
  mpeg: "video",
  mpg: "video",
  m2ts: "video",
  mts: "video",
  ts: "video",
  "3gp": "video",
  vob: "video",
  rm: "video",
  rmvb: "video",
  asf: "video",
  f4v: "video",
  ogv: "video",
  mp3: "audio",
  flac: "audio",
  wav: "audio",
  aac: "audio",
  m4a: "audio",
  ogg: "audio",
  opus: "audio",
  wma: "audio",
  aiff: "audio",
  ape: "audio",
  alac: "audio",
  dts: "audio",
  ac3: "audio",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  tiff: "image",
  tif: "image",
  heic: "image",
  heif: "image",
  svg: "image",
  avif: "image",
  ico: "image",
  dng: "image",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  zst: "archive",
  lz: "archive",
  lzma: "archive",
  iso: "archive",
  dmg: "archive",
  img: "archive",
  cab: "archive",
  pdf: "document",
  doc: "document",
  docx: "document",
  xls: "document",
  xlsx: "document",
  ppt: "document",
  pptx: "document",
  txt: "document",
  rtf: "document",
  odt: "document",
  ods: "document",
  odp: "document",
  epub: "document",
  mobi: "document",
  csv: "document",
  md: "document",
  nfo: "document",
};

export function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

export function fileExtension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function fileKind(path: string): FileKind {
  return KIND_BY_EXT[fileExtension(path)] ?? "other";
}

/** False for empty paths and aria2's magnet-metadata placeholder. */
export function isPayloadPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("[METADATA]");
}

/** Completed ratio 0–100. */
export function fileProgress(file: Aria2File): number {
  const total = Number(file.length);
  if (total <= 0) return 0;
  return (Number(file.completedLength) / total) * 100;
}

export function fileDownloadStatus(file: Aria2File): FileDownloadStatus {
  const total = Number(file.length);
  const done = Number(file.completedLength);
  if (total > 0 && done >= total) return "complete";
  if (done > 0) return "partial";
  return "empty";
}

export function filterFiles(
  files: readonly Aria2File[],
  status: FileStatusFilter,
  kind: FileKindFilter
): Aria2File[] {
  return files.filter((file) => {
    if (status !== "all" && fileDownloadStatus(file) !== status) return false;
    if (kind !== "all" && fileKind(file.path) !== kind) return false;
    return true;
  });
}

export function sortFiles(
  files: readonly Aria2File[],
  key: FileSortKey,
  direction: "asc" | "desc" = FILE_SORT_DEFAULT_DIR[key]
): Aria2File[] {
  const sorted = [...files];
  const dir = direction === "asc" ? 1 : -1;
  switch (key) {
    case "index":
      sorted.sort((a, b) => (Number(a.index) - Number(b.index)) * dir);
      break;
    case "name":
      sorted.sort(
        (a, b) =>
          fileName(a.path).localeCompare(fileName(b.path), "zh", {
            numeric: true,
          }) * dir
      );
      break;
    case "size":
      sorted.sort((a, b) => (Number(a.length) - Number(b.length)) * dir);
      break;
    case "progress":
      sorted.sort((a, b) => (fileProgress(a) - fileProgress(b)) * dir);
      break;
  }
  return sorted;
}

export function filterAndSortFiles(
  files: readonly Aria2File[],
  status: FileStatusFilter,
  kind: FileKindFilter,
  sortKey: FileSortKey,
  direction: "asc" | "desc"
): Aria2File[] {
  return sortFiles(filterFiles(files, status, kind), sortKey, direction);
}
