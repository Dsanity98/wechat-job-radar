#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv-jobradar/bin/python"
JOBRADAR_HOME="${JOBRADAR_HOME:-$ROOT/.cache/jobradar}"

export JOBRADAR_HOME

"$PY" -m jobradar update
"$PY" "$ROOT/tools/sync-radar-delta.py"
