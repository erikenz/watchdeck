#!/usr/bin/env bash
# PRD §R8 acceptance gate: no trace of the upstream project or the old music
# identity may survive in the tree.
#
# Allowed exceptions, and why:
#   docs/                the PRD keeps the research record, including upstream names
#   NOTICE, license      the MIT attribution, which must be retained
#   dist/, pack/         build output
#   pnpm-lock.yaml       generated; a dependency name ("nth-check") matches `th-ch`
#   identity-gate.sh     this file, which necessarily contains the pattern
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# These literals are what this script searches FOR — they are the only place the
# upstream name still appears in a file we ship, and the script excludes itself
# from its own scan (see the list above).
pattern='pear-desktop|peard:|ytmd|youtube-music|th-ch'
if matches=$(grep -rniE "$pattern" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs \
  --exclude-dir=dist --exclude-dir=pack \
  --exclude=NOTICE --exclude=license --exclude=pnpm-lock.yaml \
  --exclude=identity-gate.sh); then
  printf '%s\n' "$matches"
  printf '\nerror: upstream identity found outside the attribution files (PRD §R8)\n' >&2
  exit 1
fi

printf 'identity gate: clean\n'
