#!/usr/bin/env bash
set -euo pipefail

# 更新 jobsearchradar 快照，并重新生成官方在招岗位的导入文件。
# 生成后仍需在云开发控制台按顺序导入 data/radar/*.json。

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv-jobradar/bin/python"
JOBRADAR_HOME="${JOBRADAR_HOME:-$ROOT/.cache/jobradar}"

export JOBRADAR_HOME

"$PY" -m jobradar update
"$PY" "$ROOT/tools/export-radar.py"

echo "已完成，导入文件位于：$ROOT/data/radar/"
