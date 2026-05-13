# claude-tokmon

[English](README.md) | [中文](README.zh.md)

Claude Code Token 用量监控插件 — 会话 Token 统计（含缓存细分）、本轮请求分析、上下文进度条、Git 状态、多平台配额追踪。

## 安装

在 Claude Code 中执行：

```
/plugin marketplace add wjf-f/claude-tokmon
/plugin install claude-tokmon
/claude-tokmon:setup
```

## 显示效果

**中文**（中文系统自动显示）：
```
M:glm-5.1  CTX ████░░░░ 45%  │  D:my-project  󰊢 dev*
输入:397.8k  输出:24.3k  读缓存:2.5M  总计:2.9M  请求:16  工具:16  命中:92%
5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M
```

**English** (English systems):
```
M:glm-5.1  CTX ████░░░░ 45%  │  D:my-project  󰊢 dev*
In:397.8k  Out:24.3k  CacheR:2.5M  Total:2.9M  Req:16  Tools:16  Hit:92%
5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M
```

- **第 1 行** — 模型名、上下文进度条（CTX）、工作目录、Git 分支状态
- **第 2 行** — 会话 Token 统计 + 本轮请求分析（请求次数、工具调用、缓存命中率）
- **第 3 行** — 平台套餐用量（仅在 `ANTHROPIC_BASE_URL` 匹配 GLM/Kimi/MiniMax 时显示）

## 说明

**零配置**，无需设置任何环境变量。插件从 Claude Code 自身的配置中自动读取：

- 模型名 — 从 transcript JSONL 最近一条 `message.model` 取（API 代理场景显示真实模型，而非 `claude-*`）；新会话回退到 stdin 的 `model.id`
- 上下文使用量、工作目录 — 来自 Claude Code stdin JSON
- Token 统计 — 解析 transcript JSONL 文件，增量缓存 + 按 `message.id` 去重（处理 thinking/text/tool_use 分片和并行工具调用）
- 本轮请求分析 — 从最后一条用户输入开始，统计该轮所有 LLM 请求的请求次数、工具调用数、缓存命中率
- 平台配额 — 按 `ANTHROPIC_BASE_URL` 域名识别平台，复用 Claude Code 已有的 API 凭证

## 语言

标签语言自动检测系统 locale（`LANG`、`LC_ALL`，Windows 上通过 `Intl` API）。中文 locale 自动显示中文，其他一律英文。

手动覆盖：设置 `TOKMON_LANG` 环境变量：
- `TOKMON_LANG=zh` — 中文
- `TOKMON_LANG=en` — English

## Token 字段说明

### 会话累计（第 2 行前半段）

| 字段（中文） | 字段（English） | 含义 |
|-------------|----------------|------|
| 输入 | In | 非缓存的输入 Token |
| 输出 | Out | 输出 Token |
| 读缓存 | CacheR | 从 prompt cache 读取的 Token |
| 写缓存 | CacheW | 写入 prompt cache 的 Token |
| 总计 | Total | 以上四项之和 |

### 本轮请求分析（第 2 行后半段）

| 字段（中文） | 字段（English） | 含义 |
|-------------|----------------|------|
| 请求 | Req | 本轮 query 触发的 LLM 请求次数 |
| 工具 | Tools | 本轮调用的工具次数 |
| 命中 | Hit | 缓存命中率 = cacheRead / (input + cacheRead + cacheCreation) |
| 效率 | Eff | 缓存效率 = cacheRead / (cacheRead + cacheCreation)，仅在有 cacheCreation 时显示 |

> **本轮 query** = 从最后一条用户输入开始，包含所有后续的 LLM 请求（含工具调用链），直到下一次用户输入重置。

## 平台用量追踪

根据 `ANTHROPIC_BASE_URL` 自动识别平台并显示对应套餐用量：

| 平台 | baseUrl 域名 | 显示内容 |
|------|-------------|---------|
| GLM（智谱/ZAI） | `bigmodel.cn` / `zhipu` / `z.ai` | 5h Token 配额、API 调用次数、周限量、MCP 用量 |
| Kimi | `kimi.com` | 5h 窗口用量、周限量 |
| MiniMax | `minimaxi.com` / `minimax.io` | 5h 区间用量/调用次数、周限量 |

颜色阈值：绿色 <70% / 橙色 70-89% / 红色 ≥90%

## 许可证

MIT
