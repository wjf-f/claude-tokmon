# claude-tokmon

[English](README.md) | [中文](README.zh.md)

Token usage monitor for Claude Code — session token stats with cache breakdown, context progress bar, Git status, and multi-platform quota tracking.

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
In:1.5k  Out:800  CacheR:170.0k  CacheW:7.0k  Total:178.1k
5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M
```

**中文**（中文系统自动切换）：
```
M:glm-5.1  CTX ████░░░░ 45%  │  D:my-project  󰊢 dev*
输入:1.5k  输出:800  读缓存:170.0k  写缓存:7.0k  总计:178.1k
5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M
```

- **Line 1** — Model, context progress bar (CTX), working directory, Git branch status
- **Line 2** — Session token breakdown (input / output / cache read / cache write / total)
- **Line 3** — Platform quota usage (auto-detected, only shown for GLM/Kimi/MiniMax)

## How it works

Zero configuration required. The plugin reads everything from Claude Code's existing setup:

- Model name, context usage, working directory — from Claude Code stdin JSON
- Token statistics — parsed from transcript JSONL files with incremental caching
- Platform quota — auto-detected by model name, uses Claude Code's own API credentials

## Language

Labels auto-detect system locale (`LANG`, `LC_ALL`, or `Intl` API on Windows). Chinese locale → Chinese labels, everything else → English.

To override manually, set `TOKMON_LANG` environment variable:
- `TOKMON_LANG=en` — English
- `TOKMON_LANG=zh` — 中文

## License

MIT
