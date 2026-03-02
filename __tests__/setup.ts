// Set dummy env vars for testing — no real credentials needed
process.env.PRIVY_APP_ID = "clxxxxxxxxxxxxxxxxxtestid";
process.env.PRIVY_APP_SECRET = "test-privy-app-secret";
process.env.PRIVY_VERIFICATION_KEY = "test-verification-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_key_for_testing";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_dummy_key_for_testing";
process.env.NEXT_PUBLIC_PRIVY_APP_ID = "clxxxxxxxxxxxxxxxxxtestid";
process.env.NEXT_PUBLIC_LOGIN3_DOMAIN = "https://login3.test.example.com";
process.env.NEXT_PUBLIC_LOGIN3_CLIENT_ID = "test-login3-client-id";
process.env.NEXT_PUBLIC_LOGIN3_REDIRECT_URI = "http://localhost:3000/auth/callback";
process.env.NEXT_PUBLIC_LOGIN3_SCOPES = "openid profile email wallet";
