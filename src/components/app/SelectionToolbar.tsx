import { LoaderCircle, Pause, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { t } from "@/lib/i18n";

interface SelectionToolbarProps {
  count: number;
  total: number;
  unfilteredTotal: number;
  filterLabel?: string;
  onClearFilters: () => void;
  busy: boolean;
  connected: boolean;
  canStart: boolean;
  canPause: boolean;
  onSelectAll: (selected: boolean) => void;
  onStart: () => void;
  onPause: () => void;
  onRemove: () => void;
  onClear: () => void;
}

export function SelectionToolbar({
  count,
  total,
  unfilteredTotal,
  filterLabel,
  onClearFilters,
  busy,
  connected,
  canStart,
  canPause,
  onSelectAll,
  onStart,
  onPause,
  onRemove,
  onClear,
}: SelectionToolbarProps) {
  if (unfilteredTotal === 0) return null;
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-muted/30 px-5 text-xs">
      <Checkbox
        checked={total > 0 && count === total ? true : count > 0 ? "indeterminate" : false}
        disabled={busy || total === 0}
        onCheckedChange={(value) => onSelectAll(value === true)}
        aria-label={t("selection.all")}
      />
      <span className="text-muted-foreground" role="status">
        {count > 0
          ? t("selection.count", { count })
          : total !== unfilteredTotal
            ? t("selection.filteredTotal", { shown: total, total: unfilteredTotal })
            : t("selection.total", { count: total })}
      </span>
      {filterLabel && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 rounded-full px-2 text-xs"
          onClick={onClearFilters}
          title={t("toolbar.clearFilters")}
          aria-label={`${filterLabel} · ${t("toolbar.clearFilters")}`}
        >
          {filterLabel}
          <X className="size-3" />
        </Button>
      )}
      {count > 0 && (
        <div className="ml-auto flex items-center gap-1">
          {busy && (
            <LoaderCircle
              className="mr-2 size-3.5 animate-spin text-muted-foreground"
              aria-label={t("common.processing")}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !canStart}
            onClick={onStart}
          >
            <Play className="size-3.5" /> {t("common.start")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !canPause}
            onClick={onPause}
          >
            <Pause className="size-3.5" /> {t("common.pause")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !connected}
            className="text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" /> {t("common.delete")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-1 size-7"
            disabled={busy}
            onClick={onClear}
            aria-label={t("selection.clear")}
            title={t("selection.clear")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
