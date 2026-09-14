export type AiUsageAction = "analyze" | "reanalyze" | "concept" | "ask";
export type UsageLimitScope = "visitor" | "ip" | "visitor_resource";

export interface UsageRule {
  scope: UsageLimitScope;
  windowSeconds: number;
  maxRequests: number;
}

export interface ActionUsageLimits {
  rules: readonly UsageRule[];
}

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;

/** The single configuration point for all Anthropic-backed usage limits. */
export const AI_USAGE_LIMITS: Readonly<Record<AiUsageAction, ActionUsageLimits>> = {
  analyze: {
    rules: [
      { scope: "visitor_resource", windowSeconds: 10, maxRequests: 1 },
      { scope: "visitor", windowSeconds: DAY, maxRequests: 5 },
      { scope: "ip", windowSeconds: DAY, maxRequests: 10 },
    ],
  },
  reanalyze: {
    rules: [
      { scope: "visitor_resource", windowSeconds: 10 * 60, maxRequests: 1 },
      { scope: "visitor", windowSeconds: DAY, maxRequests: 3 },
      { scope: "ip", windowSeconds: DAY, maxRequests: 6 },
    ],
  },
  concept: {
    rules: [
      { scope: "visitor", windowSeconds: DAY, maxRequests: 20 },
      { scope: "ip", windowSeconds: DAY, maxRequests: 40 },
    ],
  },
  ask: {
    rules: [
      { scope: "visitor", windowSeconds: 3, maxRequests: 1 },
      { scope: "visitor", windowSeconds: 30, maxRequests: 5 },
      { scope: "visitor", windowSeconds: HOUR, maxRequests: 20 },
      { scope: "visitor", windowSeconds: DAY, maxRequests: 60 },
      { scope: "ip", windowSeconds: HOUR, maxRequests: 30 },
      { scope: "ip", windowSeconds: DAY, maxRequests: 120 },
    ],
  },
};

export function requiresAiAllowance({
  action,
  cacheHit,
  force = false,
}: {
  action: AiUsageAction;
  cacheHit: boolean;
  force?: boolean;
}): boolean {
  if (action === "ask") return true;
  if (action === "reanalyze" || force) return true;
  return !cacheHit;
}

export function usageRulesFor(action: AiUsageAction): UsageRule[] {
  return AI_USAGE_LIMITS[action].rules.map((rule) => ({ ...rule }));
}
