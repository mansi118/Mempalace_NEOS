#!/usr/bin/env bash
# Chain every automated test the project has. Exits non-zero on any failure.
# Designed to be the single command CI runs on every PR.
#
# Layers covered:
#   1. vitest — unit tests with mocked Convex
#   2. run_e2e_smoke — live Convex + bridge, 26 shape + connectivity checks
#   3. run_mutation_smoke — live write path (createCloset → retract → audit)
#   4. run_acl_suite — 20 NEop × op access-control cases, budget = 100%
#   5. run_relevance_retrieval — 40 queries, budgets on medium/hard/unanswerable/p95
#
# Env:
#   CONVEX_URL       — defaults to dev (small-dogfish-433)
#   CONVEX_SITE_URL  — defaults to the same site root
#   BUDGET_*         — override per-metric floors (see run_relevance_retrieval.ts)
#
# Usage:
#   scripts/run_all_tests.sh           # standard (dev)
#   scripts/run_all_tests.sh --prod    # against prod deployment
#   scripts/run_all_tests.sh --fast    # skip retrieval (slow step)

set -u  # fail on undefined vars; don't use -e because we want custom handling
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

FAST=0
PROD=0
for arg in "$@"; do
  [[ "$arg" == "--fast" ]] && FAST=1
  [[ "$arg" == "--prod" ]] && PROD=1
done

if [[ "$PROD" == "1" ]]; then
  export CONVEX_URL="${CONVEX_URL:-https://modest-camel-322.convex.cloud}"
  export CONVEX_SITE_URL="${CONVEX_SITE_URL:-https://modest-camel-322.convex.site}"
  echo "Running against PROD: $CONVEX_URL"
else
  export CONVEX_URL="${CONVEX_URL:-https://small-dogfish-433.convex.cloud}"
  export CONVEX_SITE_URL="${CONVEX_SITE_URL:-https://small-dogfish-433.convex.site}"
  echo "Running against DEV: $CONVEX_URL"
fi

pass=0
fail=0
failed_suites=()

# Coloured output if terminal supports it
if [[ -t 1 ]]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; Z=$'\033[0m'
else
  G=""; R=""; Y=""; B=""; Z=""
fi

run_suite() {
  local label="$1"
  shift
  echo
  echo "${B}─── $label ───${Z}"
  local t0=$(date +%s)
  if "$@"; then
    local dt=$(( $(date +%s) - t0 ))
    echo "${G}✓ $label (${dt}s)${Z}"
    pass=$((pass + 1))
  else
    local dt=$(( $(date +%s) - t0 ))
    echo "${R}✗ $label (${dt}s)${Z}"
    fail=$((fail + 1))
    failed_suites+=("$label")
  fi
}

run_suite "1/5 vitest (unit)" \
  npm test --silent

run_suite "2/5 E2E smoke (live backend shape)" \
  npx tsx benchmarks/run_e2e_smoke.ts

run_suite "3/5 Mutation smoke (live write path)" \
  npx tsx benchmarks/run_mutation_smoke.ts

run_suite "4/5 ACL suite (invariant)" \
  npx tsx benchmarks/run_acl_suite.ts

if [[ "$FAST" == "0" ]]; then
  run_suite "5/5 Retrieval quality (with budgets)" \
    npx tsx benchmarks/run_relevance_retrieval.ts
else
  echo
  echo "${Y}(skipping retrieval — --fast)${Z}"
fi

echo
echo "${B}══════════════════════════════════════════════${Z}"
total=$((pass + fail))
if [[ "$fail" == "0" ]]; then
  echo "${G}${B}ALL GREEN${Z}  $pass/$total suites passed"
  exit 0
else
  echo "${R}${B}FAILURES${Z}  $pass/$total suites passed"
  for s in "${failed_suites[@]}"; do
    echo "  ${R}✗${Z} $s"
  done
  exit 1
fi
