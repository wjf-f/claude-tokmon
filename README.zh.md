# claude-tokmon

[English](README.md) | [中文](README.zh.md)

Claude Code Token 用量监控插件 — 会话 Token 统计（含缓存细分）、上下文进度条、Git 状态、多平台配额追踪。

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
输入:1.5k  输出:800  读缓存:170.0k  写缓存:7.0k  总计:178.1k
5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M
```

**English** (English systems):
```
M:glm-5.1  CTX ████░░░░ 45%  │  D:my-project  󰊢 dev*
In:1.5k  Out:800  CacheR:170.0k  CacheW:7.0k  Total:178.1k
5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M
```

- **第 1 行** — 模型名、上下文进度条（CTX）、工作目录、Git 分支状态
- **第 2 行** — 会话 Token 统计（输入 / 输出 / 读缓存 / 写缓存 / 总计）
- **第 3 行** — 平台套餐用量（根据模型名自动识别，仅 GLM/Kimi/MiniMax 显示）

## 说明

**零配置**，无需设置任何环境变量。插件从 Claude Code 自身的配置中自动读取：

- 模型名、上下文使用量、工作目录 — 来自 Claude Code 的 stdin JSON
- Token 统计 — 解析 transcript JSONL 文件，支持增量缓存
- 平台配额 — 根据模型名自动识别平台，使用 Claude Code 已配置的 API 凭证

## 语言

标签语言自动检测系统 locale（`LANG`、`LC_ALL`，Windows 上通过 `Intl` API）。中文 locale 自动显示中文，其他一律英文。

手动覆盖：设置 `TOKMON_LANG` 环境变量：
- `TOKMON_LANG=zh` — 中文
- `TOKMON_LANG=en` — English

## Token 字段说明

| 字段（中文） | 字段（English） | 含义 |
|-------------|----------------|------|
| 输入 | In | 非缓存的输入 Token |
| 输出 | Out | 输出 Token |
| 读缓存 | CacheR | 从 prompt cache 读取的 Token |
| 写缓存 | CacheW | 写入 prompt cache 的 Token |
| 总计 | Total | 以上四项之和 |

## 平台用量追踪

根据当前使用的模型自动显示对应平台的套餐用量：

| 平台 | 模型关键词 | 显示内容 |
|------|-----------|---------|
| GLM（智谱/ZAI） | `glm`、`chatglm` | 5h Token 配额、API 调用次数、周限量、MCP 用量 |
| Kimi | `kimi` | 4h 窗口用量、周限量 |
| MiniMax | `minimax` | 5h 区间用量/调用次数、周限量 |

颜色阈值：绿色 <70% / 橙色 70-89% / 红色 ≥90%

## 许可证

MIT
