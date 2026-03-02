"use client";

import { useState, useRef, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { loadStripe } from "@stripe/stripe-js";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface CardSummary {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

const SUGGESTIONS = [
  "Create a new wallet",
  "List my wallets",
  "Buy a product with ETH",
  "Buy the AI report with my card",
];

export default function Chat() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");

  const [balance, setBalance] = useState<string | null>(null);
  const [stripeCustomerId, setStripeCustomerId] = useState<string | null>(null);
  const [stripeCardInfo, setStripeCardInfo] = useState<CardSummary | null>(null);

  // ── Fetch ETH balance ──────────────────────────────────────────────
  useEffect(() => {
    if (!embeddedWallet?.address) return;
    fetch("https://sepolia.base.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [embeddedWallet.address, "latest"],
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const eth = Number(BigInt(data.result)) / 1e18;
        setBalance(eth.toFixed(4));
      })
      .catch(() => setBalance(null));
  }, [embeddedWallet?.address]);

  // ── Stripe customer ID from localStorage + URL redirect ───────────
  async function fetchCardInfo(customerId: string) {
    try {
      const res = await fetch(`/api/stripe/payment-status?customer_id=${customerId}`);
      const data = await res.json();
      if (data.has_payment_method) {
        setStripeCardInfo(data.card_summary);
      } else {
        setStripeCardInfo(null);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setupResult = params.get("stripe_setup");
    const customerId = params.get("customer_id");

    if (setupResult === "success" && customerId) {
      localStorage.setItem("stripe_customer_id", customerId);
      setStripeCustomerId(customerId);
      window.history.replaceState({}, "", "/");
      fetchCardInfo(customerId);
    } else {
      const saved = localStorage.getItem("stripe_customer_id");
      if (saved) {
        setStripeCustomerId(saved);
        fetchCardInfo(saved);
      }
    }
  }, []);

  // ── Add card via Stripe Checkout (setup mode) ─────────────────────
  async function handleAddCard() {
    if (!authenticated || !user?.id) return;
    try {
      const res = await fetch("/api/stripe/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // ignore
    }
  }

  // ── 3DS popup via Stripe.js ────────────────────────────────────────
  async function handle3DS(clientSecret: string, paymentIntentId: string) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "3D Secure authentication is required but NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured. Please add your card without 3DS.",
        },
      ]);
      return;
    }

    const stripeJs = await loadStripe(publishableKey);
    if (!stripeJs) return;

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "Please complete 3D Secure authentication in the popup that appears...",
      },
    ]);

    const { error } = await stripeJs.handleCardAction(clientSecret);

    if (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `3D Secure authentication failed: ${error.message}`,
        },
      ]);
      return;
    }

    // Authentication succeeded — ask agent to verify and deliver product
    await send(
      `3D Secure authentication complete. Please verify payment ${paymentIntentId} and deliver my product.`
    );
  }

  // ── Chat state ────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Privy agentic wallet assistant. I can create wallets, check balances, send ETH, and sign messages on Base Sepolia testnet. I can also buy products with ETH or purchase a premium AI report using your saved credit card. What would you like to do?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || loading) return;

    const userMessage: Message = { role: "user", content: text };
    const updated = [...messages, userMessage];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const apiMessages = updated
        .slice(1)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          stripe_customer_id: stripeCustomerId ?? undefined,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error}` },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.message },
        ]);

        // Handle 3DS if required
        if (
          data.requires_stripe_action &&
          data.stripe_client_secret &&
          data.stripe_payment_intent_id
        ) {
          await handle3DS(data.stripe_client_secret, data.stripe_payment_intent_id);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    send(input);
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
          <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6">
        <div className="w-16 h-16 rounded-full bg-purple-600 flex items-center justify-center text-2xl font-bold">
          P
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-white mb-1">Privy Agentic Wallet</h1>
          <p className="text-gray-400 text-sm">Sign in to manage your wallets on Base Sepolia</p>
        </div>
        <button
          onClick={login}
          className="bg-purple-600 hover:bg-purple-500 text-white rounded-xl px-8 py-3 text-sm font-medium transition-colors"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-sm font-bold shrink-0">
            P
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-white">Privy Agentic Wallet</h1>
            {embeddedWallet ? (
              <p className="text-xs text-gray-400 font-mono">
                {embeddedWallet.address.slice(0, 6)}...{embeddedWallet.address.slice(-4)}
                <span className="ml-2 text-gray-500">·</span>
                <span className="ml-2 text-gray-300">
                  {balance !== null ? `${balance} ETH` : "—"}
                </span>
              </p>
            ) : (
              <p className="text-xs text-gray-400">Base Sepolia Testnet</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-xs bg-green-900/50 text-green-400 px-2 py-1 rounded-full border border-green-800">
              Testnet
            </span>
            {/* Stripe card status */}
            {stripeCardInfo ? (
              <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-1 rounded-full border border-blue-700">
                {stripeCardInfo.brand} ****{stripeCardInfo.last4}
              </span>
            ) : (
              <button
                onClick={handleAddCard}
                className="text-xs bg-blue-900/50 text-blue-300 px-2 py-1 rounded-full border border-blue-700 hover:bg-blue-800/50 transition-colors"
              >
                + Add Card
              </button>
            )}
            <a
              href="https://faucet.quicknode.com/base/sepolia"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-purple-900/50 text-purple-300 px-2 py-1 rounded-full border border-purple-700 hover:bg-purple-800/50 transition-colors"
            >
              Faucet
            </a>
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold mr-2 mt-1 shrink-0">
                P
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === "user"
                  ? "bg-purple-600 text-white rounded-tr-sm"
                  : "bg-gray-800 text-gray-100 rounded-tl-sm"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold mr-2 mt-1 shrink-0">
              P
            </div>
            <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3">
              <span className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length === 1 && (
        <div className="px-6 pb-2 flex gap-2 flex-wrap">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="text-xs border border-gray-700 text-gray-300 rounded-full px-3 py-1.5 hover:border-purple-500 hover:text-purple-300 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-800 px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 text-sm placeholder-gray-500 outline-none focus:ring-2 focus:ring-purple-500 transition"
            placeholder="Create wallet, check balance, buy with ETH or card..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl px-5 py-3 text-sm font-medium transition-colors"
          >
            Send
          </button>
        </form>
        <p className="text-xs text-gray-600 mt-2 text-center">
          Wallets are created on Base Sepolia testnet. No real funds at risk.
        </p>
      </div>
    </div>
  );
}
