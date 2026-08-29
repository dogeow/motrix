import {
  ArrowUpDown,
  Eraser,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CATEGORY_TABS,
  SORT_KEYS,
  categoryTaskCount,
  type SortKey,
} from "@/lib/task-list";
import { t } from "@/lib/i18n";
import type { Category, GlobalStat } from "@/lib/types";
import { cn } from "@/lib/utils";

/** macOS keeps its traffic lights over our toolbar, so reserve space for them. */
const IS_MAC = navigator.userAgent.includes("Macintosh");

interface AppToolbarProps {
  category: Category;
  stat: GlobalStat | null;
  query: string;
  sortKey: SortKey;
  onCategoryChange: (category: Category) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sortKey: SortKey) => void;
  onPurgeStopped: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onOpenPreferences: () => void;
  onAddTask: () => void;
}

export function AppToolbar({
  category,
  stat,
  query,
  sortKey,
  onCategoryChange,
  onQueryChange,
  onSortChange,
  onPurgeStopped,
  onPauseAll,
  onResumeAll,
  onOpenPreferences,
  onAddTask,
}: AppToolbarProps) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-13 shrink-0 items-center gap-3 border-b px-3",
        IS_MAC && "pl-20"
      )}
    >
      <Tabs
        value={category}
        onValueChange={(value) => onCategoryChange(value as Category)}
      >
        <TabsList>
          {CATEGORY_TABS.map((value) => {
            const count = stat ? categoryTaskCount(stat, value) : 0;
            return (
              <TabsTrigger key={value} value={value}>
                {t(`tabs.${value}`)}
                {count > 0 && (
                  <span className="ml-1 tabular-nums opacity-60">{count}</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="relative ml-auto w-44">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("toolbar.search")}
          className="h-8 pl-8 text-xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={t("toolbar.clearSearch")}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  aria-label={t("toolbar.sort")}
                >
                  <ArrowUpDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("toolbar.sort")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sortKey}
              onValueChange={(value) => onSortChange(value as SortKey)}
            >
              {SORT_KEYS.map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {t(`sort.${key}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {stat && Number(stat.numStopped) > 0 && (
          <IconAction label={t("toolbar.purge")} onClick={onPurgeStopped}>
            <Eraser className="size-4" />
          </IconAction>
        )}
        <IconAction label={t("toolbar.pauseAll")} onClick={onPauseAll}>
          <Pause className="size-4" />
        </IconAction>
        <IconAction label={t("toolbar.resumeAll")} onClick={onResumeAll}>
          <Play className="size-4" />
        </IconAction>
        <IconAction
          label={t("toolbar.preferences")}
          onClick={onOpenPreferences}
        >
          <Settings className="size-4" />
        </IconAction>
        <Button size="sm" className="ml-1.5" onClick={onAddTask}>
          <Plus className="size-4" /> {t("toolbar.addTask")}
        </Button>
      </div>
    </header>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
