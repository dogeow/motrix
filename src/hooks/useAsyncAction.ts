import { useRef, useState } from "react";
import { toastError } from "@/lib/actions";

/** Lock synchronously, before React paints, so rapid clicks cannot submit twice. */
export function useAsyncAction() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toastError(error);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return { busy, run };
}
