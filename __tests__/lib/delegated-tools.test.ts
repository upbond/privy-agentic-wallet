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

import { handleDelegatedTool } from "@/lib/delegated-tools";
import { verifyPayment } from "@/lib/shop";

const mockVerifyPayment = vi.mocked(verifyPayment);

const WALLET_ADDRESS = "0xUserWallet123";
const WALLET_ID = "user-wallet-id";

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
      WALLET_ID
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
      WALLET_ID
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
      WALLET_ID
    )) as { wallet_address: string; signature: string };

    expect(result.wallet_address).toBe(WALLET_ADDRESS);
    expect(result.signature).toBe("0xdelegsig");
    expect(mockSignMessage).toHaveBeenCalledWith(WALLET_ID, {
      message: "Hello Privy!",
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
      WALLET_ID
    )) as { success: boolean; from: string; product: { product: string } };

    expect(result.success).toBe(true);
    expect(result.from).toBe(WALLET_ADDRESS);
    expect(result.product.product).toBe("Premium Weather Data");
  });

  it("throws for unknown tool", async () => {
    await expect(
      handleDelegatedTool("unknown_tool", {}, WALLET_ADDRESS, WALLET_ID)
    ).rejects.toThrow("Unknown tool: unknown_tool");
  });
});
