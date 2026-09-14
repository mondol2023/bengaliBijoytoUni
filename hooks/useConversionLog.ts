"use client";

import { useSyncExternalStore } from "react";
import {
  clearLog,
  getLogServerSnapshot,
  getLogSnapshot,
  subscribeToLog,
  summarizeLog,
} from "@/lib/log/conversionLog";

/**
 * Subscribes to the app-wide session failure log. The store is module-level
 * on purpose (see `lib/log/conversionLog.ts`) so the log survives client
 * navigation between the converter, documents and comparison routes.
 */
export function useConversionLog() {
  const events = useSyncExternalStore(subscribeToLog, getLogSnapshot, getLogServerSnapshot);
  return { events, summary: summarizeLog(events), clear: clearLog };
}
