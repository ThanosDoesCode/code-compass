-- Server-only event ledger for anonymous AI usage protection.
-- Raw visitor capabilities and IP addresses must never be written here; the
-- application HMAC-hashes every identifier before calling consume_ai_usage.

CREATE TABLE public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_hash TEXT NOT NULL CHECK (visitor_hash ~ '^[a-f0-9]{64}$'),
  ip_hash TEXT CHECK (ip_hash IS NULL OR ip_hash ~ '^[a-f0-9]{64}$'),
  action TEXT NOT NULL CHECK (action IN ('analyze', 'reanalyze', 'concept', 'ask')),
  resource_key_hash TEXT CHECK (
    resource_key_hash IS NULL OR resource_key_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.usage_events FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.usage_events TO service_role;

CREATE INDEX idx_usage_events_visitor_window
  ON public.usage_events(action, visitor_hash, created_at DESC);
CREATE INDEX idx_usage_events_ip_window
  ON public.usage_events(action, ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;
CREATE INDEX idx_usage_events_resource_window
  ON public.usage_events(action, visitor_hash, resource_key_hash, created_at DESC)
  WHERE resource_key_hash IS NOT NULL;
CREATE INDEX idx_usage_events_cleanup ON public.usage_events(created_at);

COMMENT ON TABLE public.usage_events IS
  'Server-only hashed AI usage events. Cleanup: DELETE FROM public.usage_events WHERE created_at < now() - interval ''7 days'';';

CREATE OR REPLACE FUNCTION public.consume_ai_usage(
  p_action TEXT,
  p_visitor_hash TEXT,
  p_ip_hash TEXT,
  p_resource_key_hash TEXT,
  p_rules JSONB
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INTEGER, limit_scope TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_rule JSONB;
  v_scope TEXT;
  v_window_seconds INTEGER;
  v_max_requests INTEGER;
  v_count BIGINT;
  v_oldest TIMESTAMPTZ;
  v_retry INTEGER;
BEGIN
  IF p_action NOT IN ('analyze', 'reanalyze', 'concept', 'ask') THEN
    RAISE EXCEPTION 'Unsupported usage action';
  END IF;
  IF p_visitor_hash !~ '^[a-f0-9]{64}$'
     OR (p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[a-f0-9]{64}$')
     OR (p_resource_key_hash IS NOT NULL AND p_resource_key_hash !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'Invalid usage identifier';
  END IF;
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' THEN
    RAISE EXCEPTION 'Usage rules must be an array';
  END IF;

  -- Serialize decisions for a visitor/action and IP/action so concurrent button
  -- spam cannot pass the count check before either event is inserted.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_action || ':visitor:' || p_visitor_hash, 0));
  IF p_ip_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_action || ':ip:' || p_ip_hash, 0));
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(p_rules)
  LOOP
    v_scope := v_rule->>'scope';
    v_window_seconds := (v_rule->>'windowSeconds')::INTEGER;
    v_max_requests := (v_rule->>'maxRequests')::INTEGER;
    IF v_scope NOT IN ('visitor', 'ip', 'visitor_resource')
       OR v_window_seconds <= 0 OR v_window_seconds > 604800
       OR v_max_requests <= 0 OR v_max_requests > 10000 THEN
      RAISE EXCEPTION 'Invalid usage rule';
    END IF;
    IF v_scope = 'ip' AND p_ip_hash IS NULL THEN
      CONTINUE;
    END IF;
    IF v_scope = 'visitor_resource' AND p_resource_key_hash IS NULL THEN
      RAISE EXCEPTION 'Resource-scoped rule requires a resource key';
    END IF;

    SELECT count(*), min(created_at)
      INTO v_count, v_oldest
    FROM public.usage_events
    WHERE action = p_action
      AND created_at >= v_now - make_interval(secs => v_window_seconds)
      AND CASE v_scope
        WHEN 'visitor' THEN visitor_hash = p_visitor_hash
        WHEN 'ip' THEN ip_hash = p_ip_hash
        WHEN 'visitor_resource' THEN
          visitor_hash = p_visitor_hash AND resource_key_hash = p_resource_key_hash
        ELSE FALSE
      END;

    IF v_count >= v_max_requests THEN
      v_retry := GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (v_oldest + make_interval(secs => v_window_seconds) - v_now)))::INTEGER
      );
      RETURN QUERY SELECT FALSE, v_retry, v_scope;
      RETURN;
    END IF;
  END LOOP;

  INSERT INTO public.usage_events(visitor_hash, ip_hash, action, resource_key_hash, created_at)
  VALUES (p_visitor_hash, p_ip_hash, p_action, p_resource_key_hash, v_now);

  RETURN QUERY SELECT TRUE, 0, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_usage(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_ai_usage(TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_usage(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
