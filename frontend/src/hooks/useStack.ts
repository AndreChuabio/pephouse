import { useCallback, useEffect, useState } from "react";
import { addStackItem, fetchStack, removeStackItem, type StackItem } from "../lib/api";
import { getUserRef } from "../lib/userRef";

/** The user's compound stack. Local-first: edits apply immediately and are
 * synced to user_stack (Supabase) best-effort, so the UI works before the
 * table exists. When the table is present, the server stack wins. */
export function useStack() {
  const [stack, setStack] = useState<StackItem[]>([]);

  useEffect(() => {
    let alive = true;
    fetchStack(getUserRef())
      .then((rows) => {
        if (alive && rows.length) setStack(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback(
    async (item: { compound_id: number; compound_name?: string; dose?: string; source_type?: string }) => {
      // optimistic local add
      const optimistic: StackItem = { id: Date.now(), ...item };
      setStack((prev) => [...prev.filter((s) => s.compound_id !== item.compound_id), optimistic]);
      try {
        const rows = await addStackItem(getUserRef(), item);
        if (rows.length) setStack(rows);
      } catch {
        /* keep optimistic local state */
      }
    },
    [],
  );

  const remove = useCallback(async (id: number) => {
    setStack((prev) => prev.filter((s) => s.id !== id));
    try {
      const rows = await removeStackItem(getUserRef(), id);
      if (rows.length) setStack(rows);
    } catch {
      /* keep local */
    }
  }, []);

  return { stack, add, remove };
}
