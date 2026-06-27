import { useCallback, useEffect, useState } from "react";
import { addStackItem, fetchStack, removeStackItem, type StackItem } from "../lib/api";
import { getUserRef } from "../lib/userRef";

const STACK_KEY = "pephouse_stack";

function loadLocal(): StackItem[] {
  try {
    const raw = localStorage.getItem(STACK_KEY);
    return raw ? (JSON.parse(raw) as StackItem[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(stack: StackItem[]) {
  try {
    localStorage.setItem(STACK_KEY, JSON.stringify(stack));
  } catch {
    /* storage full / disabled */
  }
}

/** The user's compound stack. Persisted to localStorage (survives refresh) and
 * synced to the user_stack table (Supabase) best-effort. */
export function useStack() {
  const [stack, setStack] = useState<StackItem[]>(() => loadLocal());

  // On mount, prefer the server stack if the table exists; else keep local.
  useEffect(() => {
    let alive = true;
    fetchStack(getUserRef())
      .then((rows) => {
        if (alive && rows.length) {
          setStack(rows);
          saveLocal(rows);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback(
    async (item: { compound_id: number; compound_name?: string; dose?: string; source_type?: string }) => {
      const optimistic: StackItem = { id: Date.now(), ...item };
      setStack((prev) => {
        const next = [...prev.filter((s) => s.compound_id !== item.compound_id), optimistic];
        saveLocal(next);
        return next;
      });
      try {
        const rows = await addStackItem(getUserRef(), item);
        if (rows.length) {
          setStack(rows);
          saveLocal(rows);
        }
      } catch {
        /* keep optimistic local state */
      }
    },
    [],
  );

  const remove = useCallback(async (id: number) => {
    setStack((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveLocal(next);
      return next;
    });
    try {
      const rows = await removeStackItem(getUserRef(), id);
      setStack(rows);
      saveLocal(rows);
    } catch {
      /* keep local */
    }
  }, []);

  return { stack, add, remove };
}
