export type AuthOperation = "signup" | "signin" | "reset_email" | "reset_password" | "github";

const knownErrors: Record<string, { message: string; diagnostic: string }> = {
  user_already_exists: {
    message: "An account already exists for this email. Try signing in.",
    diagnostic: "Account already exists.",
  },
  email_exists: {
    message: "An account already exists for this email. Try signing in.",
    diagnostic: "Email already registered.",
  },
  invalid_credentials: {
    message: "The email or password is incorrect.",
    diagnostic: "Invalid credentials.",
  },
  email_not_confirmed: {
    message: "Confirm your email before signing in.",
    diagnostic: "Email confirmation required.",
  },
  email_address_invalid: {
    message: "Enter a valid email address.",
    diagnostic: "Email address rejected.",
  },
  validation_failed: {
    message: "Check your email and password and try again.",
    diagnostic: "Auth input validation failed.",
  },
  weak_password: {
    message: "Choose a stronger password with at least 8 characters.",
    diagnostic: "Password rejected by strength policy.",
  },
  signup_disabled: {
    message: "Account creation is currently unavailable. Please try again later.",
    diagnostic: "Signup disabled.",
  },
  email_provider_disabled: {
    message: "Email sign-in is currently unavailable. Please try again later.",
    diagnostic: "Email provider disabled.",
  },
  provider_disabled: {
    message: "This sign-in method is currently unavailable.",
    diagnostic: "Provider disabled.",
  },
  over_request_rate_limit: {
    message: "Too many attempts. Please wait a moment and try again.",
    diagnostic: "Auth request rate limit.",
  },
  over_email_send_rate_limit: {
    message: "Too many email requests. Please wait before trying again.",
    diagnostic: "Auth email rate limit.",
  },
  otp_expired: {
    message: "This link has expired. Request a new one.",
    diagnostic: "Expired email link.",
  },
  session_not_found: {
    message: "Your session expired. Please sign in again.",
    diagnostic: "Session not found.",
  },
  unexpected_failure: {
    message: "Account creation could not be completed. Please try again later.",
    diagnostic: "Unexpected auth service failure.",
  },
};

export function describeAuthError(error: unknown) {
  const raw = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const text = typeof raw["message"] === "string" ? raw["message"].toLowerCase() : "";
  const status =
    typeof raw["status"] === "number" && Number.isInteger(raw["status"]) ? raw["status"] : null;
  let code =
    typeof raw["code"] === "string" && Object.hasOwn(knownErrors, raw["code"])
      ? raw["code"]
      : "unknown";
  // Older SDK/server responses may omit a code. Classify their text, but never
  // return or log that text: it can contain email addresses or other secrets.
  if (text.includes("database error") && (text.includes("user") || text.includes("signup")))
    code = "database_error";
  else if (text.includes("missing supabase environment") || text.includes("process is not defined"))
    code = "auth_config";
  else if (code === "unknown") {
    if (text.includes("invalid login") || text.includes("invalid credentials"))
      code = "invalid_credentials";
    else if (text.includes("already registered") || text.includes("already exists"))
      code = "user_already_exists";
    else if (text.includes("weak password")) code = "weak_password";
    else if (status === 429 || text.includes("too many requests")) code = "over_request_rate_limit";
    else if (text.includes("fetch") || text.includes("network")) code = "network_error";
  }
  const extra: Record<string, { message: string; diagnostic: string }> = {
    database_error: {
      message: "Account creation is temporarily unavailable. Please try again later.",
      diagnostic: "Database error creating user. Inspect auth.users triggers and database logs.",
    },
    auth_config: {
      message: "Account services are not configured correctly. Please try again later.",
      diagnostic: "Public Supabase auth configuration unavailable.",
    },
    network_error: {
      message: "Could not reach account services. Check your connection and try again.",
      diagnostic: "Auth network request failed.",
    },
  };
  const detail = extra[code] ??
    knownErrors[code] ?? {
      message: "Account access failed. Please try again later.",
      diagnostic:
        "Unclassified auth failure; inspect the signup response in browser Network tools.",
    };
  const allowedTypes = [
    "AuthApiError",
    "AuthRetryableFetchError",
    "AuthUnknownError",
    "AuthSessionMissingError",
    "AuthWeakPasswordError",
  ];
  return {
    ...detail,
    code,
    status,
    type: allowedTypes.includes(String(raw["name"])) ? String(raw["name"]) : "AuthError",
  };
}

export function reportAuthError(operation: AuthOperation, error: unknown): string {
  const detail = describeAuthError(error);
  console.warn("[CodeCompass Auth]", {
    operation,
    type: detail.type,
    status: detail.status,
    code: detail.code,
    message: detail.diagnostic,
  });
  return detail.message;
}
