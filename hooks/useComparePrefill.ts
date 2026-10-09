"use client";

import { useEffect, useRef } from "react";
import { browserPrefillStorage, takeComparePrefill } from "@/features/comparison/prefill";

/**
 * Takes the text another page stashed for Compare (see `features/comparison/prefill`), once, after the
 * first render. The callback is kept in a ref so it may change identity without re-reading storage;
 * a second run (React strict mode) finds the stash already cleared and does nothing.
 */
export function useComparePrefill(onPrefill: (text: string) => void): void {
  const callback = useRef(onPrefill);
  useEffect(() => {
    callback.current = onPrefill;
  });

  useEffect(() => {
    const text = takeComparePrefill(browserPrefillStorage(), Date.now());
    if (text !== null) callback.current(text);
  }, []);
}
