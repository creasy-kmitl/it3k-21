import { useCallback, useEffect, useRef, useState } from "react";

import { useDebouncedValue } from "./use-debounced-value";

/** Filters held outside the page (in the URL), so they survive a reload and can be shared. */
export type FilterControl<T> = { value: T; onChange: (patch: Partial<T>) => void };

/** A page's filters: the caller's when given, otherwise kept in the page itself. */
export function useFilters<T extends object>(control?: FilterControl<T>) {
  const [local, setLocal] = useState({} as T);
  const patchLocal = useCallback(
    (patch: Partial<T>) => setLocal((previous) => ({ ...previous, ...patch })),
    [],
  );
  return control ? ([control.value, control.onChange] as const) : ([local, patchLocal] as const);
}

/**
 * The text in a search box. Typing is committed as the `q` filter once it
 * settles, and the box follows `q` when it changes from outside (a link, back).
 */
export function useSearchText(q: string, commit: (q: string | undefined) => void) {
  const [text, setText] = useState(q);
  const settled = useDebouncedValue(text.trim(), 300);
  const latest = useRef({ q, commit });
  latest.current = { q, commit };

  useEffect(() => {
    if (settled !== latest.current.q) latest.current.commit(settled || undefined);
  }, [settled]);

  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    setSeen(q);
    if (q !== settled) setText(q);
  }

  return [text, setText] as const;
}
