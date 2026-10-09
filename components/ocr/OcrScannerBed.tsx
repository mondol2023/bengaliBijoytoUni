"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { OcrJobState } from "@/features/ocr/job/jobState";
import type { OcrItemMeta, OcrSourcePage } from "@/features/ocr/job/source";
import type { OcrMode } from "@/features/ocr/types";
import { motionTokens } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";
import { OcrProgress } from "./OcrProgress";

type BoxState = "pending" | "reading" | "read";

/** The counts that explain why fewer lines were found than the file holds. */
export function skippedSummary(state: Pick<OcrJobState, "skipped" | "unreadable">): string | null {
  const { decorative, duplicate, tinyRow } = state.skipped;
  const parts: string[] = [];
  if (decorative > 0) parts.push(`${decorative} decorative`);
  if (duplicate > 0) parts.push(`${duplicate} ${duplicate === 1 ? "repeat" : "repeats"}`);
  if (tinyRow > 0) parts.push(`${tinyRow} too small`);
  const skipped = parts.length > 0 ? `Skipped: ${parts.join(" · ")}` : null;
  const unreadable = state.unreadable > 0 ? `${state.unreadable} unreadable` : null;
  return [skipped, unreadable].filter(Boolean).join(" · ") || null;
}

interface BedView {
  byId: Map<string, OcrItemMeta>;
  pageOf: Map<number, OcrSourcePage>;
  /** Item the bed is currently showing: the newest one reading, else the last one finished, else the first. */
  current: OcrItemMeta | null;
  currentPage: number | null;
  readingIds: Set<string>;
}

function useBedView(state: OcrJobState): BedView {
  const { items, pages, reading, outcomes } = state;
  return useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const pageOf = new Map(pages.map((page) => [page.page, page]));
    let current: OcrItemMeta | null = null;
    const newest = reading.at(-1);
    if (newest) current = byId.get(newest) ?? null;
    if (!current) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (outcomes[items[i].id]) {
          current = items[i];
          break;
        }
      }
    }
    current ??= items[0] ?? null;
    return {
      byId,
      pageOf,
      current,
      currentPage: current?.page ?? pages[0]?.page ?? null,
      readingIds: new Set(reading),
    };
  }, [items, pages, reading, outcomes]);
}

function boxStateOf(state: OcrJobState, view: BedView, id: string): BoxState {
  if (state.outcomes[id]) return "read";
  return view.readingIds.has(id) ? "reading" : "pending";
}

/** One page's placed boxes, as percentages of the page, so no measuring is needed. */
function PageBoxes({
  state,
  view,
  page,
  fill,
}: {
  state: OcrJobState;
  view: BedView;
  page: OcrSourcePage;
  /** Mini-map: solid bars instead of outlines. */
  fill?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const onPage = state.items.filter((item) => item.page === page.page && item.box);
  return (
    <>
      {onPage.map((item) => {
        const box = item.box!;
        const status = boxStateOf(state, view, item.id);
        return (
          <span
            key={item.id}
            className={cn(
              "absolute border transition-colors",
              fill
                ? status === "reading"
                  ? "border-transparent bg-accent"
                  : status === "read"
                    ? "border-transparent bg-foreground/35"
                    : "border-transparent bg-foreground/10"
                : status === "reading"
                  ? "border-accent"
                  : status === "read"
                    ? "border-foreground/25"
                    : "border-transparent",
            )}
            style={{
              left: `${(box.x / page.widthPt) * 100}%`,
              top: `${(box.y / page.heightPt) * 100}%`,
              width: `${(box.width / page.widthPt) * 100}%`,
              height: `${(box.height / page.heightPt) * 100}%`,
            }}
          >
            {status === "reading" && !fill && !reducedMotion && (
              <motion.span
                className="absolute inset-0 bg-accent/15"
                initial={{ opacity: 0.3 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: motionTokens.duration.deliberate,
                  ease: motionTokens.easing.standard,
                  repeat: Infinity,
                  repeatType: "mirror",
                }}
              />
            )}
          </span>
        );
      })}
    </>
  );
}

/** A 2px terracotta line with a faint trail, moving to `top` (a percentage of its parent). */
function ScanLine({ top, animateTop }: { top: number; animateTop: boolean }) {
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 h-0"
      initial={false}
      animate={{ top: `${top}%` }}
      transition={
        animateTop
          ? { duration: motionTokens.duration.slow, ease: motionTokens.easing.standard }
          : { duration: 0 }
      }
    >
      <span className="absolute inset-x-0 -top-7 h-7 bg-accent/10" />
      <span className="absolute inset-x-0 top-0 h-0.5 -translate-y-1/2 bg-accent" />
    </motion.div>
  );
}

/** Whole-page mode: a line that sweeps the page top to bottom for as long as it is being read. */
function PageSweep() {
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 h-0.5 bg-accent"
      initial={{ top: "0%" }}
      animate={{ top: "100%" }}
      transition={{ duration: motionTokens.duration.deliberate, ease: motionTokens.easing.linear, repeat: Infinity }}
    />
  );
}

function pageLabel(state: OcrJobState, view: BedView): string | null {
  if (state.items.length === 0) return null;
  if (state.pages.length > 0 && view.currentPage !== null) return `Page ${view.currentPage} of ${state.pages.length}`;
  const index = view.current ? state.items.indexOf(view.current) + 1 : 0;
  return index > 0 ? `Image ${index} of ${state.items.length}` : null;
}

