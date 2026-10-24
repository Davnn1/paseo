import type { SessionInfo } from "@opencode/client";
import { describe, expect, test } from "vitest";
import { SessionChildren } from "./children.js";
import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
import type { V2Api } from "./api.js";

function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "child",
    parentID: "parent",
    projectID: "project",
    agent: "worker",
    model: { id: "gemini-3.8-flash", providerID: "omniroute-agy", variant: "default" },
    cost: 0,
    tokens: {
      input: 18_830,
      output: 5,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    outcome: "succeeded",
    time: { created: 1, updated: 2 },
    title: "Review the diff",
    location: { directory: "/tmp/project" },
    ...overrides,
  };
}

function fakeClient(children: SessionInfo[], messages: unknown[] = []): V2Api {
  const pages = new Map<string, SessionInfo[]>();
  for (const child of children) {
    const parentID = child.parentID ?? "";
    pages.set(parentID, [...(pages.get(parentID) ?? []), child]);
  }
  return {
    session: {
      list: async ({ parentID }: { parentID?: string } = {}) => ({
        data: parentID ? (pages.get(parentID) ?? []) : [],
        cursor: { next: null },
      }),
      active: async () => ({}),
      get: async ({ sessionID }: { sessionID: string }) =>
        children.find((child) => child.id === sessionID) ?? sessionInfo({ id: sessionID }),
    },
    message: {
      list: async () => ({ data: messages, cursor: { next: null } }),
    },
  } as unknown as V2Api;
}

function collect() {
  const events: AgentStreamEvent[] = [];
  return {
    events,
    emit(event: AgentStreamEvent) {
      events.push(event);
    },
  };
}

function subtitleOf(events: AgentStreamEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== "provider_subagent") continue;
    const payload = event.event;
    if (payload.type === "upsert") return payload.subtitle;
  }
  return undefined;
}

describe("OpenCode v2 subagent presentation", () => {
  test("upsert carries agent, model, variant and token subtitle", async () => {
    const child = sessionInfo();
    const { events, emit } = collect();
    const children = new SessionChildren({
      client: () => fakeClient([child]),
      id: "parent",
      emit,
      reconcilePermissions: async () => {},
    });

    await children.reconcile("parent");

    expect(subtitleOf(events)).toBe("worker · gemini-3.8-flash · Default · 18.8k tokens");
  });

  test("falls back to the facts that are present", async () => {
    const child = sessionInfo({
      agent: undefined,
      model: undefined,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    });
    const { events, emit } = collect();
    const children = new SessionChildren({
      client: () => fakeClient([child]),
      id: "parent",
      emit,
      reconcilePermissions: async () => {},
    });

    await children.reconcile("parent");

    expect(subtitleOf(events)).toBeUndefined();
  });
});
