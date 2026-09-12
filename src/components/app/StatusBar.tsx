import { ArrowDown, ArrowUp } from "lucide-react";
import { formatSpeed } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { GlobalStat } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatusBarProps {
  connected: boolean;
  stat: GlobalStat | null;
  initError: string | null;
}

export function StatusBar({ connected, stat, initError }: StatusBarProps) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-2 border-t px-4 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          initError
            ? "bg-destructive"
            : connected
              ? "bg-emerald-500"
              : "bg-amber-500"
        )}
      />
      <span>
        {initError
          ? t("engine.startFailed")
          : connected
            ? t("engine.connected")
            : t("engine.connecting")}
      </span>
      {stat && connected && (
        <span className="ml-auto flex items-center gap-3 tabular-nums">
          <span className="flex items-center gap-1">
            <ArrowDown className="size-3" />
            {formatSpeed(stat.downloadSpeed)}
          </span>
          <span className="flex items-center gap-1">
            <ArrowUp className="size-3" />
            {formatSpeed(stat.uploadSpeed)}
          </span>
        </span>
      )}
    </footer>
  );
}
