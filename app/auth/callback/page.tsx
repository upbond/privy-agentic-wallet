"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { exchangeCodeForTokens, SESSION_KEYS } from "@/lib/login3";

export default function AuthCallback() {
  const router = useRouter();
  const processed = useRef(false);

  useEffect(() => {
    // Strict Mode guard: prevent double execution
    if (processed.current) return;
    processed.current = true;

    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const error = params.get("error");

      if (error) {
        console.error("OIDC error:", error, params.get("error_description"));
        router.replace("/?error=auth_failed");
        return;
      }

      if (!code) {
        console.error("No authorization code in callback");
        router.replace("/?error=no_code");
        return;
      }

      // CSRF: verify state (both must exist and match)
      const savedState = sessionStorage.getItem(SESSION_KEYS.STATE);
      if (!state || !savedState || state !== savedState) {
        console.error("State mismatch — possible CSRF");
        router.replace("/?error=state_mismatch");
        return;
      }

      const codeVerifier = sessionStorage.getItem(SESSION_KEYS.CODE_VERIFIER);
      if (!codeVerifier) {
        console.error("No code_verifier found in session");
        router.replace("/?error=no_verifier");
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code, codeVerifier);
        sessionStorage.setItem(SESSION_KEYS.ID_TOKEN, tokens.id_token);

        // Clean up PKCE artifacts
        sessionStorage.removeItem(SESSION_KEYS.CODE_VERIFIER);
        sessionStorage.removeItem(SESSION_KEYS.STATE);

        router.replace("/");
      } catch (err) {
        console.error("Token exchange failed:", err);
        router.replace("/?error=token_exchange");
      }
    }

    handleCallback();
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="flex gap-1 justify-center mb-4">
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
        </div>
        <p className="text-gray-400 text-sm">Completing authentication...</p>
      </div>
    </div>
  );
}
