#!/bin/bash
set -euo pipefail

# Verify Login 3.0 JWKS endpoint for Privy Custom Auth compatibility
# Privy requires RS256 or ES256 signing algorithms

# Check python3 is available
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required but not found"
  exit 1
fi

DOMAIN="${1:-https://auth-wallet-mpc.dev.upbond.io}"
JWKS_URL="${DOMAIN}/.well-known/jwks.json"

echo "=== Login 3.0 JWKS Verification ==="
echo "URL: ${JWKS_URL}"
echo ""

RESPONSE=$(curl -sf --connect-timeout 10 --max-time 30 "${JWKS_URL}") || {
  echo "FAIL: Cannot reach JWKS endpoint"
  exit 1
}

echo "Response:"
echo "${RESPONSE}" | python3 -m json.tool
echo ""

# Check for Privy-compatible algorithms (RS256 / ES256)
read -r HAS_RS256 HAS_ES256 < <(echo "${RESPONSE}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
keys = data.get('keys', [])
rs = any(k.get('alg') == 'RS256' for k in keys)
es = any(k.get('alg') == 'ES256' for k in keys)
print(rs, es)
")

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
