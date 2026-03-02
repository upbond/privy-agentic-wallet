import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/privy
const mockPoliciesCreate = vi.fn();
const mockWalletsCreate = vi.fn();
const mockWalletsList = vi.fn();
const mockBalanceGet = vi.fn();
const mockSendTransaction = vi.fn();
const mockSignMessage = vi.fn();

vi.mock("@/lib/privy", () => ({
  privy: {
    policies: () => ({ create: mockPoliciesCreate }),
    wallets: () => ({
      create: mockWalletsCreate,
      list: mockWalletsList,
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

import { handleTool } from "@/lib/tools";
import { verifyPayment } from "@/lib/shop";

const mockVerifyPayment = vi.mocked(verifyPayment);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleTool", () => {
  it("create_wallet: creates policy and wallet", async () => {
    mockPoliciesCreate.mockResolvedValueOnce({ id: "policy-1" });
    mockWalletsCreate.mockResolvedValueOnce({
      id: "wallet-1",
      address: "0xNewWallet",
      chain_type: "ethereum",
    });

    const result = await handleTool("create_wallet", {});
    expect(result).toMatchObject({
      id: "wallet-1",
      address: "0xNewWallet",
      policy_id: "policy-1",
    });
    expect(mockPoliciesCreate).toHaveBeenCalled();
    expect(mockWalletsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ policy_ids: ["policy-1"] })
    );
  });

  it("list_wallets: returns list of wallets", async () => {
    mockWalletsList.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield { id: "w1", address: "0x111", chain_type: "ethereum" };
        yield { id: "w2", address: "0x222", chain_type: "ethereum" };
      },
    });

    const result = (await handleTool("list_wallets", {})) as {
      wallets: unknown[];
      count: number;
    };
    expect(result.count).toBe(2);
    expect(result.wallets).toHaveLength(2);
  });

  it("get_balance: returns balance info", async () => {
    mockBalanceGet.mockResolvedValueOnce({
      balances: [
        {
          asset: "eth",
          chain: "base_sepolia",
          raw_value: "1000000000000000",
          display_values: { eth: "0.001" },
        },
      ],
    });

    const result = await handleTool("get_balance", { wallet_id: "w1" });
    expect(result).toMatchObject({ asset: "eth", chain: "base_sepolia" });
  });

  it("send_eth: sends transaction and returns hash", async () => {
    mockSendTransaction.mockResolvedValueOnce({ hash: "0xtxhash" });

    const result = (await handleTool("send_eth", {
      wallet_id: "w1",
      to: "0xRecipient",
      value_eth: 0.0005,
    })) as { hash: string; explorer: string };

    expect(result.hash).toBe("0xtxhash");
    expect(result.explorer).toContain("0xtxhash");
    expect(mockSendTransaction).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({ caip2: "eip155:84532" })
    );
  });

  it("sign_message: returns signature", async () => {
    mockSignMessage.mockResolvedValueOnce({ signature: "0xsig123" });

    const result = (await handleTool("sign_message", {
      wallet_id: "w1",
      message: "Hello",
    })) as { signature: string };

    expect(result.signature).toBe("0xsig123");
    expect(mockSignMessage).toHaveBeenCalledWith("w1", { message: "Hello" });
  });

  it("buy_product: sends payment, verifies, and returns product", async () => {
    mockSendTransaction.mockResolvedValueOnce({ hash: "0xpayhash" });
    mockVerifyPayment.mockResolvedValueOnce({
      valid: true,
      value: BigInt("10000000000000"),
    });

    const result = (await handleTool("buy_product", { wallet_id: "w1" })) as {
      success: boolean;
      product: { product: string };
    };

    expect(result.success).toBe(true);
    expect(result.product.product).toBe("Premium Weather Data");
  });

  it("throws for unknown tool", async () => {
    await expect(handleTool("unknown_tool", {})).rejects.toThrow(
      "Unknown tool: unknown_tool"
    );
  });
});
