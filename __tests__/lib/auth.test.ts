import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @privy-io/node
vi.mock("@privy-io/node", () => ({
  verifyAccessToken: vi.fn(),
}));

// Mock @/lib/privy
vi.mock("@/lib/privy", () => {
  const mockUsersGet = vi.fn();
  const mockWalletsList = vi.fn();
  return {
    privy: {
      users: () => ({ _get: mockUsersGet }),
      wallets: () => ({
        list: mockWalletsList,
      }),
    },
    __mockUsersGet: mockUsersGet,
    __mockWalletsList: mockWalletsList,
  };
});

import { authenticateRequest } from "@/lib/auth";
import { verifyAccessToken } from "@privy-io/node";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __mockUsersGet: mockUsersGet, __mockWalletsList: mockWalletsList } = await import("@/lib/privy") as any;

const mockVerify = vi.mocked(verifyAccessToken);

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
    mockVerify.mockRejectedValueOnce(new Error("Invalid token"));
    const result = await authenticateRequest("Bearer invalid-token");
    expect(result).toBeNull();
  });

  it("returns null for user without embedded wallet", async () => {
    mockVerify.mockResolvedValueOnce({ user_id: "did:privy:user1" } as never);
    mockUsersGet.mockResolvedValueOnce({
      linked_accounts: [
        { type: "email", address: "user@test.com" },
      ],
    });

    const result = await authenticateRequest("Bearer valid-token");
    expect(result).toBeNull();
  });

  it("returns auth user with wallet ID from linked_accounts", async () => {
    mockVerify.mockResolvedValueOnce({ user_id: "did:privy:user1" } as never);
    mockUsersGet.mockResolvedValueOnce({
      linked_accounts: [
        {
          type: "wallet",
          wallet_client_type: "privy",
          address: "0xAbC123",
          id: "wallet-id-1",
        },
      ],
    });

    const result = await authenticateRequest("Bearer valid-token");
    expect(result).toEqual({
      userId: "did:privy:user1",
      walletAddress: "0xAbC123",
      walletId: "wallet-id-1",
    });
  });

  it("resolves wallet ID via wallets().list() fallback", async () => {
    mockVerify.mockResolvedValueOnce({ user_id: "did:privy:user2" } as never);
    mockUsersGet.mockResolvedValueOnce({
      linked_accounts: [
        {
          type: "wallet",
          wallet_client_type: "privy",
          address: "0xDef456",
          // no id field
        },
      ],
    });

    // Async iterable mock for wallets().list()
    mockWalletsList.mockReturnValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield { address: "0xOther", id: "other-id" };
        yield { address: "0xdef456", id: "wallet-id-2" }; // lowercase match
      },
    });

    const result = await authenticateRequest("Bearer valid-token");
    expect(result).toEqual({
      userId: "did:privy:user2",
      walletAddress: "0xDef456",
      walletId: "wallet-id-2",
    });
  });
});
