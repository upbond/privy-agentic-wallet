# Login 3.0 × Privy ハンズオン統合テストレポート

> Issue #4 Phase 4: 評価レポート

**バージョン:** 1.0
**作成日:** 2026-03-03
**対象リポジトリ:** upbond/privy-agentic-wallet

---

## 1. エグゼクティブサマリー

Login 3.0（UPBOND自社OIDC基盤）と Privy の Custom Auth + サーバーウォレットを統合し、Claude AIエージェントが自律的にウォレット操作を実行するアプリケーションのハンズオン検証を完了した。

**結論: 統合は成功。** Login 3.0 の ID Token を Privy Custom Auth に渡す連携は安定して動作し、サーバーウォレットによるエージェント委任モデルは実用段階にある。

```
実現したフロー:
  Login 3.0 PKCE認証 → ID Token取得 → Privy Custom Auth同期
  → サーバーウォレット自動作成 → Claude Agent が自律操作
  → ETH残高確認 / 送金 / 署名 / 商品購入 / Stripe決済
```

---

## 2. テストフェーズ結果

| Phase | 内容 | 結果 | 関連Issue |
|-------|------|------|-----------|
| Phase 0 | 前提確認（JWKS, Dashboard設定） | **PASS** | #1 |
| Phase 1 | Login 3.0 ID Token取得 | **PASS** | — |
| Phase 2 | Privy Custom Auth 統合 | **PASS** | #2 |
| Phase 3 | Agent Wallet E2E | **PASS** | #3 |
| Phase 4 | 評価レポート作成 | 本ドキュメント | #4 |

### Phase 0: 前提確認

| 項目 | 結果 |
|------|------|
| Login 3.0 dev環境 JWKS エンドポイント稼働 | PASS — `auth-wallet-mpc.dev.upbond.io/.well-known/jwks.json` が正常応答 |
| JWKS 署名アルゴリズム | PASS — ES256 |
| Privy Dashboard Custom Auth 有効化 | PASS — Login 3.0 の JWKS URL を登録、検証成功 |
| Enterprise プラン要否 | **不要** — Free プランで Custom Auth + Embedded Wallet 利用可能 |

### Phase 1: ID Token取得

| 項目 | 結果 |
|------|------|
| PKCE Authorization Code Flow 実行 | PASS |
| ID Token クレーム確認 | PASS — `sub`, `wallet_address`, `email`, `iss`, `iat`, `exp` を確認 |
| JWKS による署名検証 | PASS — Privy 側で自動検証 |

### Phase 2: Privy Custom Auth 統合

| 項目 | 結果 |
|------|------|
| `useSubscribeToJwtAuthWithFlag` で ID Token 連携 | PASS |
| Privy が JWKS で署名検証に成功 | PASS |
| Embedded Wallet 自動作成 | PASS（ただし後述の通りサーバーウォレットに移行） |
| ウォレットアドレスが UI に表示 | PASS |

### Phase 3: Agent Wallet E2E

| 項目 | 結果 |
|------|------|
| 一気通貫フロー（認証→ウォレット→Agent Chat） | PASS |
| Agent が ETH 残高確認 | PASS |
| Agent がメッセージ署名 | PASS — `sign_message: "Hello Privy!"` で動作確認 |
| Agent が ETH 送金 | PASS — ポリシー（0.001 ETH上限）で制御 |
| Agent が商品購入（ETH） | PASS — x402スタイル決済 |
| Agent が Stripe 決済 | PASS — オフセッション決済 + 3DS対応 |

---

## 3. アーキテクチャ

### 3.1 全体構成

```
┌─────────────────────────┐     ┌──────────────────────────────────────┐
│  Login 3.0 (dev環境)     │     │  privy-agentic-wallet (Next.js 15)   │
│  auth-wallet-mpc        │     │                                      │
│  .dev.upbond.io         │     │  ┌─Login3AuthProvider──────────────┐  │
│                         │     │  │ PKCE認可 → server callback      │  │
│  /.well-known/jwks.json │◄────│  │ → ID Token取得 → sessionStorage │  │
│  /oauth/token           │     │  └────────────┬─────────────────────┘  │
│  /authorize             │     │               │ ID Token               │
│                         │     │               ▼                        │
│                         │     │  ┌─PrivyProvider──────────────────┐  │
│                         │     │  │ useSubscribeToJwtAuthWithFlag  │  │
│                         │     │  │ → JWKS検証 → Privy認証確立     │  │
│                         │     │  └────────────┬─────────────────────┘  │
│                         │     │               │ Privy Access Token      │
│                         │     │               ▼                        │
│                         │     │  ┌─/api/agent─────────────────────┐  │
│                         │     │  │ JWT検証 → Server Wallet取得    │  │
│                         │     │  │ → Claude Haiku Tool Use Loop   │  │
│                         │     │  │ → Delegated Tool実行           │  │
│                         │     │  └──────────────────────────────────┘  │
└─────────────────────────┘     └──────────────────────────────────────┘
```

