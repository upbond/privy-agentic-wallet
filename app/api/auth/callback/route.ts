import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side OIDC callback handler.
 * Exchanges authorization code for tokens using client_secret,
 * then redirects to home with id_token as a query param for client pickup.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const baseUrl = url.origin;

  if (error) {
    const desc = url.searchParams.get("error_description") ?? error;
    console.error("OIDC callback error:", desc);
    return NextResponse.redirect(`${baseUrl}/?error=auth_failed`);
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/?error=no_code`);
  }

  // Read PKCE artifacts from cookies (set by client before redirect)
  const savedState = req.cookies.get("login3_state")?.value;
  const codeVerifier = req.cookies.get("login3_code_verifier")?.value;

  if (!state || !savedState || state !== savedState) {
    console.error("State mismatch — possible CSRF");
    return NextResponse.redirect(`${baseUrl}/?error=state_mismatch`);
  }

  if (!codeVerifier) {
    console.error("No code_verifier cookie found");
    return NextResponse.redirect(`${baseUrl}/?error=no_verifier`);
  }

  // Server-side token exchange with client_secret
  const domain = process.env.NEXT_PUBLIC_LOGIN3_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_LOGIN3_CLIENT_ID;
  const clientSecret = process.env.LOGIN3_CLIENT_SECRET;
  const redirectUri = process.env.NEXT_PUBLIC_LOGIN3_REDIRECT_URI;

  if (!domain || !clientId || !redirectUri) {
    return NextResponse.redirect(`${baseUrl}/?error=server_config`);
  }

  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  };

  if (clientSecret) {
    body.client_secret = clientSecret;
  }

  try {
    const tokenRes = await fetch(`${domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error("Token exchange failed:", text);
      return NextResponse.redirect(`${baseUrl}/?error=token_exchange`);
    }

    const tokens = await tokenRes.json();
    const idToken = tokens.id_token;

    if (!idToken) {
      return NextResponse.redirect(`${baseUrl}/?error=no_id_token`);
    }

    // Redirect to home with token — client will pick it up and store in sessionStorage
    const response = NextResponse.redirect(`${baseUrl}/?login3_token=${encodeURIComponent(idToken)}`);

    // Clear PKCE cookies
    response.cookies.delete("login3_state");
    response.cookies.delete("login3_code_verifier");

    return response;
  } catch (err) {
    console.error("Token exchange error:", err);
    return NextResponse.redirect(`${baseUrl}/?error=token_exchange`);
  }
}
