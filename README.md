# claude-tokmon

[English](README.md) | [中文](README.zh.md)

Token usage monitor for Claude Code — session token stats with cache breakdown, per-query request analysis, context progress bar, Git status, and multi-platform quota tracking.

## Install

```
/plugin marketplace add wjf-f/claude-tokmon
/plugin install claude-tokmon
/claude-tokmon:setup
```

## What it shows

**English** (auto-detected on English systems):
```
M:glm-5.1  CTX ████░░░░ 45%  │  D:my-project  󰊢 dev*
In:397.8k  Out:24.3k  CacheR:2.5M  Total:2.9M  Req:16  Tools:16  Hit:92%
5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M
```

**中文**（中文系统自动切换）：
```
M:glm-5.1  CTX ████░░░░ 45%  │  D:my-project  󰊢 dev*
输入:397.8k  输出:24.3k  读缓存:2.5M  总计:2.9M  请求:16  工具:16  命中:92%
5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M
```

- **Line 1** — Model, context progress bar (CTX), working directory, Git branch status
- **Line 2** — Session token breakdown + per-query request analysis (requests, tool calls, cache hit rate)
- **Line 3** — Platform quota usage (shown when `ANTHROPIC_BASE_URL` matches GLM/Kimi/MiniMax/DeepSeek)

## How it works

Zero configuration required. The plugin reads everything from Claude Code's existing setup:

- Model name — taken from the most recent `message.model` in the transcript JSONL (so API-proxy setups like Kimi show the real upstream model, not `claude-*`); falls back to stdin `model.id` for fresh sessions
- Context usage, working directory — from Claude Code stdin JSON
- Token statistics — parsed from transcript JSONL files with incremental caching and `message.id`-based deduplication (handles thinking/text/tool_use splits and parallel tool calls)
- Per-query analysis — from the last user input to now: request count, tool calls, cache hit rate
- Platform quota — platform detected via `ANTHROPIC_BASE_URL` domain; reuses Claude Code's existing API credentials

## Language

Labels auto-detect system locale (`LANG`, `LC_ALL`, or `Intl` API on Windows). Chinese locale → Chinese labels, everything else → English.

To override manually, set `TOKMON_LANG` environment variable:
- `TOKMON_LANG=en` — English
- `TOKMON_LANG=zh` — 中文

## Token fields

### Session totals (Line 2, first half)

| Label (EN) | Label (ZH) | Meaning |
|------------|------------|---------|
| In | 输入 | Non-cached input tokens |
| Out | 输出 | Output tokens |
| CacheR | 读缓存 | Tokens read from prompt cache |
| CacheW | 写缓存 | Tokens written to prompt cache |
| Total | 总计 | Sum of all above |

### Per-query analysis (Line 2, second half)

| Label (EN) | Label (ZH) | Meaning |
|------------|------------|---------|
| Req | 请求 | LLM request count in current query |
| Tools | 工具 | Tool call count in current query |
| Hit | 命中 | Cache hit rate = cacheRead / (input + cacheRead + cacheCreation) |
| Eff | 效率 | Cache efficiency = cacheRead / (cacheRead + cacheCreation), shown only when cacheCreation > 0 |

> **Current query** = from the last user input to now, including all LLM requests in the tool-call chain.

## Platform quota tracking

Auto-detected by `ANTHROPIC_BASE_URL` domain:

| Platform | Domain | Shows |
|----------|--------|-------|
| GLM (Zhipu/ZAI) | `bigmodel.cn` / `zhipu` / `z.ai` | 5h token quota, API call count, weekly limit, MCP usage |
| Kimi | `kimi.com` | 5h window usage, weekly limit |
| MiniMax | `minimaxi.com` / `minimax.io` | 5h interval usage/calls, weekly limit |
| DeepSeek | `deepseek.com` | Balance (CNY → ¥, USD → $), granted, topped-up |

Color thresholds: green <70% / orange 70-89% / red ≥90%

## License

MIT
