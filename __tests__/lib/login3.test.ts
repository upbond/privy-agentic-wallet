import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch for token exchange
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after env vars are set by setup.ts
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  parseIdToken,
  isTokenExpired,
} from "@/lib/login3";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("generateCodeVerifier", () => {
  it("returns a base64url string of correct length", () => {
    const verifier = generateCodeVerifier();
    // 32 bytes → 43 chars in base64url (no padding)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBe(43);
  });

  it("produces different values on each call", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generateCodeChallenge", () => {
  it("returns a deterministic SHA-256 hash in base64url format", async () => {
    const verifier = "test-verifier-value";
    const challenge1 = await generateCodeChallenge(verifier);
    const challenge2 = await generateCodeChallenge(verifier);
    expect(challenge1).toBe(challenge2);
    expect(challenge1).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("buildAuthorizationUrl", () => {
  it("returns url with correct PKCE params", async () => {
    const { url, codeVerifier, state } = await buildAuthorizationUrl();

    expect(url).toContain("https://login3.test.example.com/authorize");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=test-login3-client-id");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("code_challenge=");
    expect(url).toContain("state=");
    expect(codeVerifier).toBeTruthy();
    expect(state).toBeTruthy();
  });
});

describe("exchangeCodeForTokens", () => {
  it("sends correct POST and returns tokens", async () => {
    const mockTokens = {
      access_token: "mock-access-token",
      id_token: "mock-id-token",
      token_type: "Bearer",
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTokens),
    });

    const result = await exchangeCodeForTokens("auth-code", "code-verifier");

    expect(result).toEqual(mockTokens);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://login3.test.example.com/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    );

    // Verify body params
    const callBody = mockFetch.mock.calls[0][1].body as URLSearchParams;
    expect(callBody.get("grant_type")).toBe("authorization_code");
    expect(callBody.get("code")).toBe("auth-code");
    expect(callBody.get("code_verifier")).toBe("code-verifier");
    expect(callBody.get("client_id")).toBe("test-login3-client-id");
  });

  it("throws on error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve("invalid_grant"),
    });

    await expect(
      exchangeCodeForTokens("bad-code", "verifier")
    ).rejects.toThrow("Token exchange failed (400)");
  });
});

describe("parseIdToken", () => {
  it("decodes JWT payload correctly", () => {
    const payload = { sub: "user-123", email: "test@example.com", exp: 9999999999 };
    const encodedPayload = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const fakeJwt = `header.${encodedPayload}.signature`;

    const claims = parseIdToken(fakeJwt);
    expect(claims.sub).toBe("user-123");
    expect(claims.email).toBe("test@example.com");
  });
});

describe("isTokenExpired", () => {
  it("returns false for token with future expiration", () => {
    const payload = { sub: "user-1", exp: Math.floor(Date.now() / 1000) + 3600 };
    const encoded = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const jwt = `h.${encoded}.s`;

    expect(isTokenExpired(jwt)).toBe(false);
  });

  it("returns true for token with past expiration", () => {
    const payload = { sub: "user-1", exp: Math.floor(Date.now() / 1000) - 3600 };
    const encoded = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const jwt = `h.${encoded}.s`;

    expect(isTokenExpired(jwt)).toBe(true);
  });

  it("returns true for malformed token", () => {
    expect(isTokenExpired("not-a-jwt")).toBe(true);
  });
});
