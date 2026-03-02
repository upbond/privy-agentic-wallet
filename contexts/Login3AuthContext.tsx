"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  buildAuthorizationUrl,
  parseIdToken,
  isTokenExpired,
  SESSION_KEYS,
} from "@/lib/login3";

interface Login3AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  idToken: string | null;
  walletAddress: string | null;
  email: string | null;
  sub: string | null;
  startLogin: () => Promise<void>;
  clearSession: () => void;
}

const Login3AuthContext = createContext<Login3AuthState>({
  isLoading: true,
  isAuthenticated: false,
  idToken: null,
  walletAddress: null,
  email: null,
  sub: null,
  startLogin: async () => {},
  clearSession: () => {},
});

export function useLogin3Auth() {
  return useContext(Login3AuthContext);
}

export function Login3AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);

  // Restore session from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEYS.ID_TOKEN);
    if (stored && !isTokenExpired(stored)) {
      const claims = parseIdToken(stored);
      setIdToken(stored);
      setWalletAddress(claims.wallet_address ?? null);
      setEmail(claims.email ?? null);
      setSub(claims.sub);
    }
    setIsLoading(false);
  }, []);

  const startLogin = useCallback(async () => {
    const { url, codeVerifier, state } = await buildAuthorizationUrl();
    sessionStorage.setItem(SESSION_KEYS.CODE_VERIFIER, codeVerifier);
    sessionStorage.setItem(SESSION_KEYS.STATE, state);
    window.location.href = url;
  }, []);

  const clearSession = useCallback(() => {
    setIdToken(null);
    setWalletAddress(null);
    setEmail(null);
    setSub(null);
    sessionStorage.removeItem(SESSION_KEYS.ID_TOKEN);
    sessionStorage.removeItem(SESSION_KEYS.CODE_VERIFIER);
    sessionStorage.removeItem(SESSION_KEYS.STATE);
  }, []);

  // Called from callback page after token exchange
  const setSession = useCallback((token: string) => {
    const claims = parseIdToken(token);
    setIdToken(token);
    setWalletAddress(claims.wallet_address ?? null);
    setEmail(claims.email ?? null);
    setSub(claims.sub);
    sessionStorage.setItem(SESSION_KEYS.ID_TOKEN, token);
  }, []);

  return (
    <Login3AuthContext.Provider
      value={{
        isLoading,
        isAuthenticated: !!idToken,
        idToken,
        walletAddress,
        email,
        sub,
        startLogin,
        clearSession,
      }}
    >
      {children}
    </Login3AuthContext.Provider>
  );
}

// Exported for use in callback page
export function useSetLogin3Session() {
  const [, setIdToken] = useState<string | null>(null);

  const setSession = useCallback((token: string) => {
    sessionStorage.setItem(SESSION_KEYS.ID_TOKEN, token);
    setIdToken(token);
  }, []);

  return setSession;
}
