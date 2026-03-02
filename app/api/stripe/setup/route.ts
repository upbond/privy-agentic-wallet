import { NextRequest, NextResponse } from "next/server";
import { createSetupSession } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { user_id } = (await req.json()) as { user_id: string };

    if (!user_id) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const origin = req.headers.get("origin") ?? "http://localhost:3000";
    const checkoutUrl = await createSetupSession(user_id, `${origin}/`);

    return NextResponse.json({ url: checkoutUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create setup session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
