import { Fragment, memo, type ReactNode } from "react";
import {
  CircleCheck,
  Copy,
  Download,
  EllipsisVertical,
  ExternalLink,
  FolderOpen,
  Info,
  LoaderCircle,
  Magnet,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  copyTaskLink,
  openTask,
  pauseTask,
  resumeTask,
  retryTask,
  revealTask,
  toastError,
} from "@/lib/actions";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  taskName,
  taskProgress,
} from "@/lib/format";
import { t, useTranslation } from "@/lib/i18n";
import {
  btPeerCounts,
  isConnectingTask,
  verifyBadge,
} from "@/lib/integrity";
import { cn } from "@/lib/utils";
import type { Aria2Task } from "@/lib/types";
import { useAppStore } from "@/store/app";

import { useAsyncAction } from "@/hooks/useAsyncAction";
import { canPauseTask, canResumeTask } from "@/lib/task-actions";

interface TaskItemProps {
  task: Aria2Task;
  selected: boolean;
  disabled: boolean;
  onSelectedChange: (task: Aria2Task, selected: boolean) => void;
  onRemove: (task: Aria2Task) => void;
  onInspect: (task: Aria2Task) => void;
}

export const TaskItem = memo(function TaskItem({
  task,
  selected,
  disabled,
  onSelectedChange,
  onRemove,
  onInspect,
}: TaskItemProps) {
  useTranslation();
  const { busy, run } = useAsyncAction();
  const name = taskName(task);
  const progress = taskProgress(task);
  const isBt = Boolean(task.bittorrent);
  const running = task.status === "active";
  const paused = task.status === "paused";
  const complete = task.status === "complete";
  const errored = task.status === "error";
  const total = Number(task.totalLength);
  const pausedByUser = useAppStore((state) => state.pausedByUserGids.includes(task.gid));
  const starting = useAppStore((state) => state.startingGids.includes(task.gid)) && paused;
  const connecting = isConnectingTask(task);
  const queued = task.status === "waiting" && !starting;
  const badge = verifyBadge(task, pausedByUser ? [task.gid] : []);
  const verifying = badge === "verifying" || badge === "stopping";
  const verifyPending = badge === "pending";
  const stoppingVerify = badge === "stopping";
  const verified = Number(task.verifiedLength ?? 0);
  const verifyProgress =
    total > 0 ? Math.min(100, (verified / total) * 100) : 0;
  const visibleProgress = verifying ? verifyProgress : progress;
  const seeding =
    running && isBt && total > 0 && task.completedLength === task.totalLength;

  const handleToggle = async () => {
    try {
      if (canPauseTask(task)) await pauseTask(task);
      else if (canResumeTask(task)) await resumeTask(task);
    } catch (error) {
      toastError(error);
    }
  };

  const handleCopy = async () => {
    try {
      const copied = await copyTaskLink(task);
      if (copied) toast.success(t("task.linkCopied"));
      else toast.info(t("task.noLink"));
    } catch (error) {
      toastError(error);
    }
  };

  const handleRetry = async () => {
    try {
      await retryTask(task);
      toast.success(t("task.requeued"));
    } catch (error) {
      toastError(error);
    }
  };

  const meta: ReactNode[] = [];
  if (verifying) {
    meta.push(
      t("task.verified", {
        verified: formatBytes(verified),
        total: formatBytes(total),
      })
    );
    if (total > 0) meta.push(`${verifyProgress.toFixed(1)}%`);
  } else if (complete) {
    meta.push(formatBytes(task.totalLength));
  } else {
    meta.push(
      `${formatBytes(task.completedLength)} / ${formatBytes(task.totalLength)}`
    );
    if (total > 0) meta.push(`${progress.toFixed(1)}%`);
  }
  if (running && !verifying && !verifyPending) {
    if (connecting) {
      meta.push(isBt ? t("task.seekingPeersHint") : t("task.connectingHint"));
    } else {
      meta.push(`↓ ${formatSpeed(task.downloadSpeed)}`);
      if (isBt) {
        meta.push(`↑ ${formatSpeed(task.uploadSpeed)}`);
      }
      if (!seeding) meta.push(t("task.eta", { eta: formatEta(task) }));
      if (isBt) {
        const peers = btPeerCounts(task);
        meta.push(
          t("task.connections", {
            count: `${peers.seeders}/${peers.connections}`,
          })
        );
      }
    }
  }
  if (starting) meta.push(t("task.startingHint"));

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
        selected
          ? "border-primary/25 bg-accent"
          : "border-border/60 bg-card hover:border-border hover:bg-accent/30"
      )}
    >
      <Checkbox
        checked={selected}
        disabled={disabled || busy}
        onCheckedChange={(checked) => onSelectedChange(task, checked === true)}
        aria-label={t("task.select", { name })}
      />
      <div className="relative size-9 shrink-0" aria-hidden="true">
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-lg",
            errored
              ? "bg-destructive/10 text-destructive"
              : complete
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
          )}
        >
          {errored ? (
            <TriangleAlert className="size-4" />
          ) : complete ? (
            <CircleCheck className="size-4" />
          ) : isBt ? (
            <Magnet className="size-4" />
          ) : (
            <Download className="size-4" />
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onInspect(task)}
            className="min-w-0 truncate rounded text-left text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            title={name}
          >
            {name}
          </button>
          {complete && (
            <Badge
              variant="outline"
              className="shrink-0 text-emerald-600 dark:text-emerald-400"
            >
              {t("status.complete")}
            </Badge>
          )}
          {errored && (
            <Badge variant="outline" className="shrink-0 text-destructive">
              {t("status.error")}
            </Badge>
          )}
          {seeding && (
            <Badge variant="secondary" className="shrink-0">
              {t("status.seeding")}
            </Badge>
          )}
          {badge === "verifying" && (
            <Badge variant="secondary" className="shrink-0">
              <LoaderCircle className="animate-spin" />
              {t("status.verifying")}
            </Badge>
          )}
          {stoppingVerify && (
            <Badge variant="secondary" className="shrink-0">
              <LoaderCircle className="animate-spin" />
              {t("status.verifyStopping")}
            </Badge>
          )}
          {verifyPending && (
            <Badge variant="outline" className="shrink-0">
              {t("status.verifyPending")}
            </Badge>
          )}
          {starting && (
            <Badge variant="secondary" className="shrink-0">
              <LoaderCircle className="animate-spin" />
              {t("status.starting")}
            </Badge>
          )}
          {connecting && !seeding && (
            <Badge variant="secondary" className="shrink-0">
              <LoaderCircle className="animate-spin" />
              {isBt ? t("status.seekingPeers") : t("status.connecting")}
            </Badge>
          )}
          {queued && (
            <Badge variant="outline" className="shrink-0">
              {t("status.queued")}
            </Badge>
          )}
          {paused && !starting && (
            <Badge variant="outline" className="shrink-0">
              {t("status.paused")}
            </Badge>
          )}
        </div>

        {!complete && !errored && (
          <Progress
            value={visibleProgress}
            aria-label={name}
            className="mt-2 h-1.5"
          />
        )}

        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs tabular-nums text-muted-foreground">
          {meta.map((item, index) => (
            <Fragment key={index}>
              {index > 0 && <span className="opacity-40">·</span>}
              <span className="min-w-0">{item}</span>
            </Fragment>
          ))}
        </div>
        {errored && task.errorMessage && (
          <p
            className="mt-1 line-clamp-2 min-w-0 break-all text-xs leading-snug text-destructive"
            title={task.errorMessage}
          >
            {task.errorMessage}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
        {errored && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 hover:text-foreground"
            disabled={disabled || busy}
            onClick={() => void run(handleRetry)}
            aria-label={t("common.retry")}
            title={t("common.retry")}
          >
            <RotateCcw className="size-4" />
          </Button>
        )}
        {(canPauseTask(task) || paused) && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 hover:text-foreground"
            onClick={() => void run(handleToggle)}
            disabled={disabled || busy || stoppingVerify || starting}
            aria-label={
              canPauseTask(task)
                ? t("common.pause")
                : starting
                  ? t("status.starting")
                  : t("common.start")
            }
            title={
              canPauseTask(task)
                ? t("common.pause")
                : starting
                  ? t("status.starting")
                  : t("common.start")
            }
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : canPauseTask(task) ? (
              <Pause className="size-4" />
            ) : starting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 hover:text-foreground"
          onClick={() => void revealTask(task).catch(toastError)}
          aria-label={t("common.reveal")}
          title={t("common.reveal")}
        >
          <FolderOpen className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 hover:text-foreground"
              aria-label={t("common.more")}
            >
              <EllipsisVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => onInspect(task)}>
              <Info className="size-4" /> {t("task.detail")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void openTask(task).catch(toastError)}
            >
              <ExternalLink className="size-4" /> {t("common.open")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleCopy()}>
              <Copy className="size-4" /> {t("common.copy")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void revealTask(task).catch(toastError)}
            >
              <FolderOpen className="size-4" /> {t("common.reveal")}
            </DropdownMenuItem>
            {errored && (
              <DropdownMenuItem
                disabled={disabled || busy}
                onClick={() => void run(handleRetry)}
              >
                <RotateCcw className="size-4" /> {t("common.retry")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={disabled || busy}
              onClick={() => onRemove(task)}
            >
              <Trash2 className="size-4" /> {t("task.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
