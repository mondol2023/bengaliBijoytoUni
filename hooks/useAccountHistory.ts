"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { ConversionRecord, ComparisonRecord, DocumentRecord } from "@/lib/firebase/schemas";
import type { SafeErrorResponse } from "@/lib/errors/handlers";

type WithId<T> = T & { id: string };

type ListResponse<T> = { ok: true; records: WithId<T>[] } | { ok: false; error: SafeErrorResponse };

type DeleteResponse = { ok: true; documentId: string } | { ok: false; error: SafeErrorResponse };

interface HistoryRecords {
  conversions: WithId<ConversionRecord>[];
  comparisons: WithId<ComparisonRecord>[];
  documents: WithId<DocumentRecord>[];
}

interface HistoryState extends HistoryRecords {
  isLoading: boolean;
  error: string | null;
}

const EMPTY_RECORDS: HistoryRecords = { conversions: [], comparisons: [], documents: [] };
const EMPTY_STATE: HistoryState = { ...EMPTY_RECORDS, isLoading: false, error: null };

/**
 * Pure data fetch — no `setState` anywhere in this function (or its
 * transitive calls), deliberately, so the `.then`/`.catch` wiring at each
 * call site below is the only place state changes, matching the "call
 * setState in a callback, not synchronously in an effect body" shape
 * `react-hooks/set-state-in-effect` requires. Returns `null` on a missing
 * token; throws on a network/parse failure.
 */
async function fetchHistoryRecords(idToken: string | null): Promise<HistoryRecords | null> {
  if (!idToken) return null;
  const headers = { Authorization: `Bearer ${idToken}` };
  const [conversionsRes, comparisonsRes, documentsRes] = await Promise.all([
    fetch("/api/conversions", { headers }),
    fetch("/api/comparisons", { headers }),
    fetch("/api/documents", { headers }),
  ]);
  const [conversionsPayload, comparisonsPayload, documentsPayload] = (await Promise.all([
    conversionsRes.json(),
    comparisonsRes.json(),
    documentsRes.json(),
  ])) as [ListResponse<ConversionRecord>, ListResponse<ComparisonRecord>, ListResponse<DocumentRecord>];

  return {
    conversions: conversionsPayload.ok ? conversionsPayload.records : [],
    comparisons: comparisonsPayload.ok ? comparisonsPayload.records : [],
    documents: documentsPayload.ok ? documentsPayload.records : [],
  };
}

/**
 * Pulls the signed-in user's own recent activity from the three GET history
 * endpoints (`/api/conversions`, `/api/comparisons`, `/api/documents`) for
 * the `/account` page. A failed fetch degrades to an empty list for that
 * one collection rather than blowing up the whole page.
 */
export function useAccountHistory() {
  const { user, getIdToken } = useAuth();
  const [state, setState] = useState<HistoryState>(EMPTY_STATE);

  // Tracks which signed-in user (or signed-out state) `state` above belongs
  // to, so a user change resets stale history and (re)starts the loading
  // flag during render — React's documented "adjusting state when a prop
  // changes" pattern — instead of a synchronous setState call inside an
  // effect, which can trigger cascading renders.
  const [historyOwner, setHistoryOwner] = useState(user);
  if (historyOwner !== user) {
    setHistoryOwner(user);
    setState(user ? { ...EMPTY_STATE, isLoading: true } : EMPTY_STATE);
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void getIdToken()
      .then(fetchHistoryRecords)
      .then((records) => {
        if (cancelled) return;
        if (!records) {
          setState({ ...EMPTY_STATE, error: "Could not verify your session." });
          return;
        }
        setState({ ...records, isLoading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ ...EMPTY_STATE, error: "Could not reach the server — check your connection and try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, getIdToken]);

  // The header's manual "Refresh" action — a plain click-handler callback,
  // not called from the effect above, so its own synchronous "loading true"
  // setState isn't the pattern that rule is about.
  const refresh = useCallback(() => {
    setState((current) => ({ ...current, isLoading: true, error: null }));
    void getIdToken()
      .then(fetchHistoryRecords)
      .then((records) => {
        if (!records) {
          setState({ ...EMPTY_STATE, error: "Could not verify your session." });
          return;
        }
        setState({ ...records, isLoading: false, error: null });
      })
      .catch(() => {
        setState({ ...EMPTY_STATE, error: "Could not reach the server — check your connection and try again." });
      });
  }, [getIdToken]);

  /**
   * Deletes one uploaded document — the Storage object and the metadata
   * record together (`DELETE /api/documents/[documentId]`).
   *
   * Resolves to `null` on success or a message to show the user on failure,
   * rather than throwing: the caller is a click handler rendering the error
   * next to the row it belongs to, and an unhandled rejection there would
   * only reach the console.
   *
   * The row is removed from local state only once the server has confirmed
   * it. An optimistic removal would hide the one partial-failure case that
   * actually needs the user to retry — the file gone, the record still
   * there — behind a row that had already vanished.
   */
  const deleteDocument = useCallback(
    async (documentId: string): Promise<string | null> => {
      const idToken = await getIdToken();
      if (!idToken) return "Could not verify your session.";

      let payload: DeleteResponse;
      try {
        const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}` },
        });
        payload = (await response.json()) as DeleteResponse;
      } catch {
        return "Could not reach the server — check your connection and try again.";
      }

      if (!payload.ok) return payload.error.message;

      setState((current) => ({
        ...current,
        documents: current.documents.filter((record) => record.id !== documentId),
      }));
      return null;
    },
    [getIdToken],
  );

  return { ...state, refresh, deleteDocument };
}
