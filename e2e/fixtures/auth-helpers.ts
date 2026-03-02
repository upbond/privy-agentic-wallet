import type { Page } from "@playwright/test";

const MOCK_WALLET_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

/**
 * Build a mock JWT (header.payload.signature) with given claims.
 */
function buildMockJwt(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.mock-signature`;
}

/**
 * Pre-seed sessionStorage with a mock Login 3.0 ID token.
 * Must be called BEFORE page.goto() via page.addInitScript().
 */
export async function seedLogin3Session(page: Page) {
  const claims = {
    sub: "login3-user-123",
    wallet_address: MOCK_WALLET_ADDRESS,
    email: "test@example.com",
    iss: "https://login3.test.example.com",
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  };

  const jwt = buildMockJwt(claims);

  await page.addInitScript((token: string) => {
    sessionStorage.setItem("login3_id_token", token);
  }, jwt);
}

/**
 * Minimal Privy app config that satisfies SDK validation.
 * The SDK checks login method fields from server config — at least one must be truthy.
 * We enable `custom_jwt_auth` since this app uses Login 3.0 JWT auth.
 */
const PRIVY_APP_CONFIG = {
  id: "clxxxxxxxxxxxxxxxxxtestid",
  name: "Privy Agentic Wallet Test",
  logo_url: null,
  accent_color: null,
  // At least one login method must be enabled
  custom_jwt_auth: true,
  wallet_auth: false,
  solana_wallet_auth: false,
  email_auth: false,
  sms_auth: false,
  google_oauth: false,
  twitter_oauth: false,
  discord_oauth: false,
  github_oauth: false,
  linkedin_oauth: false,
  apple_oauth: false,
  spotify_oauth: false,
  instagram_oauth: false,
  tiktok_oauth: false,
  line_oauth: false,
  twitch_oauth: false,
  farcaster_auth: false,
  telegram_auth: false,
  passkey_auth: false,
  show_wallet_login_first: false,
  disable_plus_emails: false,
  terms_and_conditions_url: null,
  privacy_policy_url: null,
  require_users_accept_terms: false,
  passkeys_for_signup_enabled: false,
  whatsapp_enabled: false,
  embedded_wallet_config: {
    create_on_login: "users-without-wallets",
    ethereum: { create_on_login: "users-without-wallets" },
    solana: { create_on_login: "off" },
    require_user_owned_recovery_on_create: false,
    user_owned_recovery_options: ["user-passcode"],
    mode: "user-controlled-server-wallets-only",
  },
  allowlist_config: {
    error_title: null,
    error_detail: null,
    cta_text: null,
    cta_link: null,
  },
  captcha_site_key: "",
  enabled_captcha_provider: null,
  legacy_wallet_ui_config: false,
  enforce_wallet_uis: false,
};

/**
 * Intercept Privy auth/API network requests so the SDK initializes quickly.
 * Returns a valid app config so `ready` becomes true.
 */
export async function mockPrivyNetwork(page: Page) {
  // Privy SDK initialization — intercept all auth.privy.io requests
  await page.route("**/auth.privy.io/**", async (route, request) => {
    const url = request.url();

    // The SDK initialization endpoint — return full app config
    if (url.includes("/init") || url.includes("/apps/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PRIVY_APP_CONFIG),
      });
      return;
    }

    // Session/token endpoints — return empty/no-session
    if (url.includes("/sessions") || url.includes("/token")) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_authenticated" }),
      });
      return;
    }

    // Default — return 200 empty
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  // Privy API — return empty for all
  await page.route("**/api.privy.io/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

/**
 * Mock Login 3.0 token exchange endpoint.
 */
export async function mockLogin3TokenExchange(page: Page) {
  await page.route("**/login3.test.example.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "mock-access-token",
        id_token: buildMockJwt({
          sub: "login3-user-123",
          wallet_address: MOCK_WALLET_ADDRESS,
          email: "test@example.com",
          iss: "https://login3.test.example.com",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
        token_type: "Bearer",
      }),
    });
  });
}
