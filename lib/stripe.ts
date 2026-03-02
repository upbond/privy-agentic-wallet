import Stripe from "stripe";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY environment variable");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});

// ──────────────────────────────────────────────
// Product catalog (analogous to lib/shop.ts)
// ──────────────────────────────────────────────

export const STRIPE_PRODUCT = {
  name: "Premium AI Market Report",
  description: "AI-generated market analysis with real-time insights",
  price_cents: 100, // $1.00 USD
  currency: "usd",
};

// ──────────────────────────────────────────────
// Anthropic-format tool definitions
// (replaces @stripe/agent-toolkit/openai adapter pattern)
// ──────────────────────────────────────────────

export const STRIPE_TOOLS: Tool[] = [
  {
    name: "buy_with_stripe",
    description:
      "Buy a premium AI market report using the user's saved Stripe payment method. " +
      "The agent autonomously: (1) verifies saved card exists, " +
      "(2) charges the card off-session without user redirect, " +
      "(3) delivers the product. " +
      "If 3D Secure authentication is required, returns a client_secret for popup confirmation. " +
      "Price is $1.00 USD.",
    input_schema: {
      type: "object" as const,
      properties: {
        stripe_customer_id: {
          type: "string",
          description: "Stripe Customer ID (cus_...) from the user's saved card setup",
        },
      },
      required: ["stripe_customer_id"],
    },
  },
  {
    name: "verify_stripe_payment",
    description:
      "Verify a Stripe payment after the user completed 3D Secure authentication in a popup. " +
      "Call this after the user confirms their 3DS popup to deliver the purchased product.",
    input_schema: {
      type: "object" as const,
      properties: {
        payment_intent_id: {
          type: "string",
          description: "Stripe PaymentIntent ID (pi_...) to verify",
        },
      },
      required: ["payment_intent_id"],
    },
  },
  {
    name: "stripe_check_setup",
    description:
      "Check if the user has a saved Stripe payment method ready for autonomous payments. " +
      "Returns card details if set up, or instructions to set up if not.",
    input_schema: {
      type: "object" as const,
      properties: {
        stripe_customer_id: {
          type: "string",
          description: "Stripe Customer ID (cus_...) to check",
        },
      },
      required: ["stripe_customer_id"],
    },
  },
];

// ──────────────────────────────────────────────
// Customer & payment method helpers
// ──────────────────────────────────────────────

export async function findOrCreateCustomer(userId: string): Promise<string> {
  const existing = await stripe.customers.search({
    query: `metadata["app_user_id"]:"${userId}"`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    return existing.data[0].id;
  }

  const customer = await stripe.customers.create({
    metadata: { app_user_id: userId },
  });
  return customer.id;
}

export async function getDefaultPaymentMethod(
  customerId: string
): Promise<{ valid: boolean; payment_method_id?: string; card?: Stripe.PaymentMethod.Card; reason?: string }> {
  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
  });

  if (paymentMethods.data.length === 0) {
    return {
      valid: false,
      reason: "No payment method on file. Please click the 'Add Card' button to set up your card.",
    };
  }

  const pm = paymentMethods.data[0];
  return { valid: true, payment_method_id: pm.id, card: pm.card ?? undefined };
}

// ──────────────────────────────────────────────
// Setup session (one-time card registration)
// ──────────────────────────────────────────────

export async function createSetupSession(userId: string, returnUrl: string): Promise<string> {
  const customerId = await findOrCreateCustomer(userId);

  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    success_url: `${returnUrl}?stripe_setup=success&customer_id=${customerId}`,
    cancel_url: `${returnUrl}?stripe_setup=cancelled`,
  });

  return session.url!;
}

// ──────────────────────────────────────────────
// Off-session charge (autonomous payment core)
// ──────────────────────────────────────────────

export type ChargeResult =
  | { success: true; payment_intent_id: string }
  | { success: false; requires_3ds: true; payment_intent_id: string; client_secret: string; reason: string }
  | { success: false; requires_3ds?: false; reason: string };

export async function chargeCustomer(
  customerId: string,
  amountCents: number,
  description: string
): Promise<ChargeResult> {
  const { valid, payment_method_id, reason: pmReason } = await getDefaultPaymentMethod(customerId);
  if (!valid || !payment_method_id) {
    return { success: false, reason: pmReason! };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: STRIPE_PRODUCT.currency,
      customer: customerId,
      payment_method: payment_method_id,
      description,
      confirm: true,
      off_session: true,
    });

    if (paymentIntent.status === "succeeded") {
      return { success: true, payment_intent_id: paymentIntent.id };
    }

    if (paymentIntent.status === "requires_action" && paymentIntent.client_secret) {
      return {
        success: false,
        requires_3ds: true,
        payment_intent_id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        reason: "This card requires 3D Secure authentication. A popup will appear for you to complete.",
      };
    }

    return { success: false, reason: `Payment ended with status: ${paymentIntent.status}` };
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      // 3DS required — off_session confirm throws rather than returning requires_action
      if (
        err.code === "authentication_required" &&
        err.payment_intent?.client_secret
      ) {
        return {
          success: false,
          requires_3ds: true,
          payment_intent_id: err.payment_intent.id,
          client_secret: err.payment_intent.client_secret,
          reason: "This card requires 3D Secure authentication. A popup will appear for you to complete.",
        };
      }
      return { success: false, reason: err.message };
    }
    const message = err instanceof Error ? err.message : "Unknown payment error";
    return { success: false, reason: message };
  }
}

// ──────────────────────────────────────────────
// Verify payment after 3DS popup confirmation
// ──────────────────────────────────────────────

export async function verifyPaymentIntent(
  paymentIntentId: string
): Promise<{ success: boolean; reason?: string }> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (pi.status === "succeeded") return { success: true };

  return {
    success: false,
    reason: `Payment status is "${pi.status}". Authentication may not be complete yet.`,
  };
}

// ──────────────────────────────────────────────
// Product builder (analogous to lib/shop.ts buildProduct)
// ──────────────────────────────────────────────

export function buildStripeProduct(paymentIntentId: string, amountCents: number) {
  return {
    product: STRIPE_PRODUCT.name,
    data: {
      report_id: `RPT-${paymentIntentId.slice(-8).toUpperCase()}`,
      title: "AI Market Analysis Report",
      executive_summary: "Strong bullish momentum detected across tech and DeFi sectors.",
      key_findings: [
        "AI infrastructure spending up 42% YoY",
        "Base ecosystem TVL growing at record pace",
        "Consumer sentiment index at 6-month high",
        "Stablecoin transfer volumes exceeded $1T this quarter",
      ],
      generated_at: new Date().toISOString(),
      payment_intent_id: paymentIntentId,
      amount_charged: `$${(amountCents / 100).toFixed(2)} USD`,
    },
  };
}
