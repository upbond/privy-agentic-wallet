/**
 * Server-side Privy JWT verification for API routes.
 * Extracts userId and walletAddress from a Privy access token.
 *
 * Uses server-side user wallets (not embedded wallets) for delegated operations.
 * If the user doesn't have a server wallet yet, one is created automatically.
 */

import { privy } from "./privy";

export interface AuthenticatedUser {
  userId: string;
  walletAddress: string;
  walletId: string;
  accessToken: string;
}

/**
 * Verify Privy access token from Authorization header.
 * Returns userId and server wallet info, or null if invalid.
 */
export async function authenticateRequest(
  authHeader: string | null,
  preferredWalletAddress?: string
): Promise<AuthenticatedUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const accessToken = authHeader.slice(7);

  try {
    const { user_id } = await privy.utils().auth().verifyAccessToken(accessToken);

    // Find the user's wallet — prefer the embedded wallet address from the client
    let wallet: { id: string; address: string } | null = null;
    let fallback: { id: string; address: string } | null = null;

    for await (const w of privy.wallets().list({ user_id, chain_type: "ethereum" })) {
      if (preferredWalletAddress && w.address.toLowerCase() === preferredWalletAddress.toLowerCase()) {
        wallet = { id: w.id, address: w.address };
        break;
      }
      if (!fallback) {
        fallback = { id: w.id, address: w.address };
      }
    }

    // Use preferred wallet if found, otherwise fall back to first wallet
    wallet = wallet ?? fallback;

    // Create a server wallet for the user if none exists
    if (!wallet) {
      console.log("[auth] Creating server wallet for user:", user_id);
      const created = await privy.wallets().create({
        chain_type: "ethereum",
        owner: { user_id },
      });
      wallet = { id: created.id, address: created.address };
      console.log("[auth] Server wallet created:", wallet);
    }

    return {
      userId: user_id,
      walletAddress: wallet.address,
      walletId: wallet.id,
      accessToken,
    };
  } catch (err) {
    console.error("[auth] Authentication failed:", err);
    return null;
  }
}
