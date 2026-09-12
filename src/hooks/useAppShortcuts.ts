import { useEffect, type RefObject } from "react";

interface AppShortcuts {
  dialogOpen: boolean;
  busy: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onAddTask: () => void;
  onSelectAll: (selected: boolean) => void;
  onClearSelection: () => void;
}

export function useAppShortcuts({
  dialogOpen,
  busy,
  searchRef,
  onAddTask,
  onSelectAll,
  onClearSelection,
}: AppShortcuts) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || dialogOpen) return;
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          Boolean(target.closest("input, textarea, select, [role=combobox]")));
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
        } else if (!editing && event.key.toLowerCase() === "n") {
          event.preventDefault();
          onAddTask();
        } else if (!editing && event.key.toLowerCase() === "a" && !busy) {
          event.preventDefault();
          onSelectAll(true);
        }
      } else if (event.key === "Escape" && !editing && !busy) {
        onClearSelection();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [dialogOpen, busy, searchRef, onAddTask, onSelectAll, onClearSelection]);
}
