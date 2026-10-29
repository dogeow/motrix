import { useCallback, useMemo } from "react";
import {
  CircleAlert,
  Inbox,
  LoaderCircle,
  Plus,
  RotateCcw,
  SearchX,
} from "lucide-react";
import { TaskItem } from "@/components/TaskItem";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useVirtualTaskList } from "@/hooks/useVirtualTaskList";
import { t } from "@/lib/i18n";
import type { Aria2Task, Category } from "@/lib/types";

interface TaskListProps {
  tasks: readonly Aria2Task[];
  category: Category;
  query: string;
  sortKey?: string;
  statusFilter?: string;
  initError: string | null;
  refreshError: string | null;
  loading: boolean;
  connected: boolean;
  busy: boolean;
  onRefresh: () => void;
  onAddTask: () => void;
  onClearSearch: () => void;
  selectedGids: ReadonlySet<string>;
  onSelectedChange: (task: Aria2Task, selected: boolean) => void;
  onRemove: (task: Aria2Task) => void;
  onInspect: (task: Aria2Task) => void;
}

export function TaskList({
  tasks,
  category,
  query,
  sortKey = "added",
  statusFilter = "all",
  initError,
  refreshError,
  loading,
  connected,
  busy,
  onRefresh,
  onAddTask,
  onClearSearch,
  selectedGids,
  onSelectedChange,
  onRemove,
  onInspect,
}: TaskListProps) {
  const keys = useMemo(() => tasks.map((task) => task.gid), [tasks]);
  const { viewportRef, listRef, layout, rows, measureRow, retainFocusedRow } =
    useVirtualTaskList(keys, JSON.stringify([category, query, sortKey, statusFilter]));
  const filtered = Boolean(query.trim()) || statusFilter !== "all";

  return (
    <ScrollArea
      className="min-h-0 flex-1 bg-muted/15"
      aria-busy={loading}
      viewportRef={viewportRef}
      viewportProps={{ tabIndex: 0, "aria-label": t("task.list") }}
    >
      {initError ? (
        <EmptyState
          icon={<CircleAlert className="size-6 text-destructive" />}
          title={t("engine.startFailed")}
          detail={initError}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RotateCcw className="size-4" /> {t("engine.reconnect")}
            </Button>
          }
        />
      ) : !connected && tasks.length === 0 ? (
        <EmptyState
          icon={<LoaderCircle className="size-6 animate-spin" />}
          title={t("engine.connecting")}
        />
      ) : loading ? (
        <EmptyState
          icon={<LoaderCircle className="size-6 animate-spin" />}
          title={t("detail.loading")}
        />
      ) : refreshError && tasks.length === 0 ? (
        <EmptyState
          icon={<CircleAlert className="size-6 text-destructive" />}
          title={t("empty.loadFailed")}
          detail={refreshError}
          action={
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RotateCcw className="size-4" />
              {t("common.retry")}
            </Button>
          }
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={
            filtered ? (
              <SearchX className="size-6" />
            ) : (
              <Inbox className="size-6" />
            )
          }
          title={filtered ? t("empty.noMatch") : t(`empty.${category}`)}
          detail={
            query.trim()
              ? t("empty.searchHint", { query: query.trim() })
              : filtered
                ? t("empty.filterHint")
              : category === "all" || category === "active"
                ? t("empty.hint")
                : undefined
          }
          action={
            filtered ? (
              <Button variant="outline" size="sm" onClick={onClearSearch}>
                {t("toolbar.clearFilters")}
              </Button>
            ) : category === "all" || category === "active" ? (
              <Button size="sm" onClick={onAddTask}>
                <Plus className="size-4" />
                {t("toolbar.addTask")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2 p-3">
          {(!connected || refreshError) && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground"
            >
              <CircleAlert className="size-4 shrink-0" />
              {connected ? t("empty.refreshFailed") : t("engine.disconnected")}
            </div>
          )}
          <div
            ref={listRef}
            role="list"
            aria-label={t("task.list")}
            className="relative"
            style={{ height: layout.totalHeight, overflowAnchor: "none" }}
          >
            {rows.map((index) => {
              const task = tasks[index];
              return (
                <VirtualTaskRow
                  key={task.gid}
                  task={task}
                  top={layout.offsets[index]}
                  position={index + 1}
                  total={tasks.length}
                  selected={selectedGids.has(task.gid)}
                  disabled={busy || !connected}
                  measureRow={measureRow}
                  retainFocusedRow={retainFocusedRow}
                  onSelectedChange={onSelectedChange}
                  onRemove={onRemove}
                  onInspect={onInspect}
                />
              );
            })}
          </div>
        </div>
      )}
    </ScrollArea>
  );
}

function VirtualTaskRow({
  top,
  position,
  total,
  measureRow,
  retainFocusedRow,
  ...props
}: React.ComponentProps<typeof TaskItem> & {
  top: number;
  position: number;
  total: number;
  measureRow: (key: string, element: HTMLDivElement | null) => void;
  retainFocusedRow: (key: string) => void;
}) {
  const gid = props.task.gid;
  const rowRef = useCallback(
    (element: HTMLDivElement | null) => measureRow(gid, element),
    [gid, measureRow]
  );
  return (
    <div
      ref={rowRef}
      role="listitem"
      aria-posinset={position}
      aria-setsize={total}
      data-task-row={gid}
      className="absolute inset-x-0"
      style={{ top }}
      onFocusCapture={() => retainFocusedRow(gid)}
    >
      <TaskItem {...props} />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium" role="status">
        {title}
      </p>
      {detail && (
        <p className="max-w-md break-all text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      )}
      {action}
    </div>
  );
}
