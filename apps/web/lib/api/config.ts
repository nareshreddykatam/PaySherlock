// Single configurable API base URL — see Phase 3 brief section 31. Never
// hard-code localhost URLs in components; import API_BASE_URL instead.
// NEXT_PUBLIC_ prefix is required for a client-visible env var in Next.js —
// this is a public base URL, never a secret.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
