import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_LOG_EVENTS,
  __resetLogForTests,
  appendEvent,
  clearLog,
  eventKey,
  getLogSnapshot,
  logIssue,
  subscribeToLog,
  summarizeLog,
  type ConversionLogEvent,
  type ConversionLogInput,
} from "./conversionLog";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:05:00.000Z";

function input(overrides: Partial<ConversionLogInput> = {}): ConversionLogInput {
  return {
    kind: "unmapped_character",
    severity: "warning",
    source: "text",
    code: "UNMAPPED_CHARACTER",
    message: "1 sequence had no mapping rule.",
    samples: ["Av"],
    ...overrides,
  };
}

describe("eventKey", () => {
  it("treats reports with the same content as the same issue", () => {
    expect(eventKey(input())).toBe(eventKey(input()));
  });

  it("separates the same failure on different files", () => {
    expect(eventKey(input({ fileName: "a.pdf" }))).not.toBe(eventKey(input({ fileName: "b.pdf" })));
  });

  it("separates different offending sequences", () => {
    expect(eventKey(input({ samples: ["Av"] }))).not.toBe(eventKey(input({ samples: ["ÿ"] })));
  });
});

describe("appendEvent", () => {
  it("creates a row with one occurrence", () => {
    const { events, event, isNew } = appendEvent([], input(), { id: "e1", now: NOW });
    expect(isNew).toBe(true);
    expect(events).toHaveLength(1);
    expect(event.occurrences).toBe(1);
    expect(event.firstSeenAt).toBe(NOW);
    expect(event.lastSeenAt).toBe(NOW);
  });

  it("merges a repeat instead of appending it", () => {
    const first = appendEvent([], input(), { id: "e1", now: NOW });
    const second = appendEvent(first.events, input(), { id: "e2", now: LATER });

    expect(second.isNew).toBe(false);
    expect(second.events).toHaveLength(1);
    expect(second.event.id).toBe("e1");
    expect(second.event.occurrences).toBe(2);
    expect(second.event.firstSeenAt).toBe(NOW);
    expect(second.event.lastSeenAt).toBe(LATER);
  });

  it("moves a merged row back to the top", () => {
    const a = appendEvent([], input({ samples: ["Av"] }), { id: "e1", now: NOW });
    const b = appendEvent(a.events, input({ samples: ["ÿ"] }), { id: "e2", now: NOW });
    const repeat = appendEvent(b.events, input({ samples: ["Av"] }), { id: "e3", now: LATER });

    expect(repeat.events.map((event) => event.id)).toEqual(["e1", "e2"]);
  });

  it("keeps distinct issues separate", () => {
    const a = appendEvent([], input(), { id: "e1", now: NOW });
    const b = appendEvent(a.events, input({ kind: "conversion_failed", severity: "error" }), {
      id: "e2",
      now: NOW,
    });
    expect(b.isNew).toBe(true);
    expect(b.events).toHaveLength(2);
  });

  it("drops the oldest rows past the cap", () => {
    let events: ConversionLogEvent[] = [];
    for (let index = 0; index < MAX_LOG_EVENTS + 5; index += 1) {
      events = appendEvent(events, input({ message: `failure ${index}` }), {
        id: `e${index}`,
        now: NOW,
      }).events;
    }
    expect(events).toHaveLength(MAX_LOG_EVENTS);
    expect(events[0]?.id).toBe(`e${MAX_LOG_EVENTS + 4}`);
  });

  it("defaults the optional context fields to null", () => {
    const { event } = appendEvent([], input({ samples: undefined }), { id: "e1", now: NOW });
    expect(event.encodingId).toBeNull();
    expect(event.fileName).toBeNull();
    expect(event.fileType).toBeNull();
    expect(event.samples).toEqual([]);
  });
});

describe("summarizeLog", () => {
  it("counts rows by severity and collects distinct unmapped samples", () => {
    const events = [
      appendEvent([], input({ samples: ["Av", "ÿ"] }), { id: "e1", now: NOW }).event,
      appendEvent([], input({ samples: ["Av"] }), { id: "e2", now: NOW }).event,
      appendEvent([], input({ kind: "conversion_failed", severity: "error" }), { id: "e3", now: NOW })
        .event,
    ];

    expect(summarizeLog(events)).toEqual({
      errors: 1,
      warnings: 2,
      unmappedSamples: ["Av", "ÿ"],
    });
  });

  it("reports an empty log as all clear", () => {
    expect(summarizeLog([])).toEqual({ errors: 0, warnings: 0, unmappedSamples: [] });
  });
});

describe("the store", () => {
  beforeEach(() => {
    __resetLogForTests();
  });

  it("reports a repeat as not new, so it is not re-sent to the backend", () => {
    expect(logIssue(input()).isNew).toBe(true);
    expect(logIssue(input()).isNew).toBe(false);
    expect(getLogSnapshot()).toHaveLength(1);
  });

  it("keeps snapshot identity stable until something changes", () => {
    const before = getLogSnapshot();
    expect(getLogSnapshot()).toBe(before);
    logIssue(input());
    expect(getLogSnapshot()).not.toBe(before);
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let notifications = 0;
    const unsubscribe = subscribeToLog(() => {
      notifications += 1;
    });

    logIssue(input());
    expect(notifications).toBe(1);

    unsubscribe();
    logIssue(input({ message: "something else" }));
    expect(notifications).toBe(1);
  });

  it("does not notify when clearing an already-empty log", () => {
    let notifications = 0;
    subscribeToLog(() => {
      notifications += 1;
    });

    clearLog();
    expect(notifications).toBe(0);

    logIssue(input());
    clearLog();
    expect(notifications).toBe(2);
    expect(getLogSnapshot()).toEqual([]);
  });
});
