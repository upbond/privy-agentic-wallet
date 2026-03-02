import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyPayment, buildProduct, MERCHANT_ADDRESS, PRICE_WEI } from "@/lib/shop";

// Mock global fetch (Base Sepolia RPC)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("verifyPayment", () => {
  const TX_HASH = "0xabc123def456";

  it("returns valid for a correct payment", async () => {
    // First call: eth_getTransactionReceipt
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ result: { status: "0x1" } }),
    });
    // Second call: eth_getTransactionByHash
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          result: {
            to: MERCHANT_ADDRESS,
            value: "0x" + PRICE_WEI.toString(16),
          },
        }),
    });

    const result = await verifyPayment(TX_HASH);
    expect(result.valid).toBe(true);
    expect(result.value).toBe(PRICE_WEI);
  });

  it("returns invalid when transaction not found", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ result: null }),
    });

    const result = await verifyPayment(TX_HASH);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not found");
  });

  it("returns invalid when transaction reverted", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ result: { status: "0x0" } }),
    });

    const result = await verifyPayment(TX_HASH);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("reverted");
  });

  it("returns invalid when recipient mismatches", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ result: { status: "0x1" } }),
    });
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          result: {
            to: "0x0000000000000000000000000000000000000000",
            value: "0x" + PRICE_WEI.toString(16),
          },
        }),
    });

    const result = await verifyPayment(TX_HASH);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Recipient mismatch");
  });

  it("returns invalid when value is insufficient", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ result: { status: "0x1" } }),
    });
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          result: {
            to: MERCHANT_ADDRESS,
            value: "0x1", // 1 wei — way too low
          },
        }),
    });

    const result = await verifyPayment(TX_HASH);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Insufficient");
  });

  it("returns invalid on RPC error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await verifyPayment(TX_HASH);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("RPC error");
  });
});

describe("buildProduct", () => {
  it("returns correct product structure", () => {
    const txHash = "0xdef789";
    const value = BigInt("10000000000000");
    const product = buildProduct(txHash, value);

    expect(product.product).toBe("Premium Weather Data");
    expect(product.data.tx_hash).toBe(txHash);
    expect(product.data.paid_wei).toBe(value.toString());
    expect(product.data.explorer).toContain(txHash);
    expect(product.message).toContain("Payment verified");
  });
});
