-- CodeCompass persistence is accessed exclusively by trusted server functions.
-- No browser role needs direct table access; service_role keeps its existing grants
-- and bypasses RLS for the server-side cache and persistence workflows.

DROP POLICY IF EXISTS "repositories_public_read" ON public.repositories;
DROP POLICY IF EXISTS "analyses_public_read" ON public.analyses;
DROP POLICY IF EXISTS "concept_explanations_public_read" ON public.concept_explanations;
DROP POLICY IF EXISTS "chat_sessions_public_read" ON public.chat_sessions;
DROP POLICY IF EXISTS "chat_messages_public_read" ON public.chat_messages;

REVOKE ALL PRIVILEGES ON TABLE public.repositories FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.analyses FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.concept_explanations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.chat_sessions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.chat_messages FROM anon, authenticated;

-- The raw anonymous chat capability is returned only to the browser that created
-- the conversation. Supabase stores only its SHA-256 hash, never the capability.
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS access_token_hash TEXT;

-- Existing sessions cannot be resumed after this migration (the UI does not persist
-- them across page loads). Mark them with an unreachable legacy value before making
-- the new security column mandatory.
UPDATE public.chat_sessions
SET access_token_hash = 'legacy:' || id::text
WHERE access_token_hash IS NULL;

ALTER TABLE public.chat_sessions
  ALTER COLUMN access_token_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_access_token_hash
  ON public.chat_sessions(access_token_hash);

ALTER TABLE public.repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concept_explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
