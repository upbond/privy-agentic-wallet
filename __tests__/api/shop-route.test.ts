import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/shop
vi.mock("@/lib/shop", () => ({
  MERCHANT_ADDRESS: "0x557925d2C45793a678F94D4B638251E537Fa6dB8",
  PRICE_WEI: BigInt("10000000000000"),
  PAYMENT_REQUIREMENTS: {
    protocol: "x402-simplified",
    description: "Premium weather data for Base Sepolia",
    price_eth: "0.00001",
  },
  verifyPayment: vi.fn(),
  buildProduct: vi.fn(),
}));

import { GET } from "@/app/api/shop/route";
import { verifyPayment, buildProduct } from "@/lib/shop";
import { NextRequest } from "next/server";

const mockVerifyPayment = vi.mocked(verifyPayment);
const mockBuildProduct = vi.mocked(buildProduct);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/shop", () => {
  it("returns 402 without X-Payment-Tx header", async () => {
    const req = new NextRequest("http://localhost:3000/api/shop", {
      method: "GET",
    });

    const res = await GET(req);
    expect(res.status).toBe(402);

    const data = await res.json();
    expect(data.error).toBe("Payment Required");
    expect(data.payment).toBeDefined();

    expect(res.headers.get("X-Payment-Recipient")).toBe(
      "0x557925d2C45793a678F94D4B638251E537Fa6dB8"
    );
    expect(res.headers.get("X-Payment-Chain-Id")).toBe("84532");
  });

  it("returns 200 with valid tx hash", async () => {
    mockVerifyPayment.mockResolvedValueOnce({
      valid: true,
      value: BigInt("10000000000000"),
    });
    mockBuildProduct.mockReturnValueOnce({
      product: "Premium Weather Data",
      data: { temperature: "23°C" },
      message: "Payment verified!",
    } as ReturnType<typeof buildProduct>);

    const req = new NextRequest("http://localhost:3000/api/shop", {
      method: "GET",
      headers: { "X-Payment-Tx": "0xvalidtxhash" },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.product).toBe("Premium Weather Data");
  });

  it("returns 402 with invalid tx hash", async () => {
    mockVerifyPayment.mockResolvedValueOnce({
      valid: false,
      reason: "Transaction reverted",
    });

    const req = new NextRequest("http://localhost:3000/api/shop", {
      method: "GET",
      headers: { "X-Payment-Tx": "0xinvalidtx" },
    });

    const res = await GET(req);
    expect(res.status).toBe(402);

    const data = await res.json();
    expect(data.error).toBe("Payment verification failed");
    expect(data.reason).toContain("reverted");
  });
});
