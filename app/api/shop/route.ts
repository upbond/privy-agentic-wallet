/**
 * Mock merchant / seller-agent API (x402-style payment gating)
 *
 * GET /api/shop
 *   → 402 Payment Required  (no payment)
 *   → 200 + product data    (X-Payment-Tx header present with valid tx)
 *
 * The real x402 protocol uses EIP-712 signed typed-data in X-PAYMENT header.
 * This demo uses a simplified flow: buyer sends ETH on-chain and provides
 * the tx hash, which the merchant verifies via Base Sepolia RPC.
 */

import { NextRequest, NextResponse } from "next/server";

// Merchant's receiving wallet (demo — can be any address)
const MERCHANT_ADDRESS = "0x557925d2C45793a678F94D4B638251E537Fa6dB8";
const PRICE_WEI = BigInt("10000000000000"); // 0.00001 ETH
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";

async function verifyPayment(txHash: string): Promise<{
  valid: boolean;
  reason?: string;
  value?: bigint;
}> {
  try {
    const res = await fetch(BASE_SEPOLIA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
    });
    const { result } = await res.json();

    if (!result) return { valid: false, reason: "Transaction not found or not yet mined" };
    if (result.status !== "0x1") return { valid: false, reason: "Transaction reverted" };

    // Verify recipient
    const toRes = await fetch(BASE_SEPOLIA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getTransactionByHash",
        params: [txHash],
      }),
    });
    const { result: tx } = await toRes.json();

    if (!tx) return { valid: false, reason: "Transaction details not found" };
    if (tx.to?.toLowerCase() !== MERCHANT_ADDRESS.toLowerCase()) {
      return { valid: false, reason: `Recipient mismatch: expected ${MERCHANT_ADDRESS}` };
    }

    const value = BigInt(tx.value);
    if (value < PRICE_WEI) {
      return {
        valid: false,
        reason: `Insufficient payment: sent ${value} wei, need ${PRICE_WEI} wei`,
      };
    }

    return { valid: true, value };
  } catch {
    return { valid: false, reason: "RPC error verifying transaction" };
  }
}

export async function GET(req: NextRequest) {
  const txHash = req.headers.get("x-payment-tx");

  // No payment provided → 402
  if (!txHash) {
    return NextResponse.json(
      {
        error: "Payment Required",
        payment: {
          protocol: "x402-simplified",
          description: "Premium weather data for Base Sepolia",
          price_eth: "0.00001",
          price_wei: PRICE_WEI.toString(),
          recipient: MERCHANT_ADDRESS,
          chain: "Base Sepolia (84532)",
          instructions:
            "Send exactly 0.0001 ETH to the recipient address on Base Sepolia, then retry with X-Payment-Tx: <txHash>",
        },
      },
      {
        status: 402,
        headers: {
          "X-Payment-Recipient": MERCHANT_ADDRESS,
          "X-Payment-Amount-Wei": PRICE_WEI.toString(),
          "X-Payment-Chain-Id": "84532",
        },
      }
    );
  }

  // Verify the payment on-chain
  const { valid, reason, value } = await verifyPayment(txHash);

  if (!valid) {
    return NextResponse.json(
      { error: "Payment verification failed", reason },
      { status: 402 }
    );
  }

  // Payment verified → deliver product
  return NextResponse.json({
    product: "Premium Weather Data",
    data: {
      location: "Base Sepolia Network",
      temperature: "23°C",
      condition: "Partly Cloudy",
      humidity: "62%",
      wind: "14 km/h NW",
      forecast: ["Sunny", "Rain", "Cloudy", "Sunny", "Thunderstorm"],
      source: "Agent Commerce Demo",
      paid_wei: value?.toString(),
      tx_hash: txHash,
      explorer: `https://sepolia.basescan.org/tx/${txHash}`,
    },
    message: "Payment verified on Base Sepolia. Here is your premium data!",
  });
}
