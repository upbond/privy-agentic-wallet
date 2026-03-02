#!/bin/bash
# Verify Login 3.0 JWKS endpoint for Privy Custom Auth compatibility
# Privy requires RS256 or ES256 signing algorithms

DOMAIN="${1:-https://auth-wallet-mpc.dev.upbond.io}"
JWKS_URL="${DOMAIN}/.well-known/jwks.json"

echo "=== Login 3.0 JWKS Verification ==="
echo "URL: ${JWKS_URL}"
echo ""

RESPONSE=$(curl -s "${JWKS_URL}")

if [ $? -ne 0 ] || [ -z "${RESPONSE}" ]; then
  echo "FAIL: Cannot reach JWKS endpoint"
  exit 1
fi

echo "Response:"
echo "${RESPONSE}" | python3 -m json.tool 2>/dev/null || echo "${RESPONSE}"
echo ""

# Check for Privy-compatible algorithms
HAS_RS256=$(echo "${RESPONSE}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(any(k.get('alg') == 'RS256' for k in data.get('keys', [])))
" 2>/dev/null)

HAS_ES256=$(echo "${RESPONSE}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(any(k.get('alg') == 'ES256' for k in data.get('keys', [])))
" 2>/dev/null)

echo "=== Privy Compatibility Check ==="
echo "RS256 key present: ${HAS_RS256}"
echo "ES256 key present: ${HAS_ES256}"

if [ "${HAS_RS256}" = "True" ] || [ "${HAS_ES256}" = "True" ]; then
  echo ""
  echo "PASS: JWKS is compatible with Privy Custom Auth"
else
  echo ""
  echo "FAIL: No RS256 or ES256 key found. Privy requires one of these."
  exit 1
fi
