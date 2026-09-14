import { getRequest } from "@tanstack/react-start/server";

import { AppError } from "./github.server";
import {
  usageRulesFor,
  type AiUsageAction,
  type UsageLimitScope,
  type UsageRule,
} from "./usage-limits.server";
import type { Json } from "@/integrations/supabase/types";

const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface UsageAttempt {
  action: AiUsageAction;
  visitorHash: string;
  ipHash: string | null;
  resourceKeyHash: string | null;
  rules: UsageRule[];
}

export interface UsageDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  limitScope: UsageLimitScope | null;
}

export interface UsageStore {
  consume(attempt: UsageAttempt): Promise<UsageDecision>;
}

export class UsageLimitError extends AppError {
  readonly action: AiUsageAction;
  readonly retryAfterSeconds: number;
  readonly limitScope: UsageLimitScope | null;

  constructor(action: AiUsageAction, decision: UsageDecision) {
    super("rate_limited", usageLimitMessage(action, decision));
    this.action = action;
    this.retryAfterSeconds = decision.retryAfterSeconds;
    this.limitScope = decision.limitScope;
  }
}

export function isAnonymousVisitorId(value: string): boolean {
  return VISITOR_ID_PATTERN.test(value);
}

function observedIp(): string | null {
  const request = getRequest();
  const headers = request?.headers;
  if (!headers) return null;
  const candidate =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  if (!candidate || candidate.length > 100) return null;
  return candidate;
}

function hashSecret(): string {
  const secret = process.env["AI_USAGE_HASH_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!secret) {
    throw new AppError("storage", "Usage protection is not configured in this environment.");
  }
  return secret;
}

export async function hashUsageIdentifier(
  value: string,
  namespace: "visitor" | "ip" | "resource",
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`codecompass:${namespace}:${value}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function readableDelay(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
  return `${Math.ceil(seconds / 3600)} hours`;
}

export function usageLimitMessage(action: AiUsageAction, decision: UsageDecision): string {
  const delay = readableDelay(decision.retryAfterSeconds);
  if (action === "reanalyze" && decision.limitScope === "visitor_resource") {
    return `This repository was just re-analyzed. Try again in about ${delay}.`;
  }
  if (action === "ask" && decision.retryAfterSeconds <= 30) {
    return `You’re sending questions too quickly. Try again in about ${delay}.`;
  }
  if (decision.retryAfterSeconds >= 12 * 60 * 60) {
    return "You’ve reached today’s CodeCompass usage limit. Try again tomorrow.";
  }
  const label = action === "ask" ? "Ask" : action === "concept" ? "concept" : "analysis";
  return `You’ve reached the temporary ${label} limit. Try again in about ${delay}.`;
}

async function supabaseUsageStore(): Promise<UsageStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    async consume(attempt) {
      const { data, error } = await supabaseAdmin.rpc("consume_ai_usage", {
        p_action: attempt.action,
        p_visitor_hash: attempt.visitorHash,
        p_ip_hash: attempt.ipHash,
        p_resource_key_hash: attempt.resourceKeyHash,
        p_rules: attempt.rules as unknown as Json,
      });
      const result = data?.[0];
      if (error || !result) {
        throw new AppError("storage", "We could not verify the current AI usage allowance.");
      }
      return {
        allowed: result.allowed,
        retryAfterSeconds: Math.max(0, result.retry_after_seconds),
        limitScope: result.limit_scope as UsageLimitScope | null,
      };
    },
  };
}

export async function enforceAiUsage(
  {
    action,
    visitorId,
    resourceKey,
    ipAddress,
  }: {
    action: AiUsageAction;
    visitorId: string;
    resourceKey?: string;
    ipAddress?: string | null;
  },
  dependencies: { store?: UsageStore; secret?: string } = {},
): Promise<void> {
  if (!isAnonymousVisitorId(visitorId)) {
    throw new AppError("invalid_input", "Refresh CodeCompass and try that request again.");
  }
  const secret = dependencies.secret ?? hashSecret();
  const ip = ipAddress === undefined ? observedIp() : ipAddress;
  const attempt: UsageAttempt = {
    action,
    visitorHash: await hashUsageIdentifier(visitorId, "visitor", secret),
    ipHash: ip ? await hashUsageIdentifier(ip, "ip", secret) : null,
    resourceKeyHash: resourceKey
      ? await hashUsageIdentifier(resourceKey, "resource", secret)
      : null,
    rules: usageRulesFor(action),
  };
  const store = dependencies.store ?? (await supabaseUsageStore());
  const decision = await store.consume(attempt);
  if (!decision.allowed) throw new UsageLimitError(action, decision);
}
