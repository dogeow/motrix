import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AddTaskDialog } from "@/components/AddTaskDialog";
import { PreferencesDialog } from "@/components/PreferencesDialog";
import { RemoveTaskDialog } from "@/components/RemoveTaskDialog";
import { TaskDetailDialog } from "@/components/TaskDetailDialog";
import { AppToolbar } from "@/components/app/AppToolbar";
import { SelectionToolbar } from "@/components/app/SelectionToolbar";
import { StatusBar } from "@/components/app/StatusBar";
import { TaskList } from "@/components/app/TaskList";
import { Toaster } from "@/components/ui/sonner";
import { ClearHistoryDialog } from "@/components/ClearHistoryDialog";
import { useAppShortcuts } from "@/hooks/useAppShortcuts";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAppLifecycle } from "@/hooks/useAppLifecycle";
import { useTaskSelection } from "@/hooks/useTaskSelection";
import { useTheme } from "@/hooks/useTheme";
import {
  batch,
  pauseAll,
  pauseTask,
  resumeAll,
  resumeTask,
} from "@/lib/actions";
import { canPauseTask, canResumeTask } from "@/lib/task-actions";
import { t, useTranslation } from "@/lib/i18n";
import { filterAndSortTasks, type SortKey } from "@/lib/task-list";
import type { Aria2Task } from "@/lib/types";
import { useAppStore } from "@/store/app";

export default function App() {
  const resolvedTheme = useTheme();
  useAppLifecycle();
  // Subscribing re-renders every label when the locale changes.
  useTranslation();

  const connected = useAppStore((state) => state.connected);
  const category = useAppStore((state) => state.category);
  const tasks = useAppStore((state) => state.tasks);
  const stat = useAppStore((state) => state.stat);
  const initError = useAppStore((state) => state.initError);
  const loading = useAppStore((state) => state.loading);
  const refreshError = useAppStore((state) => state.refreshError);
  const refresh = useAppStore((state) => state.refresh);
  const setCategory = useAppStore((state) => state.setCategory);

  const [addOpen, setAddOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [removeTargets, setRemoveTargets] = useState<Aria2Task[]>([]);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<Aria2Task | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const searchRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useAsyncAction();

  const visibleTasks = useMemo(
    () => filterAndSortTasks(tasks, query, sortKey),
    [query, sortKey, tasks]
  );
  const {
    selectedGids,
    selectedTasks,
    setTaskSelected,
    clearSelection,
    selectAll,
    deselectTasks,
  } = useTaskSelection(visibleTasks);
  const resumableTasks = selectedTasks.filter(canResumeTask);
  const pausableTasks = selectedTasks.filter(canPauseTask);

  useAppShortcuts({
    dialogOpen:
      addOpen ||
      prefsOpen ||
      Boolean(inspectTarget) ||
      removeTargets.length > 0 ||
      purgeOpen,
    busy,
    searchRef,
    onAddTask: () => setAddOpen(true),
    onSelectAll: selectAll,
    onClearSelection: clearSelection,
  });

  const runBatch = async (
    label: string,
    targets: Aria2Task[],
    action: (task: Aria2Task) => Promise<unknown>
  ) => {
    if (!targets.length) return;
    const { done, failed, succeededGids } = await batch(targets, action);
    deselectTasks(succeededGids);
    if (failed > 0) {
      toast.warning(
        t("selection.batchPartial", { action: label, done, failed })
      );
    } else {
      toast.success(t("selection.batchDone", { action: label, count: done }));
    }
  };

  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <AppToolbar
        connected={connected}
        busy={busy}
        searchRef={searchRef}
        category={category}
        stat={stat}
        query={query}
        sortKey={sortKey}
        onCategoryChange={setCategory}
        onQueryChange={setQuery}
        onSortChange={setSortKey}
        onPurgeStopped={() => setPurgeOpen(true)}
        onPauseAll={() => void run(pauseAll)}
        onResumeAll={() => void run(resumeAll)}
        onOpenPreferences={() => setPrefsOpen(true)}
        onAddTask={() => setAddOpen(true)}
      />

      <SelectionToolbar
        count={selectedTasks.length}
        total={visibleTasks.length}
        busy={busy}
        canStart={connected && resumableTasks.length > 0}
        canPause={connected && pausableTasks.length > 0}
        connected={connected}
        onSelectAll={selectAll}
        onStart={() =>
          void run(() =>
            runBatch(t("common.start"), resumableTasks, resumeTask)
          )
        }
        onPause={() =>
          void run(() => runBatch(t("common.pause"), pausableTasks, pauseTask))
        }
        onRemove={() => setRemoveTargets([...selectedTasks])}
        onClear={clearSelection}
      />

      <TaskList
        tasks={visibleTasks}
        category={category}
        query={query}
        initError={initError}
        loading={loading}
        connected={connected}
        refreshError={refreshError}
        busy={busy}
        onRefresh={() => void refresh()}
        onAddTask={() => setAddOpen(true)}
        onClearSearch={() => setQuery("")}
        selectedGids={selectedGids}
        onSelectedChange={setTaskSelected}
        onRemove={(task) => setRemoveTargets([task])}
        onInspect={setInspectTarget}
      />

      <StatusBar connected={connected} stat={stat} initError={initError} />

      <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} />
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
      <RemoveTaskDialog
        key={removeTargets.map((task) => task.gid).join(",")}
        tasks={removeTargets}
        onRemoved={deselectTasks}
        onClose={() => setRemoveTargets([])}
      />
      <ClearHistoryDialog open={purgeOpen} onOpenChange={setPurgeOpen} />
      <TaskDetailDialog
        task={inspectTarget}
        onClose={() => setInspectTarget(null)}
      />
      <Toaster theme={resolvedTheme} position="bottom-right" />
    </div>
  );
}
