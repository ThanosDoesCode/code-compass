import { describe, expect, test, spyOn } from "bun:test";
import { describeAuthError, reportAuthError } from "../src/lib/auth-errors";
import { publicAuthDefines } from "../src/lib/public-auth-config";

describe("safe auth failure diagnostics", () => {
  test.each([
    ["invalid_credentials", "The email or password is incorrect."],
    ["email_address_invalid", "Enter a valid email address."],
    ["weak_password", "Choose a stronger password with at least 8 characters."],
    ["signup_disabled", "Account creation is currently unavailable. Please try again later."],
    ["user_already_exists", "An account already exists for this email. Try signing in."],
    ["over_request_rate_limit", "Too many attempts. Please wait a moment and try again."],
  ])("maps %s without exposing provider text", (code, message) => {
    expect(describeAuthError({ code, message: "private provider details" }).message).toBe(message);
  });

  test("recognizes database failure from Supabase's generic unexpected_failure code", () => {
    const detail = describeAuthError({
      name: "AuthApiError",
      code: "unexpected_failure",
      status: 500,
      message: "Database error saving new user",
    });
    expect(detail.code).toBe("database_error");
    expect(detail.status).toBe(500);
    expect(detail.message).not.toContain("database");
  });

  test("logs only allowlisted diagnostics, never arbitrary error properties", () => {
    const logger = spyOn(console, "warn").mockImplementation(() => {});
    try {
      reportAuthError("signup", {
        name: "AuthApiError",
        status: 400,
        code: "email_address_invalid",
        message: "sensitive@example.com password=secret",
        access_token: "secret-token",
        headers: { Authorization: "secret" },
      });
      const logged = JSON.stringify(logger.mock.calls);
      expect(logged).toContain("signup");
      expect(logged).toContain("400");
      expect(logged).not.toContain("sensitive@example.com");
      expect(logged).not.toContain("secret");
    } finally {
      logger.mockRestore();
    }
  });

  test("missing public config is distinct from invalid user input", () => {
    expect(
      describeAuthError(new Error("Missing Supabase environment variable(s): SUPABASE_URL")).code,
    ).toBe("auth_config");
  });

  test("unknown messages and codes are never reflected", () => {
    const detail = describeAuthError({ code: "a-secret-code", message: "token=private" });
    expect(JSON.stringify(detail)).not.toContain("private");
    expect(detail.code).toBe("unknown");
  });
});

describe("public auth build configuration", () => {
  test("Lovable server aliases inject only public auth configuration", () => {
    const values = publicAuthDefines({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SERVICE_ROLE_KEY: "secret-value",
      ANTHROPIC_API_KEY: "other-secret",
    });
    expect(Object.keys(values)).toEqual([
      "import.meta.env.VITE_SUPABASE_URL",
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY",
    ]);
    expect(JSON.stringify(values)).not.toContain("secret");
  });
  test("VITE values take precedence", () => {
    const values = publicAuthDefines({
      VITE_SUPABASE_URL: "https://public.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
      SUPABASE_URL: "https://fallback.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fallback",
    });
    expect(values["import.meta.env.VITE_SUPABASE_URL"]).toBe('"https://public.supabase.co"');
  });
  test("secret/service-role keys are rejected", () => {
    expect(() =>
      publicAuthDefines({
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_private",
      }),
    ).toThrow();
    const jwt = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
    expect(() =>
      publicAuthDefines({
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: jwt,
      }),
    ).toThrow();
  });
  test("missing configuration does not prevent anonymous builds", () => {
    expect(publicAuthDefines({})).toEqual({});
  });
});
