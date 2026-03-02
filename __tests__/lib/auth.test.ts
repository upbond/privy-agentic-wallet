import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/privy
const mockVerifyAccessToken = vi.fn();
const mockWalletsList = vi.fn();
const mockWalletsCreate = vi.fn();

vi.mock("@/lib/privy", () => ({
  privy: {
    utils: () => ({
      auth: () => ({
        verifyAccessToken: mockVerifyAccessToken,
      }),
    }),
    wallets: () => ({
      list: mockWalletsList,
      create: mockWalletsCreate,
    }),
  },
}));

import { authenticateRequest } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authenticateRequest", () => {
  it("returns null for missing auth header", async () => {
    const result = await authenticateRequest(null);
    expect(result).toBeNull();
  });

  it("returns null for non-Bearer header", async () => {
    const result = await authenticateRequest("Basic abc123");
    expect(result).toBeNull();
  });

  it("returns null for invalid JWT", async () => {
    mockVerifyAccessToken.mockRejectedValueOnce(new Error("Invalid token"));
    const result = await authenticateRequest("Bearer invalid-token");
    expect(result).toBeNull();
  });

  it("returns user with existing server wallet from wallets().list()", async () => {
    mockVerifyAccessToken.mockResolvedValueOnce({ user_id: "did:privy:user1" });

    // wallets().list() returns async iterable with one wallet
    mockWalletsList.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield { id: "wallet-id-1", address: "0xAbC123" };
      },
    });

    const result = await authenticateRequest("Bearer valid-token");
    expect(result).toEqual({
      userId: "did:privy:user1",
      walletAddress: "0xAbC123",
      walletId: "wallet-id-1",
      accessToken: "valid-token",
    });
    expect(mockWalletsList).toHaveBeenCalledWith({
      user_id: "did:privy:user1",
      chain_type: "ethereum",
    });
  });

  it("creates server wallet when none exists", async () => {
    mockVerifyAccessToken.mockResolvedValueOnce({ user_id: "did:privy:user2" });

    // wallets().list() returns empty async iterable
    mockWalletsList.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        // no wallets
      },
    });

    mockWalletsCreate.mockResolvedValueOnce({
      id: "new-wallet-id",
      address: "0xNewWallet",
    });

    const result = await authenticateRequest("Bearer new-user-token");
    expect(result).toEqual({
      userId: "did:privy:user2",
      walletAddress: "0xNewWallet",
      walletId: "new-wallet-id",
      accessToken: "new-user-token",
    });
    expect(mockWalletsCreate).toHaveBeenCalledWith({
      chain_type: "ethereum",
      owner: { user_id: "did:privy:user2" },
    });
  });
});
