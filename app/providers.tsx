"use client";

import { PrivyProvider, useSubscribeToJwtAuthWithFlag } from "@privy-io/react-auth";
import { useState, useEffect, useCallback } from "react";
import { Login3AuthProvider, useLogin3Auth } from "@/contexts/Login3AuthContext";

/**
 * Syncs Login 3.0 ID Token → Privy Custom Auth.
 * Must be a child of both Login3AuthProvider and PrivyProvider.
 */
function Login3SyncBridge() {
  const { isAuthenticated, isLoading, idToken } = useLogin3Auth();

  const getExternalJwt = useCallback(async () => {
    if (isAuthenticated && idToken) return idToken;
    return undefined;
  }, [isAuthenticated, idToken]);

  useSubscribeToJwtAuthWithFlag({
    isAuthenticated,
    isLoading,
    getExternalJwt,
  });

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <>{children}</>;

  return (
    <Login3AuthProvider>
      <PrivyProvider
        appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
        config={{
          embeddedWallets: {
            ethereum: {
              createOnLogin: "users-without-wallets",
            },
          },
        }}
      >
        <Login3SyncBridge />
        {children}
      </PrivyProvider>
    </Login3AuthProvider>
  );
}
