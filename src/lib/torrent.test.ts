import { describe, expect, it } from "vitest";
import {
  controlFilePath,
  magnetInfoHash,
  normalizeInfoHash,
  torrentMeta,
} from "./torrent";

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

describe("torrentMeta", () => {
  it("hashes the info dict and reads the name", async () => {
    const torrent = ascii(
      "d8:announce15:http://tracker/4:infod6:lengthi3e4:name3:foo12:piece lengthi16e6:pieces20:01234567890123456789ee"
    );
    const meta = await torrentMeta(torrent);
    expect(meta.name).toBe("foo");
    expect(meta.infoHash).toMatch(/^[0-9a-f]{40}$/);

    const info = ascii(
      "d6:lengthi3e4:name3:foo12:piece lengthi16e6:pieces20:01234567890123456789e"
    );
    const digest = await crypto.subtle.digest("SHA-1", info);
    const expected = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(meta.infoHash).toBe(expected);
  });
});

describe("magnetInfoHash", () => {
  it("reads a hex btih", () => {
    expect(
      magnetInfoHash(
        "magnet:?xt=urn:btih:ABCDEF0123456789abcdef0123456789ABCDEF01&dn=x"
      )
    ).toBe("abcdef0123456789abcdef0123456789abcdef01");
  });

  it("reads a base32 btih", () => {
    const hash = magnetInfoHash(
      "magnet:?xt=urn:btih:MFRGGZDFMY======"
    );
    // 32-char hashes only; this short value should be rejected.
    expect(hash).toBeNull();
    expect(
      normalizeInfoHash("abcdefghijklmnopabcdefghijklmnop")
    ).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("controlFilePath", () => {
  it("places the .aria2 file next to the torrent payload", () => {
    expect(controlFilePath("/Volumes/HDD", "Cospuri")).toBe(
      "/Volumes/HDD/Cospuri.aria2"
    );
    expect(controlFilePath("D:\\data\\", "Show")).toBe("D:\\data\\Show.aria2");
  });
});
