#!/usr/bin/env bash
# seed_neop_keys.sh — register each live seat's Ed25519 PUBLIC key into the palace `neop_keys` table, the
# prerequisite for the Gate-D flip (ENABLE_BRIDGE_IDENTITY). See the execution plan Step 3b (NEURAL-ops
# docs/deployment/execution-plan-track1-3-live-2026-07.md). Run this IN-VPC against the live palace BEFORE
# flipping the flag — an empty registry means every request 403s.
#
# registerNeopKey is an INTERNAL mutation on purpose (a seat must not register its own key), so this uses
# `npx convex run`, which authenticates with the deployment ADMIN credentials — NOT a Convex client (which
# can only call public functions). That keeps key registration an admin/provisioning act.
#
# Auth (self-hosted): export CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY (the same creds as the
# palace deploy, Step 1). Cloud-proxied: export CONVEX_DEPLOY_KEY for that deployment.
#
# Inputs:
#   PALACE_ID   the tenant/palaceId (dogfood: k17f0b36y2f7h4sbr3pqp5wxg189cvg1)
#   pairs       one or more  seat=<base64-pubkey>  args (derive with
#               neop_jcode_adapter/scripts/derive_seat_pubkey.py in NEURAL-ops — the private seed stays on the seat)
#
# Example:
#   PALACE_ID=k17f0b36y2f7h4sbr3pqp5wxg189cvg1 \
#     scripts/seed_neop_keys.sh aria=A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg= recon=<recon-pubkey>
set -euo pipefail

: "${PALACE_ID:?set PALACE_ID (the tenant/palaceId to register keys for)}"
if [[ $# -lt 1 ]]; then
  echo "usage: PALACE_ID=<id> $0 seat=<base64-pubkey> [seat=<base64-pubkey> ...]" >&2
  exit 2
fi

for pair in "$@"; do
  seat="${pair%%=*}"
  pubkey="${pair#*=}"
  if [[ -z "$seat" || -z "$pubkey" || "$seat" == "$pair" ]]; then
    echo "!! bad pair '$pair' (expected seat=<base64-pubkey>)" >&2
    exit 2
  fi
  echo ">> registering seat '$seat' (pubkey ${pubkey:0:12}...) into neop_keys for palace $PALACE_ID"
  # JSON args to the internal mutation. --push=false so this never triggers a deploy; run against what's live.
  npx convex run palace/neopKeys:registerNeopKey \
    "{\"palaceId\":\"$PALACE_ID\",\"neopId\":\"$seat\",\"pubkey\":\"$pubkey\"}"
done

echo "OK registered $# seat key(s). Verify with:"
echo "   npx convex run palace/neopKeys:getNeopKey '{\"palaceId\":\"$PALACE_ID\",\"neopId\":\"aria\"}'"
echo "Then flip ENABLE_BRIDGE_IDENTITY=true (after the staging crypto check — plan Step 3b)."
