import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/privy
const mockBalanceGet = vi.fn();
const mockSendTransaction = vi.fn();
const mockSignMessage = vi.fn();

vi.mock("@/lib/privy", () => ({
  privy: {
    wallets: () => ({
      balance: { get: mockBalanceGet },
      ethereum: () => ({
        sendTransaction: mockSendTransaction,
        signMessage: mockSignMessage,
      }),
    }),
  },
}));

// Mock @/lib/shop for buy_product
vi.mock("@/lib/shop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shop")>();
  return {
    ...actual,
    verifyPayment: vi.fn(),
  };
});

// Mock @/lib/stripe for Stripe tools
vi.mock("@/lib/stripe", () => ({
  STRIPE_TOOLS: [],
  STRIPE_PRODUCT: { name: "Test Report", price_cents: 100, currency: "usd" },
  chargeCustomer: vi.fn(),
  verifyPaymentIntent: vi.fn(),
  getDefaultPaymentMethod: vi.fn(),
  buildStripeProduct: vi.fn(() => ({ product: "Test Report" })),
}));

import { handleDelegatedTool } from "@/lib/delegated-tools";
import { verifyPayment } from "@/lib/shop";
import { chargeCustomer, verifyPaymentIntent, getDefaultPaymentMethod, buildStripeProduct } from "@/lib/stripe";

const mockVerifyPayment = vi.mocked(verifyPayment);
const mockChargeCustomer = vi.mocked(chargeCustomer);
const mockVerifyPaymentIntent = vi.mocked(verifyPaymentIntent);
const mockGetDefaultPaymentMethod = vi.mocked(getDefaultPaymentMethod);
const mockBuildStripeProduct = vi.mocked(buildStripeProduct);

