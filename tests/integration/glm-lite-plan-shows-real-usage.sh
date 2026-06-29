#!/usr/bin/env bash
# 验证 lite 套餐(无 nextResetTime)场景下,statusline 5h 段能显示真实调用数和 token 数。
# 依赖:ANTHROPIC_BASE_URL、ANTHROPIC_AUTH_TOKEN(从 ~/.claude/settings.json 读)。
# 用法: bash tests/integration/glm-lite-plan-shows-real-usage.sh
set -u

cd "$(dirname "$0")/../.."

SETTINGS="${HOME}/.claude/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo "FAIL: 缺少 $SETTINGS" >&2
  exit 2
fi

BASE_URL=$(python3 -c 'import json;print(json.load(open("'"$SETTINGS"'"))["env"].get("ANTHROPIC_AUTH_TOKEN",""))' >/dev/null 2>&1; python3 -c 'import json;print(json.load(open("'"$SETTINGS"'"))["env"].get("ANTHROPIC_BASE_URL",""))')
TOKEN=$(python3 -c 'import json;print(json.load(open("'"$SETTINGS"'"))["env"].get("ANTHROPIC_AUTH_TOKEN",""))')

if [ -z "$BASE_URL" ] || [ -z "$TOKEN" ]; then
  echo "FAIL: settings.json 里缺 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN" >&2
  exit 2
fi

# 取一个真实 transcript 路径(必需,否则脚本走不进 GLM 分支)
TP=$(ls -t "${HOME}/.claude/projects/"*/*.jsonl 2>/dev/null | head -1)
if [ -z "${TP:-}" ]; then
  echo "FAIL: 找不到任何 transcript 文件用于测试" >&2
  exit 2
fi

CACHE_DIR="${HOME}/.claude/glm-plan-usage"
GLM_CACHE="${CACHE_DIR}/glm-cache.json"

# 强制清缓存,让 fetchGlmUsage 真去调 API
rm -f "$GLM_CACHE"

# 构造 statusline 输入
INPUT=$(python3 -c '
import json, os
print(json.dumps({
    "model": {"id": "glm-5.2", "display_name": "glm-5.2"},
    "workspace": {"current_dir": os.getcwd()},
    "transcript_path": "'"$TP"'",
}))
')

# 跑 statusline,捕获输出(去掉 ANSI 颜色码便于断言)
OUTPUT=$(printf '%s' "$INPUT" | \
  ANTHROPIC_BASE_URL="$BASE_URL" \
  ANTHROPIC_AUTH_TOKEN="$TOKEN" \
  node src/index.js 2>&1)

PLAIN=$(printf '%s' "$OUTPUT" | sed -E 's/\x1b\[[0-9;]*m//g')

echo "---- statusline 输出(去色)----"
printf '%s\n' "$PLAIN"
echo "--------------------------------"

# 断言 1:5h 段后必须有调用次数(形如 "5h X% N次")
if printf '%s' "$PLAIN" | grep -Eq '5h +[0-9]+% +[0-9]+次'; then
  echo "PASS: 5h 段包含调用次数"
else
  echo "FAIL: 5h 段缺少调用次数(期望形如 '5h 0% 319次')" >&2
  exit 1
fi

# 断言 2:整条 statusline 必须有 token 量(数字+M/K)
# formatGlmUsage 把 tokensUsed 推到末尾,所以不要求紧贴 5h 段
if printf '%s' "$PLAIN" | grep -Eq '[0-9]+\.[0-9]+[KM]$|[0-9]+[KM]$'; then
  echo "PASS: statusline 末尾包含 token 量"
else
  echo "FAIL: statusline 末尾缺少 token 量(期望以 X.XXM 或 XK 结尾)" >&2
  exit 1
fi

echo "ALL PASS"
