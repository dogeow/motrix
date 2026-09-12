import { useEffect, useRef, useState } from "react";
import { FileUp, FolderOpen, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  addTorrent,
  addUris,
  pickDirectory,
  pickTorrentFile,
  toastAddBtResult,
  toastError,
} from "@/lib/actions";
import { t } from "@/lib/i18n";
import { useAppStore } from "@/store/app";
import { useSettingsStore } from "@/store/settings";

interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddTaskDialog({ open, onOpenChange }: AddTaskDialogProps) {
  const connected = useAppStore((state) => state.connected);
  const submitLock = useRef(false);
  const engine = useAppStore((state) => state.engine);
  const settingsDir = useSettingsStore((state) => state.settings.downloadDir);
  const [tab, setTab] = useState<"uri" | "torrent">("uri");
  const [uris, setUris] = useState("");
  const [torrentPath, setTorrentPath] = useState<string | null>(null);
  const [dir, setDir] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDir(settingsDir || engine?.downloadDir || "");
    }
  }, [open, settingsDir, engine]);

  const reset = () => {
    setUris("");
    setTorrentPath(null);
    setTab("uri");
    setSubmitting(false);
  };

  const handlePickTorrent = async () => {
    try {
      const path = await pickTorrentFile();
      if (path) setTorrentPath(path);
    } catch (error) {
      toastError(error);
    }
  };

  const handlePickDir = async () => {
    try {
      const selected = await pickDirectory(dir || undefined);
      if (selected) setDir(selected);
    } catch (error) {
      toastError(error);
    }
  };

  const handleSubmit = async () => {
    if (submitLock.current || !connected) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      if (tab === "uri") {
        const list = [
          ...new Set(
            uris
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
          ),
        ];
        if (list.length === 0) {
          toast.info(t("add.needUri"));
          return;
        }
        const { added, resumed, failed } = await addUris(
          list,
          dir || undefined
        );
        if (failed.length > 0) {
          // Keep only the failed lines so resubmitting won't duplicate
          // the tasks that were already added.
          setUris(failed.map((item) => item.uri).join("\n"));
          if (added > 0) {
            toast.warning(
              t("add.partial", {
                added,
                failed: failed.length,
                error: failed[0].error,
              })
            );
          } else {
            toast.error(t("add.failed", { error: failed[0].error }));
          }
          return;
        }
        if (resumed > 0) {
          toast.success(t("add.continued", { count: resumed }));
        }
        if (added > 0) {
          toast.success(t("add.added", { count: added }));
        }
      } else {
        if (!torrentPath) {
          toast.info(t("add.needTorrent"));
          return;
        }
        toastAddBtResult(await addTorrent(torrentPath, dir || undefined));
      }
      reset();
      onOpenChange(false);
    } catch (error) {
      toastError(error);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const torrentFileName = torrentPath
    ? torrentPath.replace(/\\/g, "/").split("/").pop()
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitLock.current) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>{t("add.title")}</DialogTitle>
          <DialogDescription>{t("add.description")}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as "uri" | "torrent")}
        >
          <TabsList className="w-full">
            <TabsTrigger disabled={submitting} value="uri" className="flex-1">
              {t("add.tabUri")}
            </TabsTrigger>
            <TabsTrigger
              disabled={submitting}
              value="torrent"
              className="flex-1"
            >
              {t("add.tabTorrent")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="uri" className="mt-3">
            <Textarea
              disabled={submitting}
              aria-label={t("add.tabUri")}
              value={uris}
              onChange={(event) => setUris(event.target.value)}
              placeholder={t("add.uriPlaceholder")}
              rows={5}
              // break-all fills each line with the URL instead of leaving a
              // near-empty first line when it wraps at "magnet:?".
              className="resize-none font-mono text-xs break-all"
            />
          </TabsContent>

          <TabsContent value="torrent" className="mt-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handlePickTorrent()}
              className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground transition-colors hover:bg-accent/40"
            >
              <FileUp className="size-6" />
              {torrentFileName ?? t("add.pickTorrent")}
            </button>
          </TabsContent>
        </Tabs>

        <div className="grid gap-2">
          <Label htmlFor="download-dir">{t("add.dir")}</Label>
          <div className="flex gap-2">
            <Input
              id="download-dir"
              disabled={submitting}
              value={dir}
              onChange={(event) => setDir(event.target.value)}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              disabled={submitting}
              aria-label={t("common.chooseDir")}
              onClick={() => void handlePickDir()}
              title={t("common.chooseDir")}
            >
              <FolderOpen className="size-4" />
            </Button>
          </div>
        </div>

        {!connected && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("engine.notReady")}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              submitting ||
              !connected ||
              (tab === "uri" ? !uris.trim() : !torrentPath)
            }
          >
            {submitting && <LoaderCircle className="size-4 animate-spin" />}
            {submitting ? t("add.submitting") : t("add.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
