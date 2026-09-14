-- Persistent CodeCompass accounts, saved repositories, and learning progress.
-- Existing repository analyses remain server-only; user-owned rows are accessed
-- with the authenticated user's JWT so row-level security is always enforced.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT CHECK (display_name IS NULL OR char_length(display_name) <= 100),
  avatar_url TEXT CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repository_id UUID NOT NULL REFERENCES public.repositories(id) ON DELETE CASCADE,
  analysis_id UUID REFERENCES public.analyses(id) ON DELETE SET NULL,
  owner TEXT NOT NULL CHECK (char_length(owner) BETWEEN 1 AND 100),
  repo TEXT NOT NULL CHECK (char_length(repo) BETWEEN 1 AND 100),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  language TEXT CHECK (language IS NULL OR char_length(language) <= 100),
  default_branch TEXT CHECK (default_branch IS NULL OR char_length(default_branch) <= 255),
  last_commit_sha TEXT CHECK (last_commit_sha IS NULL OR last_commit_sha ~ '^[a-fA-F0-9]{7,64}$'),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, repository_id)
);

CREATE TABLE IF NOT EXISTS public.learning_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repository_id UUID NOT NULL REFERENCES public.repositories(id) ON DELETE CASCADE,
  analysis_id UUID REFERENCES public.analyses(id) ON DELETE SET NULL,
  progress_json JSONB NOT NULL DEFAULT '{"version":1,"completedFiles":[],"completedFlowSteps":{},"visitedConcepts":[],"completedConcepts":[]}'::jsonb
    CHECK (pg_column_size(progress_json) <= 65536),
  last_view TEXT NOT NULL DEFAULT 'overview'
    CHECK (last_view IN ('overview', 'architecture', 'start', 'flow', 'concepts', 'ask')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, repository_id)
);

CREATE INDEX IF NOT EXISTS idx_user_repositories_user_opened
  ON public.user_repositories(user_id, last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_progress_user_updated
  ON public.learning_progress(user_id, updated_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.user_repositories FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.learning_progress FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_repositories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.learning_progress TO authenticated;
GRANT ALL ON TABLE public.profiles, public.user_repositories, public.learning_progress TO service_role;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS user_repositories_select_own ON public.user_repositories;
CREATE POLICY user_repositories_select_own ON public.user_repositories
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS user_repositories_insert_own ON public.user_repositories;
CREATE POLICY user_repositories_insert_own ON public.user_repositories
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS user_repositories_update_own ON public.user_repositories;
CREATE POLICY user_repositories_update_own ON public.user_repositories
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS user_repositories_delete_own ON public.user_repositories;
CREATE POLICY user_repositories_delete_own ON public.user_repositories
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS learning_progress_select_own ON public.learning_progress;
CREATE POLICY learning_progress_select_own ON public.learning_progress
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS learning_progress_insert_own ON public.learning_progress;
CREATE POLICY learning_progress_insert_own ON public.learning_progress
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS learning_progress_update_own ON public.learning_progress;
CREATE POLICY learning_progress_update_own ON public.learning_progress
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS learning_progress_delete_own ON public.learning_progress;
CREATE POLICY learning_progress_delete_own ON public.learning_progress
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.create_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture'), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_profile_for_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS create_profile_after_signup ON auth.users;
CREATE TRIGGER create_profile_after_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_profile_for_new_user();

DROP TRIGGER IF EXISTS profiles_touch ON public.profiles;
CREATE TRIGGER profiles_touch
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS learning_progress_touch ON public.learning_progress;
CREATE TRIGGER learning_progress_touch
  BEFORE UPDATE ON public.learning_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Add authenticated identity as an additional server-only limiter dimension.
ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_usage_events_user_window
  ON public.usage_events(action, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.consume_ai_usage(TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.consume_ai_usage(
  p_visitor_hash TEXT,
  p_ip_hash TEXT,
  p_user_id UUID,
  p_action TEXT,
  p_resource_key_hash TEXT,
  p_rules JSONB
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INTEGER, limit_scope TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_rule JSONB;
  v_scope TEXT;
  v_window_seconds INTEGER;
  v_max_requests INTEGER;
  v_oldest TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  IF p_visitor_hash !~ '^[a-f0-9]{64}$'
    OR (p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[a-f0-9]{64}$')
    OR (p_resource_key_hash IS NOT NULL AND p_resource_key_hash !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'Invalid hashed identifier';
  END IF;

  IF p_action NOT IN ('analyze', 'reanalyze', 'concept', 'ask') THEN
    RAISE EXCEPTION 'Invalid usage action';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_action || ':visitor:' || p_visitor_hash, 0));
  IF p_ip_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_action || ':ip:' || p_ip_hash, 0));
  END IF;
  IF p_user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_action || ':user:' || p_user_id::text, 0));
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(p_rules)
  LOOP
    v_scope := v_rule ->> 'scope';
    v_window_seconds := (v_rule ->> 'windowSeconds')::INTEGER;
    v_max_requests := (v_rule ->> 'maxRequests')::INTEGER;

    IF v_scope NOT IN ('user', 'visitor', 'ip', 'visitor_resource')
      OR v_window_seconds <= 0 OR v_max_requests <= 0 THEN
      RAISE EXCEPTION 'Invalid usage rule';
    END IF;
    IF v_scope = 'user' AND p_user_id IS NULL THEN CONTINUE; END IF;
    IF v_scope = 'ip' AND p_ip_hash IS NULL THEN CONTINUE; END IF;
    IF v_scope = 'visitor_resource' AND p_resource_key_hash IS NULL THEN CONTINUE; END IF;

    SELECT COUNT(*), MIN(created_at)
      INTO v_count, v_oldest
    FROM public.usage_events
    WHERE action = p_action
      AND created_at > v_now - make_interval(secs => v_window_seconds)
      AND CASE v_scope
        WHEN 'user' THEN user_id = p_user_id
        WHEN 'visitor' THEN visitor_hash = p_visitor_hash
        WHEN 'ip' THEN ip_hash = p_ip_hash
        WHEN 'visitor_resource' THEN
          visitor_hash = p_visitor_hash AND resource_key_hash = p_resource_key_hash
      END;

    IF v_count >= v_max_requests THEN
      RETURN QUERY SELECT false,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_oldest + make_interval(secs => v_window_seconds) - v_now)))::INTEGER),
        v_scope;
      RETURN;
    END IF;
  END LOOP;

  INSERT INTO public.usage_events(user_id, visitor_hash, ip_hash, action, resource_key_hash, created_at)
  VALUES (p_user_id, p_visitor_hash, p_ip_hash, p_action, p_resource_key_hash, v_now);
  RETURN QUERY SELECT true, 0, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_usage(TEXT, TEXT, UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_usage(TEXT, TEXT, UUID, TEXT, TEXT, JSONB)
  TO service_role;
