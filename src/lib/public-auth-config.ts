// Build-time only. Never copy the complete environment into the browser.
// Public (browser-safe) values of this project's Lovable Cloud backend. Used when
// the publish build environment does not provide the VITE_* variables.
const FALLBACK_URL = "https://bzbmqdwvxubpzcwgolwj.supabase.co";
const FALLBACK_KEY = "sb_publishable_cOEaX7zX_p4Bm650S0IQmw_YAAcWvLu";

export function publicAuthDefines(env: Record<string, string>): Record<string, string> {
  const url = env["VITE_SUPABASE_URL"] || env["SUPABASE_URL"] || FALLBACK_URL;
  const key =
    env["VITE_SUPABASE_PUBLISHABLE_KEY"] || env["SUPABASE_PUBLISHABLE_KEY"] || FALLBACK_KEY;
  // Modern publishable keys and legacy anon JWTs are browser-safe. Reject
  // service-role/secret keys even if accidentally assigned to a public alias.
  let publicKey = key.startsWith("sb_publishable_");
  if (!publicKey) {
    try {
      publicKey =
        JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role === "anon";
    } catch {
      publicKey = false;
    }
  }
  if (!publicKey) throw new Error("Supabase browser auth requires a publishable or anon key.");
  if (!/^https?:\/\//.test(url))
    throw new Error("Supabase browser auth requires a valid project URL.");
  return {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(key),
  };
}
