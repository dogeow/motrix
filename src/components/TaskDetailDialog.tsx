import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getFiles,
  getPeers,
  getServers,
  openFile,
  revealFile,
  selectFiles,
  toastError,
} from "@/lib/actions";
import { formatBytes, formatSpeed, taskName } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  createFileSelectionDraft,
  startDetailPolling,
} from "@/lib/task-detail-session";
import {
  FILE_KIND_FILTERS,
  FILE_SORT_DEFAULT_DIR,
  FILE_SORT_KEYS,
  FILE_STATUS_FILTERS,
  fileName,
  fileProgress,
  filterAndSortFiles,
  isPayloadPath,
  type FileKindFilter,
  type FileSortKey,
  type FileStatusFilter,
} from "@/lib/task-files";
import type { Aria2File, Aria2Peer, Aria2ServerEntry, Aria2Task } from "@/lib/types";

interface TaskDetailDialogProps {
  task: Aria2Task | null;
  onClose: () => void;
}

const REFRESH_INTERVAL = 2000;
const FILE_ROW_HEIGHT = 52;
const FILE_LIST_HEIGHT = 288;

type DetailTab = "files" | "peers" | "servers";

export function TaskDetailDialog({ task, onClose }: TaskDetailDialogProps) {
  return (
    <TaskDetailContent key={task?.gid ?? "closed"} task={task} onClose={onClose} />
  );
}

