const TEXT = new TextDecoder("ascii");

export interface TorrentMeta {
  infoHash: string;
  name: string;
}

function skipBencode(data: Uint8Array, index: number): number {
  if (index >= data.length) {
    throw new Error("truncated bencode");
  }
  const marker = data[index];
  if (marker === 105) {
    const end = data.indexOf(101, index + 1);
    if (end < 0) throw new Error("truncated integer");
    return end + 1;
  }
  if (marker === 108 || marker === 100) {
    let cursor = index + 1;
    while (cursor < data.length && data[cursor] !== 101) {
      cursor = skipBencode(data, cursor);
      if (marker === 100) cursor = skipBencode(data, cursor);
    }
    if (cursor >= data.length) throw new Error("truncated collection");
    return cursor + 1;
  }
  let length = 0;
  let cursor = index;
  while (cursor < data.length && data[cursor] >= 48 && data[cursor] <= 57) {
    length = length * 10 + (data[cursor] - 48);
    cursor += 1;
  }
  if (cursor >= data.length || data[cursor] !== 58) {
    throw new Error("invalid bencode string");
  }
  const start = cursor + 1;
  const end = start + length;
  if (end > data.length) throw new Error("truncated string");
  return end;
}

function readByteString(data: Uint8Array, index: number): {
  value: string;
  next: number;
} {
  let length = 0;
  let cursor = index;
  while (cursor < data.length && data[cursor] >= 48 && data[cursor] <= 57) {
    length = length * 10 + (data[cursor] - 48);
    cursor += 1;
  }
  if (cursor >= data.length || data[cursor] !== 58) {
    throw new Error("invalid bencode string");
  }
  const start = cursor + 1;
  const end = start + length;
  if (end > data.length) throw new Error("truncated string");
  return { value: TEXT.decode(data.subarray(start, end)), next: end };
}

async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-1 of the bencoded `info` dictionary, as a lowercase hex info hash. */
export async function torrentMeta(data: Uint8Array): Promise<TorrentMeta> {
  if (data[0] !== 100) throw new Error("not a torrent");
  let cursor = 1;
  let infoHash: string | null = null;
  let name = "";
  while (cursor < data.length && data[cursor] !== 101) {
    const key = readByteString(data, cursor);
    const valueStart = key.next;
    const valueEnd = skipBencode(data, valueStart);
    if (key.value === "info") {
      infoHash = await sha1Hex(data.subarray(valueStart, valueEnd));
      name = torrentName(data.subarray(valueStart, valueEnd));
    }
    cursor = valueEnd;
  }
  if (!infoHash) throw new Error("torrent has no info dict");
  return { infoHash, name };
}

function torrentName(info: Uint8Array): string {
  if (info[0] !== 100) return "";
  let cursor = 1;
  let name = "";
  while (cursor < info.length && info[cursor] !== 101) {
    const key = readByteString(info, cursor);
    const valueStart = key.next;
    const valueEnd = skipBencode(info, valueStart);
    if (key.value === "name.utf-8") {
      const parsed = nameFromBytes(info, valueStart, valueEnd);
      if (parsed) return parsed;
    }
    if (key.value === "name" && !name) {
      name = nameFromBytes(info, valueStart, valueEnd);
    }
    cursor = valueEnd;
  }
  return name;
}

function nameFromBytes(data: Uint8Array, start: number, end: number): string {
  try {
    const parsed = readByteString(data, start);
    if (parsed.next !== end) return "";
    return parsed.value;
  } catch {
    return "";
  }
}

const HEX_HASH = /^[0-9a-f]{40}$/;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32Hash(value: string): string | null {
  const padded = value.toUpperCase().replace(/=+$/, "");
  if (padded.length !== 32) return null;
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of padded) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  if (bytes.length !== 20) return null;
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeInfoHash(value: string): string | null {
  const trimmed = value.trim();
  const hex = trimmed.toLowerCase();
  if (HEX_HASH.test(hex)) return hex;
  return decodeBase32Hash(trimmed);
}

/** v1 magnet `xt=urn:btih:` payload as a lowercase hex info hash. */
export function magnetInfoHash(uri: string): string | null {
  const match = /[?&]xt=urn:btih:([^&]+)/i.exec(uri);
  if (!match) return null;
  return normalizeInfoHash(decodeURIComponent(match[1]));
}

export function controlFilePath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const root = dir.replace(/[\\/]+$/, "");
  return `${root}${sep}${name}.aria2`;
}