### 3.2 認証フロー詳細

```
1. ユーザーが「Sign In with Login 3.0」をクリック
2. Client: PKCE code_verifier + code_challenge (SHA-256) を生成
3. Client: code_verifier, state を Cookie に保存 (max-age=600s, SameSite=Lax)
4. ブラウザ → Login 3.0 /authorize にリダイレクト
5. ユーザーが Login 3.0 で認証（メール/パスキー/ソーシャル）
6. Login 3.0 → /api/auth/callback?code=...&state=... にリダイレクト
7. Server: state 検証 (CSRF防止)、Cookie から code_verifier を取得
8. Server: client_secret + code_verifier で /oauth/token にPOST
9. Server: ID Token を取得、/?login3_token=... にリダイレクト
10. Client: URL から ID Token を取得 → sessionStorage に保存
11. Login3SyncBridge: useSubscribeToJwtAuthWithFlag で Privy に同期
12. Privy: JWKS で ID Token を検証 → 認証確立
```

**セキュリティ特性:**
- PKCE (S256) によるコード横取り攻撃防止
- state パラメータによる CSRF 防止
- client_secret はサーバーサイドのみ（ブラウザに露出しない）
- Confidential Client パターン

### 3.3 ウォレットアーキテクチャ: Embedded → Server Wallet への移行

当初は Embedded Wallet + Delegated Signer を想定していたが、検証中に以下の問題を発見し、**サーバーウォレット**に移行した。

**問題: Embedded Wallet はサーバーSDK v2から操作不可**

```
Privy Server SDK v2 (privy.wallets()) は「サーバーウォレット」のみ管理する。
Embedded Wallet は id: null を返し、サーバーサイドで sendTransaction/signMessage に使えない。
privy.wallets().list({ user_id }) は Embedded Wallet を返さない。
```

**解決: サーバーウォレット (owner: { user_id }) を採用**

```typescript
// lib/auth.ts — find-or-create パターン
const { user_id } = await privy.utils().auth().verifyAccessToken(accessToken);

let wallet = null;
for await (const w of privy.wallets().list({ user_id, chain_type: "ethereum" })) {
  wallet = { id: w.id, address: w.address };
  break;
}
if (!wallet) {
  const created = await privy.wallets().create({ chain_type: "ethereum", owner: { user_id } });
  wallet = { id: created.id, address: created.address };
}
```

| 観点 | Embedded Wallet | Server Wallet (採用) |
|------|----------------|---------------------|
| 鍵の保管 | Privy MPC (クライアント側シャード) | Privy MPC (サーバー側) |
| サーバーSDKでの操作 | 不可（id: null） | 可能 |
| エクスポート | 可能（リカバリーフレーズ） | 不可 |
| Authorization | 不要（クライアント側） | user_jwts が必要 |
| Agent自律操作 | 毎回ユーザー承認が必要 | ポリシー範囲内で自律可能 |

---

## 4. SDK評価

### 4.1 使用バージョン

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| `@privy-io/react-auth` | ^3.15.0 | Client: Custom Auth同期、Embedded Wallet UI |
| `@privy-io/node` | latest | Server: JWT検証、ウォレット作成・操作 |
| `@anthropic-ai/sdk` | latest | Claude Haiku API (tool use) |
| `next` | ^15.2.3 | App Router、API Routes |
| `stripe` | ^20.4.0 | Server: PaymentIntent、オフセッション決済 |
| `@stripe/stripe-js` | ^8.8.0 | Client: 3DS認証ポップアップ |

### 4.2 Privy SDK 評価

**DX（開発体験）: 良好**

