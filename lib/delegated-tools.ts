import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { AuthorizationContext } from "@privy-io/node";
import { privy } from "./privy";
import { MERCHANT_ADDRESS, PAYMENT_REQUIREMENTS, verifyPayment, buildProduct } from "./shop";
import {
  STRIPE_TOOLS, chargeCustomer, verifyPaymentIntent,
  getDefaultPaymentMethod, STRIPE_PRODUCT, buildStripeProduct,
} from "./stripe";

// Base Sepolia CAIP-2
const BASE_SEPOLIA = "eip155:84532";

// ──────────────────────────────────────────────
// Delegated wallet tool schemas
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
  ...STRIPE_TOOLS,
];

// ──────────────────────────────────────────────
// Delegated tool handlers
// walletAddress, walletId, and authContext are injected by the route after JWT verification
// ──────────────────────────────────────────────

export async function handleDelegatedTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  walletAddress: string,
  walletId: string,
  authContext: AuthorizationContext
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
          authorization_context: authContext,
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
        { message, authorization_context: authContext }
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
          authorization_context: authContext,
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

    case "buy_with_stripe": {
      const { stripe_customer_id } = toolInput as { stripe_customer_id: string };

      const result = await chargeCustomer(
        stripe_customer_id,
        STRIPE_PRODUCT.price_cents,
        `${STRIPE_PRODUCT.name} - Agent Purchase`
      );

      if (!result.success) {
        if ("requires_3ds" in result && result.requires_3ds) {
          return {
            requires_stripe_action: true,
            payment_intent_id: result.payment_intent_id,
            client_secret: result.client_secret,
            message: result.reason,
            instruction:
              "A 3D Secure popup will appear in the chat. Complete the authentication to finish your purchase.",
          };
        }
        return { error: "Payment failed", reason: result.reason };
      }

      return {
        success: true,
        amount_charged: `$${(STRIPE_PRODUCT.price_cents / 100).toFixed(2)} USD`,
        payment_intent_id: result.payment_intent_id,
        product: buildStripeProduct(result.payment_intent_id, STRIPE_PRODUCT.price_cents),
      };
    }

    case "verify_stripe_payment": {
      const { payment_intent_id } = toolInput as { payment_intent_id: string };

      const { success, reason } = await verifyPaymentIntent(payment_intent_id);
      if (!success) {
        return { error: "Payment verification failed", reason };
      }

      return {
        success: true,
        payment_intent_id,
        product: buildStripeProduct(payment_intent_id, STRIPE_PRODUCT.price_cents),
        message: "3D Secure authentication complete. Here is your product!",
      };
    }

    case "stripe_check_setup": {
      const { stripe_customer_id } = toolInput as { stripe_customer_id: string };

      const { valid, card, reason } = await getDefaultPaymentMethod(stripe_customer_id);
      if (!valid || !card) {
        return {
          has_payment_method: false,
          reason,
          action_required: "Click the 'Add Card' button in the chat header to set up your payment method.",
        };
      }

      return {
        has_payment_method: true,
        card: {
          brand: card.brand,
          last4: card.last4,
          exp_month: card.exp_month,
          exp_year: card.exp_year,
        },
        ready_for_autonomous_payment: true,
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
