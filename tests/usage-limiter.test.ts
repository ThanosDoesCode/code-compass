import { describe, expect, test } from "bun:test";

import {
  enforceAiUsage,
  UsageLimitError,
  type UsageAttempt,
  type UsageDecision,
  type UsageStore,
} from "../src/lib/usage-limiter.server";
import { requiresAiAllowance } from "../src/lib/usage-limits.server";

interface StoredAttempt extends UsageAttempt {
  createdAt: number;
}

class MemoryUsageStore implements UsageStore {
  readonly events: StoredAttempt[] = [];
  now = Date.UTC(2026, 8, 14, 12);

  advance(seconds: number) {
    this.now += seconds * 1000;
  }

  async consume(attempt: UsageAttempt): Promise<UsageDecision> {
    for (const rule of attempt.rules) {
      if (rule.scope === "ip" && !attempt.ipHash) continue;
      if (rule.scope === "user" && !attempt.userId) continue;
      if (rule.scope === "visitor_resource" && !attempt.resourceKeyHash) {
        throw new Error("Missing resource hash");
      }
      const matching = this.events.filter((event) => {
        if (event.action !== attempt.action) return false;
        if (event.createdAt < this.now - rule.windowSeconds * 1000) return false;
        if (rule.scope === "visitor") return event.visitorHash === attempt.visitorHash;
        if (rule.scope === "user") return event.userId === attempt.userId;
        if (rule.scope === "ip") return event.ipHash === attempt.ipHash;
        return (
          event.visitorHash === attempt.visitorHash &&
          event.resourceKeyHash === attempt.resourceKeyHash
        );
      });
      if (matching.length >= rule.maxRequests) {
        const oldest = Math.min(...matching.map((event) => event.createdAt));
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((oldest + rule.windowSeconds * 1000 - this.now) / 1000),
          ),
          limitScope: rule.scope,
        };
      }
    }
    this.events.push({ ...attempt, createdAt: this.now });
    return { allowed: true, retryAfterSeconds: 0, limitScope: null };
  }
}

const SECRET = "test-only-hmac-secret";
const IP = "203.0.113.42";
const VISITOR_A = "00000000-0000-4000-8000-000000000001";
const VISITOR_B = "00000000-0000-4000-8000-000000000002";

async function consume(
  store: MemoryUsageStore,
  action: UsageAttempt["action"],
  visitorId = VISITOR_A,
  resourceKey = `resource-${store.events.length}`,
  ipAddress: string | null = IP,
  userId: string | null = null,
) {
  return enforceAiUsage(
    { action, visitorId, resourceKey, ipAddress, userId },
    { store, secret: SECRET },
  );
}

describe("CodeCompass AI usage protection", () => {
  test("cached analysis does not consume analysis allowance", () => {
    const store = new MemoryUsageStore();
    if (requiresAiAllowance({ action: "analyze", cacheHit: true })) {
      throw new Error("Cached analysis unexpectedly required an allowance");
    }
    expect(store.events).toHaveLength(0);
  });

  test("uncached analysis consumes allowance", async () => {
    const store = new MemoryUsageStore();
    expect(requiresAiAllowance({ action: "analyze", cacheHit: false })).toBe(true);
    await consume(store, "analyze");
    expect(store.events).toHaveLength(1);
    expect(store.events[0]?.action).toBe("analyze");
  });

  test("Ask hourly limit blocks the twenty-first question", async () => {
    const store = new MemoryUsageStore();
    for (let index = 0; index < 20; index++) {
      await consume(store, "ask", VISITOR_A, "analysis-1");
      store.advance(31);
    }
    await expect(consume(store, "ask", VISITOR_A, "analysis-1")).rejects.toMatchObject({
      code: "rate_limited",
      action: "ask",
      limitScope: "visitor",
    });
  });

  test("Ask burst cooldown blocks an immediate repeat", async () => {
    const store = new MemoryUsageStore();
    await consume(store, "ask");
    await expect(consume(store, "ask")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 3,
    });
  });

  test("cached concept response does not consume allowance", () => {
    const store = new MemoryUsageStore();
    expect(requiresAiAllowance({ action: "concept", cacheHit: true })).toBe(false);
    expect(store.events).toHaveLength(0);
  });

  test("uncached concept generation consumes allowance", async () => {
    const store = new MemoryUsageStore();
    await consume(store, "concept");
    expect(store.events).toHaveLength(1);
    expect(store.events[0]?.action).toBe("concept");
  });

  test("same-repository re-analysis has a ten-minute cooldown", async () => {
    const store = new MemoryUsageStore();
    await consume(store, "reanalyze", VISITOR_A, "owner/repo@commit-a");
    await expect(
      consume(store, "reanalyze", VISITOR_A, "owner/repo@commit-a"),
    ).rejects.toMatchObject({
      code: "rate_limited",
      action: "reanalyze",
      retryAfterSeconds: 600,
      limitScope: "visitor_resource",
    });
    await consume(store, "reanalyze", VISITOR_A, "owner/repo@commit-b");
    expect(store.events).toHaveLength(2);
  });

  test("visitor limits are isolated", async () => {
    const store = new MemoryUsageStore();
    await consume(store, "ask", VISITOR_A, "analysis-1", null);
    await consume(store, "ask", VISITOR_B, "analysis-1", null);
    expect(store.events).toHaveLength(2);
  });

  test("authenticated identity is enforced across browser visitors", async () => {
    const store = new MemoryUsageStore();
    const userId = "00000000-0000-4000-8000-000000000123";
    for (let index = 0; index < 5; index++) {
      await consume(
        store,
        "analyze",
        index % 2 ? VISITOR_A : VISITOR_B,
        `repo-${index}`,
        null,
        userId,
      );
    }
    await expect(
      consume(store, "analyze", "00000000-0000-4000-8000-000000000099", "repo-6", null, userId),
    ).rejects.toMatchObject({ code: "rate_limited", limitScope: "user" });
  });

  test("the server-observed IP limit applies across visitors", async () => {
    const store = new MemoryUsageStore();
    for (let index = 0; index < 10; index++) {
      const visitor = `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
      await consume(store, "analyze", visitor, `repo-${index}`);
    }
    await expect(
      consume(store, "analyze", "00000000-0000-4000-8000-000000000099", "repo-10"),
    ).rejects.toMatchObject({ code: "rate_limited", limitScope: "ip" });
  });

  test("raw visitor IDs and IPs are never passed to persistence", async () => {
    const store = new MemoryUsageStore();
    await consume(store, "concept", VISITOR_A, "analysis-1:fetch");
    const event = store.events[0];
    expect(event?.visitorHash).not.toBe(VISITOR_A);
    expect(event?.ipHash).not.toBe(IP);
    expect(event?.visitorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(event?.ipHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("rate-limit errors include retryAfterSeconds", async () => {
    const store = new MemoryUsageStore();
    await consume(store, "ask");
    try {
      await consume(store, "ask");
      throw new Error("Expected a rate limit");
    } catch (error) {
      expect(error).toBeInstanceOf(UsageLimitError);
      expect((error as UsageLimitError).retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  test("normal requests below every configured limit succeed", async () => {
    const store = new MemoryUsageStore();
    await consume(store, "analyze", VISITOR_A, "owner/repo@a");
    await consume(store, "concept", VISITOR_A, "analysis-1:fetch");
    await consume(store, "ask", VISITOR_A, "analysis-1");
    expect(store.events.map((event) => event.action)).toEqual(["analyze", "concept", "ask"]);
  });
});
