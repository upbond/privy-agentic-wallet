"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Fallback page — the OIDC callback now goes to /api/auth/callback (server route).
 * If a user lands here directly, redirect them home.
 */
export default function AuthCallbackFallback() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="flex gap-1 justify-center mb-4">
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
        </div>
        <p className="text-gray-400 text-sm">Redirecting...</p>
      </div>
    </div>
  );
}
