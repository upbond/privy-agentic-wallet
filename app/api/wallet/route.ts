import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";

/**
 * GET /api/wallet — returns the authenticated user's server wallet info
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const user = await authenticateRequest(authHeader);

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    walletAddress: user.walletAddress,
    walletId: user.walletId,
  });
}
