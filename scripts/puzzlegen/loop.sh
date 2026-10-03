#!/usr/bin/env bash
# Alternates hard and expert, one new puzzle at a time, until stopped with Ctrl-C.
# Extra args pass through to gen.ts (e.g. --workers 4 --steps 400).
#
#   pnpm puzzles:loop
#
# Each puzzle is appended to puzzles/pool/<tier>.jsonl the moment it's found, so stopping
# loses at most the search in progress. Run `pnpm puzzles:publish` afterwards.
set -u
trap 'echo; echo "stopped"; exit 0' INT TERM

cd "$(dirname "$0")/../.."
while true; do
  for tier in hard expert; do
    pnpm --silent puzzles:gen "$tier" --count 1 "$@" || { echo "gen failed ($tier), stopping"; exit 1; }
  done
done
