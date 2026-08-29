import { describe, expect, it } from "vitest";
import {
  fileDownloadStatus,
  fileKind,
  fileName,
  fileProgress,
  filterFiles,
  isPayloadPath,
  sortFiles,
  type FileSortKey,
} from "@/lib/task-files";
import type { Aria2File } from "@/lib/types";

function file(
  index: string,
  path: string,
  length: string,
  completedLength: string
): Aria2File {
  return {
    index,
    path,
    length,
    completedLength,
    selected: "true",
    uris: [],
  };
}

const files = [
  file("1", "/dl/B-video.mp4", "1000", "1000"),
  file("2", "/dl/A-video.mp4", "4000", "1000"),
  file("10", "/dl/C-video.mp4", "2000", "200"),
];

describe("fileName", () => {
  it("returns the last path segment", () => {
    expect(fileName("/dl/foo/bar.mp4")).toBe("bar.mp4");
    expect(fileName("C:\\dl\\bar.mp4")).toBe("bar.mp4");
  });
});

describe("isPayloadPath", () => {
  it("rejects empty and magnet-metadata placeholders", () => {
    expect(isPayloadPath("")).toBe(false);
    expect(isPayloadPath("[METADATA]abc")).toBe(false);
    expect(isPayloadPath("/dl/video.mp4")).toBe(true);
  });
});

describe("fileProgress", () => {
  it("returns a 0–100 ratio", () => {
    expect(fileProgress(files[0])).toBe(100);
    expect(fileProgress(files[1])).toBe(25);
    expect(fileProgress(file("1", "x", "0", "0"))).toBe(0);
  });
});

describe("fileKind", () => {
  it("classifies common extensions", () => {
    expect(fileKind("/dl/show.MKV")).toBe("video");
    expect(fileKind("/dl/track.flac")).toBe("audio");
    expect(fileKind("/dl/cover.JPEG")).toBe("image");
    expect(fileKind("/dl/pack.tar.gz")).toBe("archive");
    expect(fileKind("/dl/readme.pdf")).toBe("document");
    expect(fileKind("/dl/file.nfo")).toBe("document");
    expect(fileKind("/dl/noext")).toBe("other");
    expect(fileKind("/dl/.hidden")).toBe("other");
  });
});

describe("fileDownloadStatus", () => {
  it("uses completed vs total length", () => {
    expect(fileDownloadStatus(file("1", "a.mp4", "100", "100"))).toBe("complete");
    expect(fileDownloadStatus(file("2", "a.mp4", "100", "40"))).toBe("partial");
    expect(fileDownloadStatus(file("3", "a.mp4", "100", "0"))).toBe("empty");
    expect(fileDownloadStatus(file("4", "a.mp4", "0", "0"))).toBe("empty");
  });
});

describe("filterFiles", () => {
  const mixed = [
    file("1", "/dl/done.mp4", "100", "100"),
    file("2", "/dl/mid.mkv", "100", "40"),
    file("3", "/dl/cover.jpg", "50", "50"),
    file("4", "/dl/pack.zip", "80", "0"),
  ];

  it("filters by download status and kind", () => {
    expect(filterFiles(mixed, "complete", "all").map(({ index }) => index)).toEqual([
      "1",
      "3",
    ]);
    expect(filterFiles(mixed, "all", "video").map(({ index }) => index)).toEqual([
      "1",
      "2",
    ]);
    expect(filterFiles(mixed, "empty", "archive").map(({ index }) => index)).toEqual([
      "4",
    ]);
  });
});

describe("sortFiles", () => {
  it("does not mutate the source list", () => {
    const before = files.map(({ index }) => index);
    sortFiles(files, "name");
    expect(files.map(({ index }) => index)).toEqual(before);
  });

  it.each<[FileSortKey, "asc" | "desc", string[]]>([
    ["index", "asc", ["1", "2", "10"]],
    ["index", "desc", ["10", "2", "1"]],
    ["name", "asc", ["2", "1", "10"]],
    ["size", "desc", ["2", "10", "1"]],
    ["progress", "desc", ["1", "2", "10"]],
    ["progress", "asc", ["10", "2", "1"]],
  ])("sorts by %s %s", (key, direction, expected) => {
    expect(sortFiles(files, key, direction).map(({ index }) => index)).toEqual(
      expected
    );
  });
});