function Contact({ state, view }: { state: OcrJobState; view: BedView }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {state.items.map((item) => {
        const status = boxStateOf(state, view, item.id);
        const url = state.previews[item.id];
        return (
          <span
            key={item.id}
            className={cn(
              "relative flex aspect-[4/3] items-center justify-center overflow-hidden border bg-white transition-colors",
              status === "reading" ? "border-accent" : status === "read" ? "border-foreground/25" : "border-transparent bg-surface",
            )}
          >
            {url && (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob URL
              <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" />
            )}
            {status === "reading" && !reducedMotion && (
              <motion.span
                className="absolute inset-0 bg-accent/15"
                initial={{ opacity: 0.3 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: motionTokens.duration.deliberate,
                  ease: motionTokens.easing.standard,
                  repeat: Infinity,
                  repeatType: "mirror",
                }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

function PageSheet({
  state,
  view,
  mode,
  deferImages,
}: {
  state: OcrJobState;
  view: BedView;
  mode: OcrMode;
  deferImages?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const page = view.currentPage !== null ? view.pageOf.get(view.currentPage) : undefined;
  if (!page) return <div className="mx-auto aspect-[3/4] w-full max-w-md border border-border bg-white" />;

  const preview = state.pagePreviews[page.page];
  const readingHere = state.reading.some((id) => view.byId.get(id)?.page === page.page);
  let scanTop: number | null = null;
  if (mode === "embedded") {
    for (let i = state.reading.length - 1; i >= 0; i--) {
      const item = view.byId.get(state.reading[i]);
      if (item?.page === page.page && item.box) {
        scanTop = ((item.box.y + item.box.height) / page.heightPt) * 100;
        break;
      }
    }
  }

  return (
    <div
      className="relative mx-auto w-full max-w-md overflow-hidden border border-border bg-white"
      style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
    >
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob URL
        <img
          src={preview}
          alt=""
          loading={deferImages ? "lazy" : undefined}
          className="absolute inset-0 h-full w-full object-fill"
        />
      )}
      {mode === "embedded" && <PageBoxes state={state} view={view} page={page} />}
      {!reducedMotion && mode === "embedded" && scanTop !== null && <ScanLine top={scanTop} animateTop />}
      {!reducedMotion && mode === "pages" && readingHere && <PageSweep />}
    </div>
  );
}

function Filmstrip({ state, view }: { state: OcrJobState; view: BedView }) {
  if (state.pages.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto border-t border-border bg-surface-muted p-2">
      {state.pages.map((page) => (
        <span
          key={page.page}
          className={cn(
            "relative block h-16 shrink-0 overflow-hidden border bg-white",
            page.page === view.currentPage ? "border-accent" : "border-border",
          )}
          style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
        >
          {state.pagePreviews[page.page] && (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob URL
            <img src={state.pagePreviews[page.page]} alt="" loading="lazy" className="h-full w-full object-fill" />
          )}
        </span>
      ))}
    </div>
  );
}

function MiniMap({ state, view }: { state: OcrJobState; view: BedView }) {
  const page = view.currentPage !== null ? view.pageOf.get(view.currentPage) : undefined;
  const preview = view.currentPage !== null ? state.pagePreviews[view.currentPage] : undefined;
  // The slot keeps its 54x72 footprint so the row doesn't jump; the page inside it keeps its own
  // proportions (a landscape page is not stretched to portrait), and PageBoxes' percentages follow it.
  const landscape = page ? page.widthPt / page.heightPt >= 54 / 72 : false;
  return (
    <span aria-hidden="true" className="flex h-[72px] w-[54px] shrink-0 items-center justify-center">
      <span
        className="relative block overflow-hidden border border-border bg-white"
        style={
          page
            ? { aspectRatio: `${page.widthPt} / ${page.heightPt}`, ...(landscape ? { width: "100%" } : { height: "100%" }) }
            : { width: "100%", height: "100%" }
        }
      >
        {preview && state.items[0]?.box === null && (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob URL
          <img src={preview} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-fill" />
        )}
        {page && <PageBoxes state={state} view={view} page={page} fill />}
      </span>
    </span>
  );
}

export function OcrScannerBed({
  state,
  mode,
  onCancel,
  fileName,
  compact,
  deferImages,
  className,
}: {
  state: OcrJobState;
  mode: OcrMode;
  onCancel: () => void;
  fileName?: string;
  compact?: boolean;
  /** The copy that is hidden at this width: its images load lazily so a page decodes once. */
  deferImages?: boolean;
  className?: string;
}) {
  const view = useBedView(state);
  const label = pageLabel(state, view);
  // While improving, the bed is not reading anything: no sweep, and the progress line carries Cancel.
  const busy =
    state.phase === "opening" || state.phase === "preparing" || state.phase === "reading" || state.phase === "improving";

  if (compact) {
    return (
      <section aria-label="Scanner bed" className={cn("border-b border-border bg-background py-3", className)}>
        <div className="flex items-center gap-3 px-4">
          <MiniMap state={state} view={view} />
          <div className="min-w-0 flex-1">
            {busy ? (
              <OcrProgress state={state} onCancel={onCancel} padded={false} />
            ) : null}
            <p className="plate-marker mt-1 truncate">{[label, fileName].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
      </section>
    );
  }

  const isContactSheet = state.pages.length === 0 && state.items.length > 0;
  const foot = skippedSummary(state);

  return (
    <section aria-label="Scanner bed" className={cn("sheet", className)}>
      <div className="sheet-band">
        <span className="plate-marker">Scanner bed</span>
        {label && <span className="plate-marker">{label}</span>}
      </div>
      <div aria-hidden="true">
        <div className="bg-surface-muted p-4">
          {isContactSheet ? <Contact state={state} view={view} /> : <PageSheet state={state} view={view} mode={mode} deferImages={deferImages} />}
        </div>
        <Filmstrip state={state} view={view} />
      </div>
      {foot && (
        <div className="sheet-foot">
          <span className="plate-marker">{foot}</span>
        </div>
      )}
    </section>
  );
}
