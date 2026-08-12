#!/usr/bin/env bash
# Fetch reference repositories for the v3 parser refactor.
#
# What this script does:
#   - Clones structurizr/dsl (Apache-2.0) — the canonical Structurizr DSL
#     parser, written in Java. Studied for grammar tokens, test suites,
#     and edge-case behaviour. Never copied verbatim — see the license
#     note below.
#   - Clones plantuml-stdlib/C4-PlantUML (MIT) — the C4 macro definitions
#     and example diagrams. The `.puml` files in `examples/` and
#     `samples/` are the closest thing to a public corpus for C4-PUML.
#
# Both are placed under `.parser-refs/`, which is gitignored. The
# directory is never published, vendored, or imported from aact source.
#
# License posture:
#
#   aact is GPL-3.0. The reference repositories above are Apache-2.0 and
#   MIT. Grammar and syntax are not copyrightable, so studying them and
#   writing a clean-room chevrotain parser is fine. What is NOT fine:
#
#     - Copying source files into `src/` or `test/`.
#     - Translating Java code line-for-line into TypeScript.
#     - Copying test fixtures verbatim. We mine *what an input means*
#       and re-express expected output in our `Model` shape; we do not
#       paste their assertions.
#
#   When in doubt, read but do not import.
#
# Usage:
#   bash scripts/fetch-parser-refs.sh         # fresh shallow clone
#   bash scripts/fetch-parser-refs.sh --pull  # update existing clones

set -euo pipefail

REFS_DIR=".parser-refs"
mkdir -p "$REFS_DIR"

MODE="${1:-clone}"

clone_or_pull () {
  local name="$1"
  local url="$2"
  local dest="$REFS_DIR/$name"

  if [ -d "$dest/.git" ]; then
    if [ "$MODE" = "--pull" ]; then
      echo "[$name] pulling latest into $dest"
      git -C "$dest" pull --ff-only
    else
      echo "[$name] already cloned at $dest — pass --pull to update"
    fi
  else
    echo "[$name] cloning $url → $dest"
    git clone --depth 1 "$url" "$dest"
  fi
}

# Structurizr DSL parser. Lives in the structurizr/java monorepo as the
# `structurizr-dsl` Gradle module (it used to be a separate `structurizr/dsl`
# repo; consolidated by upstream into the Java monorepo). Where to look
# inside .parser-refs/java/:
#   structurizr-dsl/src/main/java/com/structurizr/dsl/   — parser source
#   structurizr-dsl/src/test/java/com/structurizr/dsl/   — test suite
#   structurizr-core/                                    — Java API the parser builds
clone_or_pull java https://github.com/structurizr/java.git

# C4-PlantUML — the macro library that defines the C4-PlantUML dialect.
# Where to look:
#   *.puml          — Container/Component/Context macro definitions
#   examples/       — canonical C4 diagrams (correct PlantUML usage)
#   samples/        — additional worked diagrams
clone_or_pull C4-PlantUML https://github.com/plantuml-stdlib/C4-PlantUML.git

echo ""
echo "Done. Reference repos under $REFS_DIR/ (gitignored)."
echo "These are studied, not vendored. See license posture comment at"
echo "the top of this script before reusing anything from them."
