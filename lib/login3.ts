/**
 * Login 3.0 OIDC helpers — PKCE Authorization Code Flow
 * No external dependencies (Web Crypto API only)
 */

// Next.js inlines NEXT_PUBLIC_* only when accessed as literal property names
// (process.env.NEXT_PUBLIC_X), NOT via dynamic access (process.env[name]).
const LOGIN3_DOMAIN = process.env.NEXT_PUBLIC_LOGIN3_DOMAIN!;
const LOGIN3_CLIENT_ID = process.env.NEXT_PUBLIC_LOGIN3_CLIENT_ID!;
const LOGIN3_REDIRECT_URI = process.env.NEXT_PUBLIC_LOGIN3_REDIRECT_URI!;
const LOGIN3_SCOPES = process.env.NEXT_PUBLIC_LOGIN3_SCOPES ?? "openid profile email wallet";

if (typeof window !== "undefined" && !LOGIN3_DOMAIN) {
  throw new Error("Missing NEXT_PUBLIC_LOGIN3_DOMAIN — check .env.local");
}

// ── PKCE helpers ──────────────────────────────────────────

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(digest);
}

export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

// ── Authorization URL ─────────────────────────────────────

export async function buildAuthorizationUrl(): Promise<{
  url: string;
  codeVerifier: string;
  state: string;
}> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: LOGIN3_CLIENT_ID,
    redirect_uri: LOGIN3_REDIRECT_URI,
    scope: LOGIN3_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return {
    url: `${LOGIN3_DOMAIN}/authorize?${params.toString()}`,
    codeVerifier,
    state,
  };
}

// ── Token Exchange ────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const res = await fetch(`${LOGIN3_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: LOGIN3_REDIRECT_URI,
      client_id: LOGIN3_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ── JWT utilities ─────────────────────────────────────────

interface Login3IdTokenClaims {
  sub: string;
  wallet_address?: string;
  email?: string;
  iss: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export function parseIdToken(idToken: string): Login3IdTokenClaims {
  const payload = idToken.split(".")[1];
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decoded);
}

export function isTokenExpired(idToken: string): boolean {
  try {
    const claims = parseIdToken(idToken);
    return Date.now() / 1000 > claims.exp;
  } catch {
    return true;
  }
}

// ── Session storage keys ──────────────────────────────────

export const SESSION_KEYS = {
  ID_TOKEN: "login3_id_token",
  CODE_VERIFIER: "login3_code_verifier",
  STATE: "login3_state",
} as const;