| 項目 | 評価 | コメント |
|------|------|---------|
| Custom Auth 設定 | ★★★★☆ | Dashboard で JWKS URL を登録するだけ。簡単。 |
| `useSubscribeToJwtAuthWithFlag` | ★★★★★ | 外部 JWT を Privy に渡す最もクリーンな方法 |
| Server SDK v2 ウォレット操作 | ★★★☆☆ | API 自体は明快だが、Embedded vs Server の違いが未文書化 |
| JWT 検証 (`privy.utils().auth()`) | ★★★★★ | JWKS を内部でフェッチ・キャッシュ。自前実装不要 |
| `authorization_context` | ★★★☆☆ | 必要性がドキュメントから読み取りにくい |
| エラーメッセージ | ★★☆☆☆ | `id: null` や `No valid authorization keys` は原因特定が困難 |

**発見したハマりどころ:**

1. **`verifyAccessToken` の2つの実装**
   - `importFromPrivy('jose')` 経由のスタンドアロン版は SPKI 形式の公開鍵が必要
   - `privy.utils().auth().verifyAccessToken()` は内蔵 JWKS キャッシュを使う（推奨）
   - ドキュメントでの区別が不明確

2. **Embedded Wallet の `id: null` 問題**
   - `privy.users()._get(userId)` の `linked_accounts` で Embedded Wallet は `id: null` を返す
   - サーバーSDKからは操作不可だが、エラーメッセージが不親切

3. **`authorization_context` の必須性**
   - サーバーウォレットの `sendTransaction` / `signMessage` はユーザー JWT が必要
   - `balance.get()` は不要、という非対称性がある
   - `{ user_jwts: [accessToken] }` の形式はAPIリファレンスに埋もれている

### 4.3 ドキュメント品質

| 項目 | 評価 |
|------|------|
| Custom Auth 設定ガイド | ★★★★☆ — Dashboard スクリーンショット付きで分かりやすい |
| Server SDK v2 リファレンス | ★★★☆☆ — API 一覧はあるが、Embedded vs Server の使い分けが不十分 |
| Delegated Actions ガイド | ★★★★☆ — React Hook の使い方は明快 |
| Server Wallet + User Owner パターン | ★★☆☆☆ — ユースケース例が少ない |
| エラーハンドリング | ★★☆☆☆ — エラーコード一覧がない |

---

## 5. 判定基準への回答

| 項目 | PASS条件 | 結果 |
|------|----------|------|
| JWKS 検証 | Privy が Login 3.0 の JWKS で署名検証に成功 | **PASS** |
| Embedded Wallet | Custom Auth ログイン後にウォレットが自動作成 | **PASS**（Embedded は作成されるが、Server Wallet を採用） |
| Agent Chat | 認証済みユーザーが Agent 経由で tx 実行可能 | **PASS** — 署名・送金を実機確認 |
| 再ログイン | 同じ Login 3.0 ユーザーが同じ Privy ウォレットに紐づく | **PASS** — `user_id` ベースで同一ウォレットを返却 |
| Enterprise 制約 | Free プランで全機能利用可能 | **PASS** — Enterprise 不要 |

---

## 6. テストカバレッジ

### 6.1 自動テスト

| スイート | ファイル数 | テスト数 | 結果 |
|---------|----------|---------|------|
| Unit (Vitest) | 7 | 47 | 全 PASS |
| E2E (Playwright) | 2 | 定義済み | 環境依存（Login 3.0 dev環境が必要） |

**Unit テスト内訳:**

| ファイル | 内容 | テスト数 |
|---------|------|---------|
| `lib/login3.test.ts` | PKCE生成、JWT解析、有効期限チェック | 6 |
| `lib/auth.test.ts` | JWT検証、ウォレット作成/検索 | 5 |
| `lib/tools.test.ts` | Tool handlers (wallet + stripe) | 10 |
| `lib/delegated-tools.test.ts` | Delegated tool handlers + auth context | 13 |
| `lib/shop.test.ts` | x402決済検証、商品ビルド | 5 |
| `lib/stripe.test.ts` | Stripe決済、3DS、カード確認 | 5 |
| `api/agent-route.test.ts` | Agent APIルート、JWT認証 | 3 |

### 6.2 手動QA

| テスト | 手順 | 結果 |
|--------|------|------|
| ログイン→残高確認 | Sign In → "Check my balance" | PASS |
| メッセージ署名 | "Sign the message: Hello Privy!" | PASS |
| ログアウト→再ログイン | Sign Out → Sign In → 同じウォレット | PASS |
| 未認証リクエスト拒否 | Authorization ヘッダーなしで /api/agent にPOST | PASS (401) |

---

## 7. 発見された制約と改善点

### 7.1 現時点の制約

