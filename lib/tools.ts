import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { privy } from "./privy";
import { MERCHANT_ADDRESS, PAYMENT_REQUIREMENTS, verifyPayment, buildProduct } from "./shop";
import {
  STRIPE_TOOLS,
  STRIPE_PRODUCT,
  chargeCustomer,
  verifyPaymentIntent,
  getDefaultPaymentMethod,
  buildStripeProduct,
} from "./stripe";

// Base Sepolia CAIP-2
const BASE_SEPOLIA = "eip155:84532";

// ──────────────────────────────────────────────
// Claude tool schema definitions
// ──────────────────────────────────────────────

export const TOOLS: Tool[] = [
  {
    name: "create_wallet",
    description:
      "Create a new Ethereum wallet (Base Sepolia) with a spending-limit policy attached. Returns wallet ID and address.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_wallets",
    description: "List all Ethereum wallets in the Privy app.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_balance",
    description: "Get the ETH balance of a wallet on Base Sepolia.",
    input_schema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description: "The Privy wallet ID",
        },
      },
      required: ["wallet_id"],
    },
  },
  {
    name: "send_eth",
    description:
      "Send ETH on Base Sepolia from a wallet. Max 0.001 ETH per transaction (enforced by policy).",
    input_schema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description: "The Privy wallet ID to send from",
        },
        to: {
          type: "string",
          description: "Recipient Ethereum address (0x...)",
        },
        value_eth: {
          type: "number",
          description: "Amount in ETH to send (max 0.001)",
        },
      },
      required: ["wallet_id", "to", "value_eth"],
    },
  },
  {
    name: "sign_message",
    description: "Sign an arbitrary text message with a wallet.",
    input_schema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description: "The Privy wallet ID",
        },
        message: {
          type: "string",
          description: "The message to sign",
        },
      },
      required: ["wallet_id", "message"],
    },
  },
  ...STRIPE_TOOLS,
  {
    name: "buy_product",
    description:
      "Buy a product from the merchant agent using x402-style payment. " +
      "The agent autonomously: (1) checks what payment is required, " +
      "(2) sends ETH from the wallet to the merchant, " +
      "(3) delivers the payment proof, and (4) receives the product. " +
      "Price is 0.00001 ETH on Base Sepolia.",
    input_schema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description: "The Privy wallet ID to pay from",
        },
      },
      required: ["wallet_id"],
    },
  },
];

// ──────────────────────────────────────────────
// Tool handlers
// ──────────────────────────────────────────────

async function createSpendingPolicy(): Promise<string> {
  // 0.001 ETH = 1_000_000_000_000_000 wei
  const MAX_VALUE = "1000000000000000";

  const policy = await privy.policies().create({
    chain_type: "ethereum",
    name: "Base Sepolia 0.001 ETH limit",
    version: "1.0",
    rules: [
      {
        name: "Max 0.001 ETH on Base Sepolia",
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          {
            field: "value",
            field_source: "ethereum_transaction",
            operator: "lte",
            value: MAX_VALUE,
          },
          {
            field: "chain_id",
            field_source: "ethereum_transaction",
            operator: "eq",
            value: "84532",
          },
        ],
      },
    ],
  });

  return policy.id;
}

export async function handleTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "create_wallet": {
      const policyId = await createSpendingPolicy();
      const wallet = await privy.wallets().create({
        chain_type: "ethereum",
        policy_ids: [policyId],
      });
      return {
        id: wallet.id,
        address: wallet.address,
        chain_type: wallet.chain_type,
        policy_id: policyId,
        note: "Wallet created with 0.001 ETH/tx spending limit on Base Sepolia",
      };
    }

    case "list_wallets": {
      const wallets = [];
      for await (const wallet of privy.wallets().list({ chain_type: "ethereum" })) {
        wallets.push({
          id: wallet.id,
          address: wallet.address,
          chain_type: wallet.chain_type,
        });
      }
      return { wallets, count: wallets.length };
    }

    case "get_balance": {
      const { wallet_id } = toolInput as { wallet_id: string };
      const result = await privy
        .wallets()
        .balance.get(wallet_id, { chain: "base_sepolia", asset: "eth" });
      const balance = result.balances[0];
      return balance
        ? {
            asset: balance.asset,
            chain: balance.chain,
            raw_value: balance.raw_value,
            display: balance.display_values,
          }
        : { message: "No balance found" };
    }

    case "send_eth": {
      const { wallet_id, to, value_eth } = toolInput as {
        wallet_id: string;
        to: string;
        value_eth: number;
      };
      // Convert ETH to hex wei
      const weiValue = BigInt(Math.floor(value_eth * 1e18));
      const hexValue = "0x" + weiValue.toString(16);

      const result = await privy.wallets().ethereum().sendTransaction(
        wallet_id,
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
        hash: result.hash,
        explorer: `https://sepolia.basescan.org/tx/${result.hash}`,
      };
    }

    case "sign_message": {
      const { wallet_id, message } = toolInput as {
        wallet_id: string;
        message: string;
      };
      const result = await privy.wallets().ethereum().signMessage(
        wallet_id,
        { message }
      );
      return { signature: result.signature };
    }

    case "buy_product": {
      const { wallet_id } = toolInput as { wallet_id: string };

      // Step 1: Payment requirements (no HTTP call needed)
      const payment = PAYMENT_REQUIREMENTS;

      // Step 2: Pay the merchant autonomously
      const weiValue = BigInt(payment.price_wei);
      const hexValue = "0x" + weiValue.toString(16);
      const payResult = await privy.wallets().ethereum().sendTransaction(
        wallet_id,
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

      // Step 3: Verify payment on-chain and deliver product
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
        paid_eth: payment.price_eth,
        tx_hash: payResult.hash,
        explorer: `https://sepolia.basescan.org/tx/${payResult.hash}`,
        product: buildProduct(payResult.hash, value!),
      };
    }

    case "buy_with_stripe": {
      const { stripe_customer_id } = toolInput as { stripe_customer_id: string };

      // Step 1: Attempt off-session charge (autonomous, no user redirect)
      const result = await chargeCustomer(
        stripe_customer_id,
        STRIPE_PRODUCT.price_cents,
        `${STRIPE_PRODUCT.name} - Agent Purchase`
      );

      if (!result.success) {
        if ("requires_3ds" in result && result.requires_3ds) {
          // Return structured data so route.ts can surface the client_secret to the frontend
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

      // Step 2: Deliver product
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
