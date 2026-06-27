#!/usr/bin/env bash
# Sync secrets from .env.local to GitHub Secrets and CapRover app env vars.
#
# Usage:
#   ./scripts/sync-secrets.sh               # sync everything
#   ./scripts/sync-secrets.sh --dry-run     # preview what would be synced
#   ./scripts/sync-secrets.sh --gh-only     # GitHub Secrets only
#   ./scripts/sync-secrets.sh --cap-only    # CapRover env vars only
#
# Requires: gh CLI (authenticated), caprover CLI (already logged in), jq
#
# ADDING A NEW SECRET
# -------------------
# 1. Add it to .env.example with a comment explaining it.
# 2. Add it to the ROUTING table below with gh/cap flags.
# That's it — the script will warn if a key in .env.example is missing here.

set -euo pipefail

ENV_FILE=".env.local"
DRY_RUN=false
GH_ONLY=false
CAP_ONLY=false

for arg in "$@"; do
  case $arg in
    --dry-run)  DRY_RUN=true ;;
    --gh-only)  GH_ONLY=true ;;
    --cap-only) CAP_ONLY=true ;;
    --env=*)    ENV_FILE="${arg#--env=}" ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found" >&2
  exit 1
fi

# --- Parse env file ---
declare -A ENV
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    val="${val#\"}" ; val="${val%\"}"
    val="${val#\'}" ; val="${val%\'}"
    ENV["$key"]="$val"
  fi
done < "$ENV_FILE"

get() { echo "${ENV[$1]:-}"; }

# ============================================================
# Routing table — single source of truth.
# Format: "KEY:gh:cap"
#   gh  = sync to GitHub Secrets   (y/n)
#   cap = sync to CapRover env vars (y/n)
# ============================================================
ROUTING=(
  # Runtime vars — live in both GH (for CI deploy) and CapRover (container)
  "PORT:n:y"
  "JWT_SECRET:y:y"
  "ADMIN_USERS:y:y"

  # OAuth — runtime, needed in container
  "GOOGLE_CLIENT_ID:y:y"
  "GOOGLE_CLIENT_SECRET:y:y"
  "GITHUB_CLIENT_ID:y:y"
  "GITHUB_CLIENT_SECRET:y:y"
  "DISCORD_CLIENT_ID:y:y"
  "DISCORD_CLIENT_SECRET:y:y"
  "OAUTH_CALLBACK_BASE:y:y"
  "OAUTH_REDIRECT_URL:y:y"

  # CapRover infra — used by CI to deploy, not injected into the running app
  "CAPROVER_URL:y:n"
  "CAPROVER_PASSWORD:y:n"
  "CAPROVER_APP:y:n"
  "CAPROVER_APP_DOMAIN:y:n"

  # GHCR image pull auth — CI only
  "GITHUB_OWNER:n:n"   # built-in as github.repository_owner in CI
  "GHCR_TOKEN:y:n"
)

# Build derived lists from the routing table
GH_SECRETS=()
CAP_KEYS=()
declare -A ROUTED_KEYS
for entry in "${ROUTING[@]}"; do
  IFS=: read -r k gh cap <<< "$entry"
  ROUTED_KEYS["$k"]=1
  [[ "$gh" == "y" ]] && GH_SECRETS+=("$k")
  [[ "$cap" == "y" ]] && CAP_KEYS+=("$k")
done

# Warn about keys in .env.example not in the routing table
ENV_EXAMPLE="$(dirname "$ENV_FILE")/.env.example"
if [[ -f "$ENV_EXAMPLE" ]]; then
  UNROUTED=()
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
      k="${BASH_REMATCH[1]}"
      [[ -z "${ROUTED_KEYS[$k]:-}" ]] && UNROUTED+=("$k")
    fi
  done < "$ENV_EXAMPLE"
  if [[ ${#UNROUTED[@]} -gt 0 ]]; then
    echo "Warning: these keys are in .env.example but not in the ROUTING table:" >&2
    for k in "${UNROUTED[@]}"; do echo "  $k" >&2; done
    echo "  Add them to the ROUTING table in this script." >&2
    echo "" >&2
  fi
fi

# Validate infra creds
CAPROVER_URL="$(get CAPROVER_URL)"
CAPROVER_APP="$(get CAPROVER_APP)"

if ! $GH_ONLY; then
  for var in CAPROVER_URL CAPROVER_APP; do
    if [[ -z "${ENV[$var]:-}" ]]; then
      echo "Error: $var not set in $ENV_FILE — needed to sync to CapRover" >&2
      exit 1
    fi
  done

  CAPROVER_NAME=$(caprover ls 2>/dev/null \
    | awk -v url="$CAPROVER_URL" '$0 ~ url { print $2 }')
  if [[ -z "$CAPROVER_NAME" ]]; then
    echo "Error: no caprover CLI session found for $CAPROVER_URL" >&2
    echo "       Run: caprover login" >&2
    exit 1
  fi
fi

# ============================================================
# 1. GitHub Secrets
# ============================================================
if ! $CAP_ONLY; then
  echo "==> Syncing GitHub Secrets..."

  for secret in "${GH_SECRETS[@]}"; do
    val="$(get $secret)"
    if [[ -z "$val" ]]; then
      printf "  %-30s skip (empty)\n" "$secret"
      continue
    fi
    if $DRY_RUN; then
      printf "  %-30s [dry-run]\n" "$secret"
    else
      printf "  %-30s " "$secret"
      gh secret set "$secret" --body "$val"
      echo "ok"
    fi
  done
fi

# ============================================================
# 2. CapRover app env vars
# ============================================================
if ! $GH_ONLY; then
  echo ""
  echo "==> Syncing CapRover env vars for app '$CAPROVER_APP'..."

  ENV_JSON='[{"key":"NODE_ENV","value":"production"}]'
  for key in "${CAP_KEYS[@]}"; do
    val="$(get $key)"
    [[ -z "$val" ]] && continue
    ENV_JSON=$(jq -n \
      --argjson arr "$ENV_JSON" \
      --arg k "$key" \
      --arg v "$val" \
      '$arr + [{"key": $k, "value": $v}]')
  done

  if $DRY_RUN; then
    echo "  [dry-run] Would set: $(echo "$ENV_JSON" | jq -r '[.[].key] | join(", ")')"
  else
    TMPFILE=$(mktemp)
    caprover api \
      --caproverName "$CAPROVER_NAME" \
      --method GET \
      --path /user/apps/appDefinitions \
      --data '{}' \
      --output "$TMPFILE"
    CONTAINER_PORT=$(jq --arg app "$CAPROVER_APP" \
      '.appDefinitions[] | select(.appName == $app) | .containerHttpPort // 8080' \
      "$TMPFILE")
    rm -f "$TMPFILE"

    APP_CONFIG=$(jq -n \
      --arg app "$CAPROVER_APP" \
      --argjson env "$ENV_JSON" \
      --argjson port "$CONTAINER_PORT" \
      '{"appName": $app, "envVars": $env, "containerHttpPort": $port}')

    caprover api \
      --caproverName "$CAPROVER_NAME" \
      --method POST \
      --path /user/apps/appDefinitions/update \
      --data "$APP_CONFIG" \
      --output false

    echo "  Done ($(echo "$ENV_JSON" | jq -r '[.[].key] | join(", ")'))"
  fi
fi

echo ""
echo "All done."
