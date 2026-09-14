import type { Session, User } from "@supabase/supabase-js";
import { Github, LoaderCircle, LogIn, UserPlus, X } from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type AuthStatus = "restoring" | "signed_out" | "signed_in";
type AuthMode = "sign_in" | "sign_up" | "forgot" | "reset";

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  recoveryRequested: boolean;
  clearRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function authClient() {
  return (await import("@/integrations/supabase/client")).supabase;
}

export function CodeCompassAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const [session, setSession] = useState<Session | null>(null);
  const [recoveryRequested, setRecoveryRequested] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void authClient()
      .then((supabase) => {
        if (!active) return;
        void supabase.auth
          .getSession()
          .then(({ data }) => {
            if (!active) return;
            setSession(data.session);
            setStatus(data.session ? "signed_in" : "signed_out");
          })
          .catch(() => {
            if (active) setStatus("signed_out");
          });
        const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
          if (!active) return;
          setSession(nextSession);
          setStatus(nextSession ? "signed_in" : "signed_out");
          if (event === "PASSWORD_RECOVERY") setRecoveryRequested(true);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() => {
        if (active) setStatus("signed_out");
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        session,
        user: session?.user ?? null,
        recoveryRequested,
        clearRecovery: () => setRecoveryRequested(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCodeCompassAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("CodeCompassAuthProvider is missing.");
  return context;
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("invalid login") || message.includes("invalid credentials")) {
    return "The email or password is incorrect.";
  }
  if (message.includes("already registered") || message.includes("already exists")) {
    return "An account already exists for this email.";
  }
  if (message.includes("rate") || message.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (message.includes("expired")) return "This link has expired. Request a new one.";
  return "Account access failed. Check your details and try again.";
}

export function AuthDialog({
  initialMode,
  onClose,
}: {
  initialMode: AuthMode;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if ((mode === "sign_up" || mode === "reset") && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if ((mode === "sign_up" || mode === "reset") && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "sign_in") {
        const supabase = await authClient();
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        onClose();
      } else if (mode === "sign_up") {
        const supabase = await authClient();
        const { data, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;
        if (data.session) onClose();
        else setSuccess("Check your email to confirm your account, then return to CodeCompass.");
      } else if (mode === "forgot") {
        const supabase = await authClient();
        const redirectTo = new URL(window.location.href);
        redirectTo.searchParams.set("auth", "reset");
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: redirectTo.toString(),
        });
        if (authError) throw authError;
        setSuccess("If that email has an account, a reset link is on its way.");
      } else {
        const supabase = await authClient();
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        setSuccess("Password updated. You can continue using CodeCompass.");
      }
    } catch (authError) {
      setError(friendlyAuthError(authError));
    } finally {
      setBusy(false);
    }
  };

  const githubSignIn = async () => {
    setBusy(true);
    setError("");
    try {
      const supabase = await authClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: window.location.href,
          scopes: "read:user user:email",
        },
      });
      if (authError) throw authError;
    } catch (authError) {
      setError(friendlyAuthError(authError));
      setBusy(false);
    }
  };

  const title =
    mode === "sign_in"
      ? "Sign in to CodeCompass"
      : mode === "sign_up"
        ? "Create your account"
        : mode === "forgot"
          ? "Reset your password"
          : "Choose a new password";
  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), a[href]",
      ) ?? [],
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="auth-overlay" role="presentation">
      <button className="auth-backdrop" type="button" onClick={onClose} aria-label="Close" />
      <div
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        ref={dialog}
        onKeyDown={trapFocus}
      >
        <button
          className="auth-close"
          type="button"
          onClick={onClose}
          aria-label="Close account dialog"
        >
          <X size={18} />
        </button>
        <span className="eyebrow">Account</span>
        <h1 id="auth-title">{title}</h1>
        <p>Save repositories and keep your learning progress across sessions.</p>
        <form onSubmit={submit}>
          {mode !== "reset" && (
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label>
              Password
              <input
                type="password"
                required
                minLength={mode === "sign_in" ? 6 : 8}
                autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {(mode === "sign_up" || mode === "reset") && (
            <label>
              Confirm password
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          )}
          {error && (
            <div className="auth-message error" role="alert">
              {error}
            </div>
          )}
          {success && (
            <div className="auth-message success" role="status">
              {success}
            </div>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={16} /> Working...
              </>
            ) : mode === "sign_in" ? (
              "Sign in"
            ) : mode === "sign_up" ? (
              "Create account"
            ) : mode === "forgot" ? (
              "Send reset link"
            ) : (
              "Update password"
            )}
          </button>
        </form>
        {(mode === "sign_in" || mode === "sign_up") && (
          <button
            className="secondary-button auth-oauth"
            type="button"
            onClick={() => void githubSignIn()}
            disabled={busy}
          >
            <Github size={16} /> Continue with GitHub
          </button>
        )}
        <div className="auth-links">
          {mode === "sign_in" && (
            <>
              <button type="button" onClick={() => setMode("forgot")}>
                Forgot password?
              </button>
              <button type="button" onClick={() => setMode("sign_up")}>
                <UserPlus size={14} /> Create account
              </button>
            </>
          )}
          {mode !== "sign_in" && mode !== "reset" && (
            <button type="button" onClick={() => setMode("sign_in")}>
              <LogIn size={14} /> Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
