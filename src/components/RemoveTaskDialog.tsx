import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAppStore } from "@/store/app";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { removeTask, toastError } from "@/lib/actions";
import { taskName } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Aria2Task } from "@/lib/types";

interface RemoveTaskDialogProps {
  /** Exact snapshot confirmed by the user; polling cannot change its scope. */
  tasks: Aria2Task[];
  onRemoved: (gids: string[]) => void;
  onClose: () => void;
}

/**
 * Rendered once at App level (not inside the polled task rows) so the
 * confirmation survives the row unmounting when a task changes category.
 */
export function RemoveTaskDialog({
  tasks: targets,
  onRemoved,
  onClose,
}: RemoveTaskDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false);

  const { busy, run } = useAsyncAction();
  const connected = useAppStore((state) => state.connected);
  const name = targets[0] ? taskName(targets[0]) : "";

  const close = () => {
    setDeleteFiles(false);
    onClose();
  };

  const handleConfirm = async () => {
    try {
      // Sequential: aria2 races removal against its own bookkeeping, and a
      // parallel burst makes "record not found" errors far more likely.
      let failed = 0;
      const errors: string[] = [];
      const removed: string[] = [];
      for (const target of targets) {
        try {
          await removeTask(target, deleteFiles);
          removed.push(target.gid);
        } catch (error) {
          failed += 1;
          errors.push(
            `${taskName(target)}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      onRemoved(removed);
      if (failed > 0) {
        toast.warning(
          t("remove.partial", {
            done: targets.length - failed,
            failed,
            error: errors[0],
          })
        );
      } else {
        toast.success(
          deleteFiles
            ? t("remove.doneWithFiles")
            : t("remove.done", { count: targets.length })
        );
      }
    } catch (error) {
      toastError(error);
    } finally {
      close();
    }
  };

  return (
    <AlertDialog
      open={targets.length > 0}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("remove.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {targets.length > 1 ? (
              t("remove.confirmMany", { count: targets.length })
            ) : (
              <>
                {t("remove.confirmOne")}
                {/* Task names can be long unbroken strings (magnet hashes),
                    so force wrapping and cap the height. */}
                <span
                  className="mt-1.5 line-clamp-3 block break-all font-medium text-foreground"
                  title={name}
                >
                  {name}
                </span>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2">
          <Checkbox
            id="remove-delete-files"
            checked={deleteFiles}
            disabled={busy}
            onCheckedChange={(checked) => setDeleteFiles(checked === true)}
          />
          <Label htmlFor="remove-delete-files" className="font-normal">
            {t("remove.withFiles")}
          </Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || !connected}
            onClick={(event) => {
              event.preventDefault();
              void run(handleConfirm);
            }}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {busy ? t("remove.removing") : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
