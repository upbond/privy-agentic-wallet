/**
 * Server-side Privy JWT verification for API routes.
 * Extracts userId and walletAddress from a Privy access token.
 */

import { verifyAccessToken } from "@privy-io/node";
import { privy } from "./privy";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID!;
const PRIVY_VERIFICATION_KEY = process.env.PRIVY_VERIFICATION_KEY;

export interface AuthenticatedUser {
  userId: string;
  walletAddress: string;
  walletId: string;
}

/**
 * Verify Privy access token from Authorization header.
 * Returns userId and embedded wallet address, or null if invalid.
 */
export async function authenticateRequest(
  authHeader: string | null
): Promise<AuthenticatedUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const accessToken = authHeader.slice(7);

  try {
    const { user_id } = await verifyAccessToken({
      access_token: accessToken,
      app_id: PRIVY_APP_ID,
      verification_key: PRIVY_VERIFICATION_KEY ?? `https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/.well-known/jwks.json`,
    });

    // Look up user's embedded wallet
    const user = await privy.users()._get(user_id);
    const embeddedWallet = user.linked_accounts?.find(
      (a: { type: string; wallet_client_type?: string }) =>
        a.type === "wallet" && a.wallet_client_type === "privy"
    ) as { address: string; id?: string } | undefined;

    if (!embeddedWallet?.address) return null;

    // Resolve wallet ID for Privy Server SDK calls
    let walletId = embeddedWallet.id;
    if (!walletId) {
      for await (const w of privy.wallets().list({ chain_type: "ethereum" })) {
        if (w.address.toLowerCase() === embeddedWallet.address.toLowerCase()) {
          walletId = w.id;
          break;
        }
      }
    }
    if (!walletId) return null;

    return { userId: user_id, walletAddress: embeddedWallet.address, walletId };
  } catch {
    return null;
  }
}