function TaskDetailContent({ task, onClose }: TaskDetailDialogProps) {
  const [files, setFiles] = useState<Aria2File[]>(() => task?.files ?? []);
  const [peers, setPeers] = useState<Aria2Peer[]>([]);
  const [servers, setServers] = useState<Aria2ServerEntry[]>([]);
  const [selectionDraft] = useState(() =>
    createFileSelectionDraft(task?.files ?? [])
  );
  const [{ selection, dirty, saving }, setSelectionState] = useState(() =>
    selectionDraft.snapshot()
  );
  const [loading, setLoading] = useState(
    Boolean(task) && (task?.files?.length ?? 0) === 0
  );
  const [extraLoading, setExtraLoading] = useState(false);
  const [tab, setTab] = useState<DetailTab>("files");
  const [fileSort, setFileSort] = useState<FileSortKey>("progress");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<FileStatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<FileKindFilter>("all");

  const gid = task?.gid ?? null;
  const isBt = Boolean(task?.bittorrent);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const activeTab: DetailTab = !isBt && tab === "peers" ? "files" : tab;

  useEffect(() => {
    if (!gid) return;
    return startDetailPolling({
      load: async () => {
        const revision = selectionDraft.snapshot().revision;
        return { list: await getFiles(gid), revision };
      },
      onResult: ({ list, revision }) => {
        setFiles(list);
        selectionDraft.sync(list, revision);
        setSelectionState(selectionDraft.snapshot());
      },
      onSettled: () => setLoading(false),
      interval: REFRESH_INTERVAL,
    });
  }, [gid, selectionDraft]);

  useEffect(() => {
    if (!gid || activeTab === "files") return;
    setExtraLoading(true);
    if (activeTab === "peers") {
      return startDetailPolling({
        load: () => getPeers(gid),
        onResult: setPeers,
        onSettled: () => setExtraLoading(false),
        interval: REFRESH_INTERVAL,
      });
    }
    return startDetailPolling({
      load: () => getServers(gid),
      onResult: setServers,
      onSettled: () => setExtraLoading(false),
      interval: REFRESH_INTERVAL,
    });
  }, [gid, activeTab, isBt]);

  const toggle = useCallback(
    (index: string, checked: boolean) => {
      selectionDraft.toggle([index], checked);
      setSelectionState(selectionDraft.snapshot());
    },
    [selectionDraft]
  );

  const toggleVisible = useCallback(
    (checked: boolean, visible: readonly { index: string }[]) => {
      selectionDraft.toggle(visible.map((file) => file.index), checked);
      setSelectionState(selectionDraft.snapshot());
    },
    [selectionDraft]
  );

  const handleSave = async () => {
    if (!gid) return;
    if (selection.size === 0) {
      toast.info(t("detail.needOneFile"));
      return;
    }
    const submitted = selectionDraft.beginSave();
    if (!submitted) return;
    setSelectionState(selectionDraft.snapshot());
    try {
      await selectFiles(gid, submitted.indexes);
      if (!mountedRef.current) return;
      selectionDraft.completeSave(submitted);
      setSelectionState(selectionDraft.snapshot());
      toast.success(t("detail.saved"));
    } catch (error) {
      if (!mountedRef.current) return;
      selectionDraft.failSave(submitted);
      setSelectionState(selectionDraft.snapshot());
      toastError(error);
    }
  };

  const handleSortChange = (key: FileSortKey) => {
    setFileSort(key);
    setSortDir(FILE_SORT_DEFAULT_DIR[key]);
  };

  const visibleFiles = useMemo(
    () => filterAndSortFiles(files, statusFilter, kindFilter, fileSort, sortDir),
    [files, statusFilter, kindFilter, fileSort, sortDir]
  );
  const multiFile = files.length > 1;
  const filtered = statusFilter !== "all" || kindFilter !== "all";
  const allVisibleSelected =
    visibleFiles.length > 0 &&
    visibleFiles.every((file) => selection.has(file.index));
  const someVisibleSelected =
    visibleFiles.some((file) => selection.has(file.index)) && !allVisibleSelected;

  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("detail.title")}</DialogTitle>
          <DialogDescription className="truncate">
            {task ? taskName(task) : ""}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setTab(value as DetailTab)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="files" className="flex-1">
              {t("detail.files")}{" "}
              {files.length > 0 &&
                (filtered
                  ? t("detail.filterCount", {
                      shown: visibleFiles.length,
                      total: files.length,
                    })
                  : files.length)}
            </TabsTrigger>
            {isBt && (
              <TabsTrigger value="peers" className="flex-1">
                {t("detail.peers")} {peers.length > 0 && peers.length}
              </TabsTrigger>
            )}
            <TabsTrigger value="servers" className="flex-1">
              {t("detail.servers")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="files" className="mt-3">
            {multiFile && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Checkbox
                  checked={
                    allVisibleSelected
                      ? true
                      : someVisibleSelected
                        ? "indeterminate"
                        : false
                  }
                  disabled={visibleFiles.length === 0}
                  onCheckedChange={(checked) =>
                    toggleVisible(checked === true, visibleFiles)
                  }
                  aria-label={t("detail.selectAll")}
                />
                <Select
                  value={statusFilter}
                  onValueChange={(value) =>
                    setStatusFilter(value as FileStatusFilter)
                  }
                >
                  <SelectTrigger size="sm" aria-label={t("detail.statusFilter")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {FILE_STATUS_FILTERS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {fileStatusLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={kindFilter}
                  onValueChange={(value) => setKindFilter(value as FileKindFilter)}
                >
                  <SelectTrigger size="sm" aria-label={t("detail.kindFilter")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {FILE_KIND_FILTERS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {fileKindLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={fileSort}
                  onValueChange={(value) => handleSortChange(value as FileSortKey)}
                >
                  <SelectTrigger size="sm" aria-label={t("toolbar.sort")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {FILE_SORT_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {key === "index"
                          ? t("detail.sortIndex")
                          : t(`sort.${key}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() =>
                    setSortDir((current) => (current === "asc" ? "desc" : "asc"))
                  }
                  aria-label={
                    sortDir === "asc" ? t("detail.sortAsc") : t("detail.sortDesc")
                  }
                  title={
                    sortDir === "asc" ? t("detail.sortAsc") : t("detail.sortDesc")
                  }
                >
                  {sortDir === "asc" ? (
                    <ArrowUp className="size-3.5" />
                  ) : (
                    <ArrowDown className="size-3.5" />
                  )}
                </Button>
                <span
                  className="ml-auto text-xs tabular-nums text-muted-foreground"
                  aria-live="polite"
                >
                  {t("detail.selectionCount", {
                    selected: selection.size,
                    total: files.length,
                  })}
                </span>
              </div>
            )}
            {loading ? (
              <LoadingPane />
            ) : files.length === 0 ? (
              <EmptyPane>{t("detail.noFiles")}</EmptyPane>
            ) : visibleFiles.length === 0 ? (
              <EmptyPane>{t("detail.noFilterMatch")}</EmptyPane>
            ) : (
              <VirtualList
                key={`${fileSort}-${sortDir}-${statusFilter}-${kindFilter}`}
                count={visibleFiles.length}
                itemHeight={FILE_ROW_HEIGHT}
                height={FILE_LIST_HEIGHT}
                getKey={(index) => visibleFiles[index]?.index ?? index}
              >
                {(index) => {
                  const file = visibleFiles[index];
                  if (!file) return null;
                  return (
                    <FileRow
                      file={file}
                      multiFile={multiFile}
                      checked={selection.has(file.index)}
                      onToggle={toggle}
                    />
                  );
                }}
              </VirtualList>
            )}
            {multiFile && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("detail.selectHint")}
              </p>
            )}
          </TabsContent>

          {isBt && (
            <TabsContent value="peers" className="mt-3">
              {extraLoading && peers.length === 0 ? (
                <LoadingPane />
              ) : peers.length === 0 ? (
                <EmptyPane>{t("detail.noPeers")}</EmptyPane>
              ) : (
                <ScrollArea className="h-72 rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="p-2 text-left font-medium">
                          {t("detail.address")}
                        </th>
                        <th className="p-2 text-right font-medium">
                          {t("detail.down")}
                        </th>
                        <th className="p-2 text-right font-medium">
                          {t("detail.up")}
                        </th>
                        <th className="p-2 text-right font-medium">
                          {t("detail.type")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y tabular-nums">
                      {peers.map((peer) => (
                        <tr key={`${peer.ip}:${peer.port}`}>
                          <td className="p-2 font-mono">
                            {peer.ip}:{peer.port}
                          </td>
                          <td className="p-2 text-right">
                            {formatSpeed(peer.downloadSpeed)}
                          </td>
                          <td className="p-2 text-right">
                            {formatSpeed(peer.uploadSpeed)}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {peer.seeder === "true"
                              ? t("detail.seeder")
                              : t("detail.leecher")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </TabsContent>
          )}

          <TabsContent value="servers" className="mt-3">
            {extraLoading && servers.length === 0 ? (
              <LoadingPane />
            ) : servers.length === 0 ? (
              <EmptyPane>{t("detail.noServers")}</EmptyPane>
            ) : (
              <ScrollArea className="h-72 rounded-md border">
                <div className="divide-y">
                  {servers.flatMap((entry) =>
                    entry.servers.map((server) => (
                      <div key={`${entry.index}-${server.uri}`} className="p-2.5">
                        <p
                          className="truncate font-mono text-xs"
                          title={server.currentUri}
                        >
                          {server.currentUri}
                        </p>
                        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                          {formatSpeed(server.downloadSpeed)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {dirty && (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                selectionDraft.discard();
                setSelectionState(selectionDraft.snapshot());
              }}
            >
              {t("detail.discard")}
            </Button>
          )}
          <Button
            onClick={() => (dirty ? void handleSave() : onClose())}
            disabled={saving}
          >
            {saving
              ? t("detail.saving")
              : dirty
                ? t("detail.save")
                : t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fileStatusLabel(value: FileStatusFilter): string {
  switch (value) {
    case "all":
      return t("detail.statusAll");
    case "complete":
      return t("detail.statusComplete");
    case "partial":
      return t("detail.statusPartial");
    case "empty":
      return t("detail.statusEmpty");
  }
}

function fileKindLabel(value: FileKindFilter): string {
  switch (value) {
    case "all":
      return t("detail.kindAll");
    case "video":
      return t("detail.kindVideo");
    case "audio":
      return t("detail.kindAudio");
    case "image":
      return t("detail.kindImage");
    case "archive":
      return t("detail.kindArchive");
    case "document":
      return t("detail.kindDocument");
    case "other":
      return t("detail.kindOther");
  }
}

function FileRow({
  file,
  multiFile,
  checked,
  onToggle,
}: {
  file: Aria2File;
  multiFile: boolean;
  checked: boolean;
  onToggle: (index: string, checked: boolean) => void;
}) {
  const name = fileName(file.path);
  const progress = fileProgress(file);
  const path = file.path;
  const canOpen = isPayloadPath(path);

  const handleOpen = () => {
    if (!canOpen) return;
    void openFile(path).catch(toastError);
  };

  const handleReveal = () => {
    if (!canOpen) return;
    void revealFile(path).catch(toastError);
  };

  const stopRow = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <div
      className="flex h-full items-center gap-2 border-b px-2.5"
      title={canOpen ? t("detail.openHint") : undefined}
      onDoubleClick={handleOpen}
    >
      {multiFile && (
        <div onClick={stopRow} onDoubleClick={stopRow}>
          <Checkbox
            checked={checked}
            onCheckedChange={(value) => onToggle(file.index, value === true)}
            aria-label={t("task.select", { name })}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs" title={file.path}>
          {name}
        </p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatBytes(file.completedLength)} / {formatBytes(file.length)}
      </span>
      <div
        className="flex shrink-0 items-center text-muted-foreground"
        onClick={stopRow}
        onDoubleClick={stopRow}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!canOpen}
          onClick={handleOpen}
          aria-label={t("detail.openFile")}
          title={t("detail.openFile")}
        >
          <ExternalLink />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!canOpen}
          onClick={handleReveal}
          aria-label={t("detail.revealFile")}
          title={t("detail.revealFile")}
        >
          <FolderOpen />
        </Button>
      </div>
    </div>
  );
}

function VirtualList({
  count,
  itemHeight,
  height,
  getKey,
  children,
}: {
  count: number;
  itemHeight: number;
  height: number;
  getKey?: (index: number) => string | number;
  children: (index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const onScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setScrollTop(el.scrollTop);
    });
  };

  const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visible = Math.ceil(height / itemHeight);
  const end = Math.min(count, start + visible + overscan * 2);

  return (
    <div
      ref={parentRef}
      className="overflow-auto overscroll-contain rounded-md border"
      style={{ height }}
      onScroll={onScroll}
    >
      <div className="relative w-full" style={{ height: count * itemHeight }}>
        {Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
          const index = start + offset;
          return (
            <div
              key={getKey?.(index) ?? index}
              className="absolute right-0 left-0"
              style={{ top: index * itemHeight, height: itemHeight }}
            >
              {children(index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LoadingPane() {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-md border text-xs text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" />
      {t("detail.loading")}
    </div>
  );
}

function EmptyPane({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-72 items-center justify-center rounded-md border">
      <p className="p-4 text-center text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
