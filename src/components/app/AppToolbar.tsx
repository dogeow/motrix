import type { RefObject } from "react";
import {
  ArrowUpDown,
  Download,
  Ellipsis,
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
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CATEGORY_TABS,
  SORT_KEYS,
  categoryTaskCount,
  type SortKey,
} from "@/lib/task-list";
import { t } from "@/lib/i18n";
import type { Category, GlobalStat } from "@/lib/types";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.userAgent.includes("Macintosh");

interface AppToolbarProps {
  connected: boolean;
  busy: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
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
  connected,
  busy,
  searchRef,
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
  const unavailable = !connected || busy;
  return (
    <header className="shrink-0 border-b bg-background">
      <div
        data-tauri-drag-region
        className={cn("flex h-13 items-center gap-3 px-4", IS_MAC && "pl-20")}
      >
        <div className="pointer-events-none flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Download className="size-4 text-muted-foreground" /> Motrix
        </div>
        <div data-tauri-drag-region className="h-full flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onOpenPreferences}
          aria-label={t("toolbar.preferences")}
          title={t("toolbar.preferences")}
        >
          <Settings className="size-4" />
        </Button>
        <Button size="sm" onClick={onAddTask}>
          <Plus className="size-4" /> {t("toolbar.addTask")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-1 pb-3">
        <Tabs
          value={category}
          onValueChange={(value) => onCategoryChange(value as Category)}
        >
          <TabsList aria-label={t("toolbar.categories")}>
            {CATEGORY_TABS.map((value) => {
              const count = stat ? categoryTaskCount(stat, value) : 0;
              return (
                <TabsTrigger key={value} value={value}>
                  {t(`tabs.${value}`)}
                  <span className="ml-1 min-w-3 text-[11px] tabular-nums opacity-60">
                    {count}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto min-w-36 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("toolbar.search")}
            aria-label={t("toolbar.search")}
            className="h-8 pr-8 pl-8 text-xs"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onQueryChange("");
              }
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                searchRef.current?.focus();
              }}
              className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("toolbar.clearSearch")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={t("toolbar.sort")}
                title={`${t("toolbar.sort")} · ${t(`sort.${sortKey}`)}`}
              >
                <ArrowUpDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={t("toolbar.taskActions")}
                title={t("toolbar.taskActions")}
              >
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={
                  unavailable ||
                  !stat ||
                  Number(stat.numActive) + Number(stat.numWaiting) === 0
                }
                onClick={onPauseAll}
              >
                <Pause className="size-4" /> {t("toolbar.pauseAll")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={unavailable || !stat || Number(stat.numWaiting) === 0}
                onClick={onResumeAll}
              >
                <Play className="size-4" /> {t("toolbar.resumeAll")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={unavailable || !stat || Number(stat.numStopped) === 0}
                onClick={onPurgeStopped}
              >
                <Eraser className="size-4" /> {t("toolbar.purge")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
