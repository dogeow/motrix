import type { Aria2File } from "./types";

/** Schedule the next read only after the current one settles. */
export function startDetailPolling<T>({
  load,
  onResult,
  onSettled,
  interval,
}: {
  load: () => Promise<T>;
  onResult: (result: T) => void;
  onSettled?: () => void;
  interval: number;
}): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const refresh = async () => {
    try {
      const result = await load();
      if (active) onResult(result);
    } catch {
      // A transient failure keeps the last successful snapshot visible.
    } finally {
      if (active) {
        onSettled?.();
        timer = setTimeout(() => void refresh(), interval);
      }
    }
  };

  void refresh();
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

function selectedIndexes(files: readonly Aria2File[]): Set<string> {
  return new Set(
    files.filter((file) => file.selected === "true").map((file) => file.index)
  );
}

function sameSelection(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const index of left) {
    if (!right.has(index)) return false;
  }
  return true;
}

export interface FileSelectionSave {
  indexes: string[];
}

/** Keep RPC snapshots separate from edits and the selection submitted by a save. */
export function createFileSelectionDraft(files: readonly Aria2File[]) {
  let selected = selectedIndexes(files);
  let saved = selected;
  let dirty = false;
  let revision = 0;
  let pending: FileSelectionSave | null = null;

  return {
    snapshot() {
      return {
        selection: selected as ReadonlySet<string>,
        dirty,
        saving: pending !== null,
        revision,
      };
    },
    sync(nextFiles: readonly Aria2File[], requestedRevision: number) {
      if (pending || requestedRevision !== revision || dirty) return;
      selected = selectedIndexes(nextFiles);
      saved = selected;
    },
    toggle(indexes: readonly string[], checked: boolean) {
      const next = new Set(selected);
      for (const index of indexes) {
        if (checked) next.add(index);
        else next.delete(index);
      }
      if (sameSelection(next, selected)) return;
      selected = next;
      dirty = !sameSelection(selected, saved);
      revision += 1;
    },
    discard() {
      if (pending) return;
      selected = saved;
      dirty = false;
      revision += 1;
    },
    beginSave(): FileSelectionSave | null {
      if (pending || selected.size === 0) return null;
      pending = {
        indexes: [...selected].sort((a, b) => Number(a) - Number(b)),
      };
      revision += 1;
      return pending;
    },
    completeSave(submitted: FileSelectionSave) {
      if (pending !== submitted) return;
      saved = new Set(submitted.indexes);
      dirty = !sameSelection(selected, saved);
      pending = null;
      revision += 1;
    },
    failSave(submitted: FileSelectionSave) {
      if (pending !== submitted) return;
      pending = null;
      revision += 1;
    },
  };
}
