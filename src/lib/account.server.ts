import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";

export class AccountAuthError extends Error {
  constructor(
    public readonly code: "auth_required" | "auth_expired" | "auth_config",
    message: string,
  ) {
    super(message);
    this.name = "AccountAuthError";
  }
}

function configuredClient(token: string): SupabaseClient<Database> {
  // Lovable injects the browser-safe project URL and publishable key at build
  // time. Independent deployments can provide their server-side aliases.
  const url = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] || import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new AccountAuthError("auth_config", "Account services are not configured.");
  }
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(): string | null {
  const value = getRequest()?.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token && token.split(".").length === 3 ? token : null;
}

export async function authenticatedAccount(): Promise<{
  client: SupabaseClient<Database>;
  user: User;
}> {
  const token = bearerToken();
  if (!token) throw new AccountAuthError("auth_required", "Sign in to continue.");
  const client = configuredClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new AccountAuthError("auth_expired", "Your session expired. Please sign in again.");
  }
  return { client, user: data.user };
}

export async function optionalAuthenticatedUser(): Promise<User | null> {
  const token = bearerToken();
  if (!token) return null;
  try {
    const client = configuredClient(token);
    const { data, error } = await client.auth.getUser(token);
    return error ? null : data.user;
  } catch {
    return null;
  }
}
