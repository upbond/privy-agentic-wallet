import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { privy } from "./privy";
import { MERCHANT_ADDRESS, PAYMENT_REQUIREMENTS, verifyPayment, buildProduct } from "./shop";

// Base Sepolia CAIP-2
const BASE_SEPOLIA = "eip155:84532";

// ──────────────────────────────────────────────
// Delegated wallet tool schemas
// No wallet_id needed — the user's embedded wallet is used automatically
// ──────────────────────────────────────────────

export const DELEGATED_TOOLS: Tool[] = [
  {
    name: "get_balance",
    description: "Get the ETH balance of the user's wallet on Base Sepolia.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "send_eth",
    description:
      "Send ETH on Base Sepolia from the user's wallet. Max 0.001 ETH per transaction (enforced by policy).",
    input_schema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient Ethereum address (0x...)",
        },
        value_eth: {
          type: "number",
          description: "Amount in ETH to send (max 0.001)",
        },
      },
      required: ["to", "value_eth"],
    },
  },
  {
    name: "sign_message",
    description: "Sign an arbitrary text message with the user's wallet.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "The message to sign",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "buy_product",
    description:
      "Buy a product from the merchant agent using x402-style payment. " +
      "The agent autonomously pays from the user's wallet. " +
      "Price is 0.00001 ETH on Base Sepolia.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// ──────────────────────────────────────────────
// Delegated tool handlers
// walletAddress and walletId are injected by the route after JWT verification
// ──────────────────────────────────────────────

export async function handleDelegatedTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  walletAddress: string,
  walletId: string
): Promise<unknown> {
  switch (toolName) {
    case "get_balance": {
      const result = await privy
        .wallets()
        .balance.get(walletId, { chain: "base_sepolia", asset: "eth" });
      const balance = result.balances[0];
      return balance
        ? {
            wallet_address: walletAddress,
            asset: balance.asset,
            chain: balance.chain,
            raw_value: balance.raw_value,
            display: balance.display_values,
          }
        : { wallet_address: walletAddress, message: "No balance found" };
    }

    case "send_eth": {
      const { to, value_eth } = toolInput as {
        to: string;
        value_eth: number;
      };
      const weiValue = BigInt(Math.round(value_eth * 1e18));
      const hexValue = "0x" + weiValue.toString(16);

      const result = await privy.wallets().ethereum().sendTransaction(
        walletId,
        {
          caip2: BASE_SEPOLIA,
          params: {
            transaction: {
              to,
              value: hexValue,
              chain_id: 84532,
            },
          },
        }
      );
      return {
        from: walletAddress,
        hash: result.hash,
        explorer: `https://sepolia.basescan.org/tx/${result.hash}`,
      };
    }

    case "sign_message": {
      const { message } = toolInput as { message: string };
      const result = await privy.wallets().ethereum().signMessage(
        walletId,
        { message }
      );
      return { wallet_address: walletAddress, signature: result.signature };
    }

    case "buy_product": {
      const payment = PAYMENT_REQUIREMENTS;
      const weiValue = BigInt(payment.price_wei);
      const hexValue = "0x" + weiValue.toString(16);

      const payResult = await privy.wallets().ethereum().sendTransaction(
        walletId,
        {
          caip2: BASE_SEPOLIA,
          params: {
            transaction: {
              to: MERCHANT_ADDRESS,
              value: hexValue,
              chain_id: 84532,
            },
          },
        }
      );

      const { valid, reason, value } = await verifyPayment(payResult.hash);

      if (!valid) {
        return {
          error: "Payment sent but verification failed",
          tx_hash: payResult.hash,
          reason,
          note: "The tx may need a few seconds to be mined. Try again shortly.",
        };
      }

      return {
        success: true,
        from: walletAddress,
        paid_eth: payment.price_eth,
        tx_hash: payResult.hash,
        explorer: `https://sepolia.basescan.org/tx/${payResult.hash}`,
        product: buildProduct(payResult.hash, value!),
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
