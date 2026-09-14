import {
  Bookmark,
  ChevronDown,
  LoaderCircle,
  LogIn,
  LogOut,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getAccountOverview,
  removeSavedRepository,
  touchSavedRepository,
} from "@/lib/account.functions";
import type { SavedRepository } from "@/lib/account-schema";
import { AuthDialog, useCodeCompassAuth } from "./CodeCompassAuth";

export function AccountControl({ onSaved }: { onSaved: () => void }) {
  const { status, user, recoveryRequested, clearRecovery } = useCodeCompassAuth();
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up" | "forgot" | "reset" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (recoveryRequested) setAuthMode("reset");
  }, [recoveryRequested]);

  const closeAuth = () => {
    setAuthMode(null);
    clearRecovery();
  };

  if (status === "restoring") {
    return (
      <span className="account-restoring" aria-label="Restoring account session">
        <LoaderCircle className="spin" size={16} />
      </span>
    );
  }
  if (!user) {
    return (
      <div className="account-signed-out">
        <button className="header-action" type="button" onClick={() => setAuthMode("sign_in")}>
          <LogIn size={15} /> Sign in
        </button>
        <button
          className="header-action account-create"
          type="button"
          onClick={() => setAuthMode("sign_up")}
        >
          <UserPlus size={15} /> Create account
        </button>
        {authMode && <AuthDialog initialMode={authMode} onClose={closeAuth} />}
      </div>
    );
  }

  const label =
    user.user_metadata?.["display_name"] ||
    user.user_metadata?.["full_name"] ||
    user.email ||
    "Account";
  const initials = String(label).slice(0, 2).toUpperCase();
  return (
    <div className="account-menu-wrap">
      <button
        className="account-trigger"
        type="button"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span>{initials}</span>
        <ChevronDown size={14} />
      </button>
      {menuOpen && (
        <div className="account-menu" role="menu">
          <div>
            <strong>{label}</strong>
            {user.email && label !== user.email && <small>{user.email}</small>}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onSaved();
            }}
          >
            <Bookmark size={15} /> Saved repositories
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void import("@/integrations/supabase/client").then(({ supabase }) =>
                supabase.auth.signOut(),
              )
            }
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
      {authMode && <AuthDialog initialMode={authMode} onClose={closeAuth} />}
    </div>
  );
}

function relativeDate(value: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function SavedRepositoriesScreen({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (repository: SavedRepository) => void;
}) {
  const [repositories, setRepositories] = useState<SavedRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getAccountOverview();
      if (!result.ok) setError(result.message);
      else setRepositories(result.repositories);
    } catch {
      setError("Saved repositories could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    closeButton.current?.focus();
  }, [load]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  const remove = async (repository: SavedRepository) => {
    const result = await removeSavedRepository({ data: { savedRepositoryId: repository.id } });
    if (result.ok)
      setRepositories((current) => current.filter((item) => item.id !== repository.id));
    else setError(result.message);
  };
  const open = async (repository: SavedRepository) => {
    await touchSavedRepository({ data: { savedRepositoryId: repository.id } });
    onOpen(repository);
  };
  return (
    <main className="saved-screen">
      <header>
        <div>
          <span className="eyebrow">Account</span>
          <h1>Saved repositories</h1>
          <p>Continue learning from repositories you previously analyzed.</p>
        </div>
        <button
          ref={closeButton}
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="Close saved repositories"
        >
          <X size={19} />
        </button>
      </header>
      {loading ? (
        <div className="saved-state">
          <LoaderCircle className="spin" size={20} /> Loading saved repositories...
        </div>
      ) : error ? (
        <div className="saved-state error" role="alert">
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : repositories.length === 0 ? (
        <div className="saved-state">
          <Bookmark size={22} />
          <h2>No saved repositories yet</h2>
          <p>Analyze a public repository while signed in and it will appear here.</p>
        </div>
      ) : (
        <div className="saved-list">
          {repositories.map((repository) => (
            <article key={repository.id}>
              <div className="saved-repo-main">
                <button type="button" onClick={() => void open(repository)}>
                  <strong>
                    {repository.owner} / {repository.repo}
                  </strong>
                </button>
                <p>{repository.description || "No description provided."}</p>
                <div className="saved-meta">
                  <span>{repository.language || "Mixed"}</span>
                  <span>{repository.defaultBranch || "Default branch"}</span>
                  <code>{repository.lastCommitSha?.slice(0, 7) || "No commit"}</code>
                  <span>Opened {relativeDate(repository.lastOpenedAt)}</span>
                </div>
                <div className="saved-progress">
                  <span>
                    {repository.progress.completedFiles} of {repository.progress.totalFiles} files
                    read
                  </span>
                  <span>
                    {repository.progress.completedFlows} of {repository.progress.totalFlows} flows
                    completed
                  </span>
                  <span>
                    {repository.progress.exploredConcepts} of {repository.progress.totalConcepts}{" "}
                    concepts explored
                  </span>
                </div>
              </div>
              <div className="saved-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void open(repository)}
                >
                  Open
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => void remove(repository)}
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
