#!/usr/bin/env bash
# Encrypt or decrypt .env.local using GPG symmetric encryption.
#
# Usage:
#   ./scripts/env-crypt.sh            # interactive prompt
#   ./scripts/env-crypt.sh encrypt    # .env.local  → .env.local.enc (commit this)
#   ./scripts/env-crypt.sh decrypt    # .env.local.enc → .env.local

set -euo pipefail

ENV_FILE=".env.local"
ENC_FILE=".env.local.enc"

if ! command -v gpg &>/dev/null; then
  echo "Error: gpg not found. Install gnupg (brew install gnupg / apt install gnupg)." >&2
  exit 1
fi

ACTION="${1:-}"

if [[ -z "$ACTION" ]]; then
  echo "What do you want to do?"
  echo "  1) Encrypt ($ENV_FILE → $ENC_FILE)"
  echo "  2) Decrypt ($ENC_FILE → $ENV_FILE)"
  read -rp "Choice [1/2]: " choice
  case "$choice" in
    1) ACTION=encrypt ;;
    2) ACTION=decrypt ;;
    *) echo "Invalid choice." >&2; exit 1 ;;
  esac
fi

case "$ACTION" in
  encrypt)
    if [[ ! -f "$ENV_FILE" ]]; then
      echo "Error: $ENV_FILE not found." >&2
      exit 1
    fi
    gpg --symmetric --cipher-algo AES256 --output "$ENC_FILE" "$ENV_FILE"
    echo "Done. Commit $ENC_FILE to the repo."
    ;;
  decrypt)
    if [[ ! -f "$ENC_FILE" ]]; then
      echo "Error: $ENC_FILE not found." >&2
      exit 1
    fi
    if [[ -f "$ENV_FILE" ]]; then
      echo "Error: $ENV_FILE already exists. Remove it first to re-decrypt." >&2
      exit 1
    fi
    gpg --decrypt --output "$ENV_FILE" "$ENC_FILE"
    echo "Done — $ENV_FILE created."
    ;;
  *)
    echo "Usage: $0 [encrypt|decrypt]" >&2
    exit 1
    ;;
esac
