import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side token exchange proxy.
 * Adds client_secret (confidential client) so the browser never sees it.
 */
export async function POST(req: NextRequest) {
  const { code, code_verifier, redirect_uri } = (await req.json()) as {
    code: string;
    code_verifier: string;
    redirect_uri: string;
  };

  const domain = process.env.NEXT_PUBLIC_LOGIN3_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_LOGIN3_CLIENT_ID;
  const clientSecret = process.env.LOGIN3_CLIENT_SECRET;

  if (!domain || !clientId) {
    return NextResponse.json(
      { error: "Login 3.0 environment variables not configured" },
      { status: 500 }
    );
  }

  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri,
    client_id: clientId,
    code_verifier,
  };

  if (clientSecret) {
    body.client_secret = clientSecret;
  }

  const res = await fetch(`${domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Token exchange failed (${res.status}): ${text}` },
      { status: res.status }
    );
  }

  const tokens = await res.json();
  return NextResponse.json(tokens);
}