| # | 制約 | 影響度 | 回避策 |
|---|------|--------|--------|
| 1 | トークンリフレッシュ未実装 | 中 | 期限切れ時は再ログインが必要 |
| 2 | チャット履歴が揮発性（React state のみ） | 低 | リロードで消失。localStorage or DB で永続化可能 |
| 3 | Base Sepolia のみ | 低 | CAIP-2形式採用済み。チェーン追加は最小限の変更 |
| 4 | Stripe 3DS はユーザー操作が必要 | 低 | 完全自律ではないが、設計上妥当 |
| 5 | Embedded Wallet のサーバー操作不可 | — | Server Wallet に移行済み。今後の SDK アップデートで解消の可能性 |

### 7.2 本番化に向けた推奨事項

**優先度: 高**

| 項目 | 理由 | 工数目安 |
|------|------|---------|
| リクエストバリデーション (Zod等) | /api/agent への不正入力対策 | 2-4h |
| レートリミット | Agent API の濫用防止 | 2-4h |
| トークンリフレッシュ | セッション持続性の向上 | 1-2日 |

**優先度: 中**

| 項目 | 理由 | 工数目安 |
|------|------|---------|
| 構造化ログ (Datadog等) | 運用時のデバッグ効率 | 1日 |
| チャット履歴永続化 | UX改善、エージェント監査 | 1-2日 |
| CSP / セキュリティヘッダー | XSS / クリックジャッキング防止 | 半日 |

**優先度: 低**

| 項目 | 理由 | 工数目安 |
|------|------|---------|
| マルチチェーン対応 | Ethereum mainnet, Polygon 等 | 1-2日 |
| 委任取り消しUI | ユーザーが Agent アクセスを撤回 | 1日 |
| トランザクション監査ログ | コンプライアンス対応 | 1-2日 |

---

## 8. Dynamic / CDP との比較観点

本テストは Privy を対象としたが、プロバイダー選定のために以下の観点を整理する。

| 評価軸 | Privy (検証済み) | Dynamic (未検証) | CDP (未検証) |
|--------|-----------------|-----------------|-------------|
| Custom Auth (外部JWT) | `useSubscribeToJwtAuthWithFlag` で対応 | Custom JWT Auth 対応あり | 要調査 |
| サーバーウォレット | `privy.wallets().create({ owner: { user_id } })` | Server Wallets API あり | MPC Wallet API あり |
| Agent 委任 | `authorization_context` で JWT ベース委任 | API Key ベース | 要調査 |
| ポリシー制御 | `privy.policies().create()` で条件付き許可 | Smart Contract ベース | 要調査 |
| 料金 | Free プランで Custom Auth + Wallet 利用可 | 要確認 | 要確認 |
| SDK 品質 | React: ★★★★ / Node: ★★★ | 要検証 | 要検証 |
| ドキュメント | ★★★☆☆ (Server Wallet 周りが弱い) | 要検証 | 要検証 |

**Privy を選択する場合の強み:**
- Login 3.0 との統合が検証済みで、再現可能なコードが存在する
- Free プランで十分な機能が利用可能
- React SDK の DX が良好

**Privy の注意点:**
- Server SDK v2 のドキュメントが Embedded vs Server の区別で混乱しやすい
- `authorization_context` の理解にハマりどころがある
- エラーメッセージの品質に改善余地

---

## 9. 成果物一覧

| 成果物 | パス |
|--------|------|
| アプリケーション本体 | `privy-agentic-wallet/` |
| PRD | `docs/prd-user-owned-agentic-wallet.md` |
| Agentic Payment 分析 | `docs/agentic-payment.md` |
| x402 市場分析 | `docs/x402-market-bottlenecks.md` |
| 本レポート | `docs/login3-privy-integration-test-report.md` |
| Unit テスト (47件) | `__tests__/` |
| E2E テスト | `e2e/` |
| CI/CD | `.github/workflows/ci.yml` |

---

## 10. 結論

Login 3.0 × Privy の統合は**技術的に実現可能**であり、以下を実証した:

1. **認証連携**: Login 3.0 の PKCE フロー → Privy Custom Auth は安定動作
2. **ウォレット管理**: Server Wallet パターンでエージェント委任が実用レベル
3. **自律操作**: Claude Agent が ETH 送金・署名・決済を自律実行可能
4. **ポリシー制御**: 送金上限（0.001 ETH）が Privy レイヤーで強制される
5. **コスト**: Free プランで全機能利用可能。Enterprise 不要

プロバイダー選定において、Privy は Login 3.0 との親和性が高く、最小限の追加コードで統合できることが確認された。