const WALLET_ADDRESS = "0xUserWallet123";
const WALLET_ID = "user-wallet-id";
const AUTH_CONTEXT = { user_jwts: ["test-jwt"] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleDelegatedTool", () => {
  it("get_balance: returns balance with wallet address", async () => {
    mockBalanceGet.mockResolvedValueOnce({
      balances: [
        {
          asset: "eth",
          chain: "base_sepolia",
          raw_value: "500000000000000",
          display_values: { eth: "0.0005" },
        },
      ],
    });

    const result = (await handleDelegatedTool(
      "get_balance",
      {},
      WALLET_ADDRESS,
      WALLET_ID,
      AUTH_CONTEXT
    )) as { wallet_address: string; asset: string };

    expect(result.wallet_address).toBe(WALLET_ADDRESS);
    expect(result.asset).toBe("eth");
    expect(mockBalanceGet).toHaveBeenCalledWith(WALLET_ID, {
      chain: "base_sepolia",
      asset: "eth",
    });
  });

  it("send_eth: sends from user's wallet and returns from address", async () => {
    mockSendTransaction.mockResolvedValueOnce({ hash: "0xdelegatedtx" });

    const result = (await handleDelegatedTool(
      "send_eth",
      { to: "0xRecipient", value_eth: 0.0003 },
      WALLET_ADDRESS,
      WALLET_ID,
      AUTH_CONTEXT
    )) as { from: string; hash: string };

    expect(result.from).toBe(WALLET_ADDRESS);
    expect(result.hash).toBe("0xdelegatedtx");
    expect(mockSendTransaction).toHaveBeenCalledWith(
      WALLET_ID,
      expect.objectContaining({ caip2: "eip155:84532" })
    );
  });

  it("sign_message: returns signature with wallet address", async () => {
    mockSignMessage.mockResolvedValueOnce({ signature: "0xdelegsig" });

    const result = (await handleDelegatedTool(
      "sign_message",
      { message: "Hello Privy!" },
      WALLET_ADDRESS,
      WALLET_ID,
      AUTH_CONTEXT
    )) as { wallet_address: string; signature: string };

    expect(result.wallet_address).toBe(WALLET_ADDRESS);
    expect(result.signature).toBe("0xdelegsig");
    expect(mockSignMessage).toHaveBeenCalledWith(WALLET_ID, {
      message: "Hello Privy!",
      authorization_context: AUTH_CONTEXT,
    });
  });

  it("buy_product: sends payment and returns product with from address", async () => {
    mockSendTransaction.mockResolvedValueOnce({ hash: "0xbuyhash" });
    mockVerifyPayment.mockResolvedValueOnce({
      valid: true,
      value: BigInt("10000000000000"),
    });

    const result = (await handleDelegatedTool(
      "buy_product",
      {},
      WALLET_ADDRESS,
      WALLET_ID,
      AUTH_CONTEXT
    )) as { success: boolean; from: string; product: { product: string } };

    expect(result.success).toBe(true);
    expect(result.from).toBe(WALLET_ADDRESS);
    expect(result.product.product).toBe("Premium Weather Data");
  });

  it("buy_with_stripe: charge succeeds → returns product", async () => {
    mockChargeCustomer.mockResolvedValueOnce({
      success: true,
      payment_intent_id: "pi_test123",
    });

    const result = (await handleDelegatedTool(
      "buy_with_stripe",
      { stripe_customer_id: "cus_test" },
      WALLET_ADDRESS,
      WALLET_ID,
      AUTH_CONTEXT
    )) as { success: boolean; product: { product: string } };

    expect(result.success).toBe(true);
    expect(result.product.product).toBe("Test Report");
    expect(mockChargeCustomer).toHaveBeenCalledWith("cus_test", 100, "Test Report - Agent Purchase");
    expect(mockBuildStripeProduct).toHaveBeenCalledWith("pi_test123", 100);
  });

  it("buy_with_stripe: 3DS required → returns requires_stripe_action", async () => {
    mockChargeCustomer.mockResolvedValueOnce({
      success: false,
      requires_3ds: true,
      payment_intent_id: "pi_3ds",
      client_secret: "pi_3ds_secret",
      reason: "3D Secure required",
    });

    const result = (await handleDelegatedTool(
      "buy_with_stripe",
      { stripe_customer_id: "cus_test" },
      WALLET_ADDRESS,
      WALLET_ID,
      AUTH_CONTEXT
    )) as { requires_stripe_action: boolean; payment_intent_id: string; client_secret: string };

    expect(result.requires_stripe_action).toBe(true);
    expect(result.payment_intent_id).toBe("pi_3ds");
    expect(result.client_secret).toBe("pi_3ds_secret");
  });

  it("verify_stripe_payment: verification succeeds → returns product", async () => {
    mockVerifyPaymentIntent.mockResolvedValueOnce({ success: true });

    const result = (await handleDelegatedTool(
      "verify_stripe_payment",
      { payment_intent_id: "pi_verified" },
      WALLET_ADDRESS,
      WALLET_ID,
      AUTH_CONTEXT
    )) as { success: boolean; product: { product: string } };

    expect(result.success).toBe(true);
    expect(result.product.product).toBe("Test Report");
    expect(mockVerifyPaymentIntent).toHaveBeenCalledWith("pi_verified");
    expect(mockBuildStripeProduct).toHaveBeenCalledWith("pi_verified", 100);
  });

  it("stripe_check_setup: card exists → returns card details", async () => {
    mockGetDefaultPaymentMethod.mockResolvedValueOnce({
      valid: true,
      payment_method_id: "pm_test",
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2027 } as never,
    });

    const result = (await handleDelegatedTool(
      "stripe_check_setup",
      { stripe_customer_id: "cus_test" },
      WALLET_ADDRESS,
      WALLET_ID,
      AUTH_CONTEXT
    )) as { has_payment_method: boolean; card: { brand: string; last4: string }; ready_for_autonomous_payment: boolean };

    expect(result.has_payment_method).toBe(true);
    expect(result.card.brand).toBe("visa");
    expect(result.card.last4).toBe("4242");
    expect(result.ready_for_autonomous_payment).toBe(true);
    expect(mockGetDefaultPaymentMethod).toHaveBeenCalledWith("cus_test");
  });

  it("throws for unknown tool", async () => {
    await expect(
      handleDelegatedTool("unknown_tool", {}, WALLET_ADDRESS, WALLET_ID, AUTH_CONTEXT)
    ).rejects.toThrow("Unknown tool: unknown_tool");
  });
});
