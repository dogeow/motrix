import { LoaderCircle } from "lucide-react";
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
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { purgeStopped } from "@/lib/actions";
import { t } from "@/lib/i18n";
import { useAppStore } from "@/store/app";

export function ClearHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { busy, run } = useAsyncAction();
  const connected = useAppStore((state) => state.connected);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("toolbar.purge")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("remove.purgeConfirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || !connected}
            onClick={(event) => {
              event.preventDefault();
              void run(async () => {
                await purgeStopped();
                onOpenChange(false);
              });
            }}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {busy ? t("common.processing") : t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
