#!/usr/bin/env node
// ============================================================================
// Claude Code 自定义 Statusline
// ============================================================================
// 基础功能：模型名、上下文进度条、工作目录、Git 分支状态、Token 统计、压缩警告
// 用量追踪：GLM（智谱/ZAI）、Kimi、MiniMax 三平台套餐用量实时显示
// 参考：https://github.com/zwen64657/glm-plan-usage2
// ============================================================================
//
// 输出格式示例（多行）：
//   第 1 行：M:glm-4 ████░░░░ 45% │ D:Lancet2 dev*
//   第 2 行：输入:1.5k 输出:800 读缓存:170.0k 写缓存:7.0k 总计:178.1k
//   第 3 行：5h 3% · 1h28m  12次  7d 15% · 2d7h  MCP 50/300  3.38M（仅 GLM/Kimi/MiniMax）
//
// 各段说明：
//   第 1 行：
//     M:<模型名>              - 当前使用的 AI 模型
//     ████░░░░ N%             - 上下文窗口使用进度条 + 百分比
//     D:<目录>                - 当前工作目录（取最后两级）
//     <分支图标> <分支名>     - Git 分支 + 状态（* 修改 / ? 未跟踪 / ! 冲突）
//     COMPACT                 - 上下文 ≥95% 时显示紧急压缩警告
//   第 2 行（从 transcript JSONL 解析）：
//     输入:N / 输出:N         - 会话累计 input/output tokens
//     读缓存:N / 写缓存:N     - cache_read / cache_creation tokens
//     总计:N                  - 四项之和
//   第 3 行（平台套餐用量）：
//     5h N% · HH:MM           - 5h 窗口使用率 + 重置倒计时
//     7d N% · dHH              - 周限量使用率 + 重置倒计时
//     MCP N/N                  - 30天 MCP 工具调用次数
//
// 用量追踪（仅在使用对应模型时显示）：
//
// 【GLM - 智谱/ZAI】
//   🪙 N% (⏰ HH:MM)       - 5h Token 配额使用率 + 下次重置时间
//   📊 N                    - 5h 窗口内 API 调用次数
//   📅 N%                   - 周限量百分比（仅新套餐有，老套餐无此项）
//   🌐 已用/上限            - 30天 MCP 工具调用次数
//   ⚡ N                    - 5h 窗口内 Token 消耗总量
//   颜色规则：绿色 <80% / 黄色 80-94% / 红色 ≥95%
//
//   GLM 套餐区别：
//     老套餐（无周限量）：Lite 1800次/5h, Pro 9000次/5h, Max 36000次/5h
//     新套餐（有周限量）：Lite 1200次/5h+6000/周, Pro 6000次/5h+30000/周, Max 24000次/5h+120000/周
//
// 【Kimi】
//   🪙 N% (⏰ HH:MM)       - 4h 用量百分比 + 重置时间
//   📅 N%                   - 周用量百分比（Kimi 始终有周限制）
//   颜色规则：绿色 <80% / 黄色 80-94% / 红色 ≥95%
//
// 【MiniMax】
//   🪙 N% (⏰ HH:MM)       - 5h 区间用量百分比 + 重置时间
//   📊 已用/上限            - 5h 区间调用次数
//   📅 N%                   - 周用量百分比（仅新套餐有，老套餐 weekly_total=0 无此项）
//   颜色规则：绿色 <80% / 黄色 80-94% / 红色 ≥95%
//
// 环境变量配置：
//   ANTHROPIC_AUTH_TOKEN     - API 认证 Token（GLM/MiniMax/Kimi 都可用）
//   ANTHROPIC_API_KEY        - API Key（Kimi 优先使用，不存在时尝试 AUTH_TOKEN）
//   ANTHROPIC_BASE_URL       - API 基础地址（用于自动检测平台）
//   GLM_API_TOKEN            - GLM API Token（可选，覆盖 ANTHROPIC_AUTH_TOKEN）
//   GLM_API_URL              - GLM 监控 API 地址（可选，代理场景下手动指定）
//
// 缓存：
//   目录：~/.claude/glm-plan-usage/
//   文件：glm-cache.json / kimi-cache.json / minimax-cache.json（各平台独立缓存）
//   TTL：120 秒（2 分钟），避免频繁 API 调用
// ============================================================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

// 自动压缩缓冲比例 (22.5% ≈ 45k/200k)，适用于 Claude Code < v2.1.6
const AUTOCOMPACT_BUFFER_PERCENT = 0.225;

// 语言设置：TOKMON_LANG 环境变量优先，否则自动检测系统 locale（兼容 Windows）
const _locale = process.env.TOKMON_LANG
    || process.env.LC_ALL
    || process.env.LC_MESSAGES
    || process.env.LANG
    || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : '')
    || 'en';
const LANG = _locale.toLowerCase();
const I18N = LANG.startsWith('zh')
    ? { input: '输入', output: '输出', cacheRead: '读缓存', cacheCreation: '写缓存', total: '总计', compact: 'COMPACT' }
    : { input: 'In', output: 'Out', cacheRead: 'CacheR', cacheCreation: 'CacheW', total: 'Total', compact: 'COMPACT' };

// 256 色调色板（Powerline 风格）
const COLORS = {
    dim: '\x1b[38;5;244m',       // 灰色（标签前缀）
    cyan: '\x1b[38;5;37m',       // 青色（目录）
    blue: '\x1b[38;5;39m',       // 蓝色（输入 Token、未跟踪文件）
    green: '\x1b[38;5;76m',      // 绿色（健康状态、干净分支）
    yellow: '\x1b[38;5;178m',    // 黄色（警告、已修改文件）
    red: '\x1b[38;5;196m',       // 红色（危险、冲突文件）
    darkRed: '\x1b[38;5;124m',   // 深红色（自动压缩触发）
    magenta: '\x1b[38;5;163m',   // 品红色（模型名）
    reset: '\x1b[0m',            // 重置颜色
};

// Nerd Font 图标定义
const ICONS = {
    model: '󰧑',      // AI 模型图标
    ctx: '󰦨',        // 上下文图标
    dir: '󰉋',        // 目录图标
    branch: '󰊢',     // Git 分支图标
    warning: '',      // 警告
    fire: '󱠇',       // 紧急 / 压缩警告
    sep: '│',         // 分段分隔符
};

// ===================== 通用 HTTP 工具 =====================

/** 发起 HTTP GET 请求（支持 http/https），5 秒超时 */
function httpGet(url, headers) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { headers, timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

// ===================== 文件缓存 =====================
// 缓存目录：~/.claude/glm-plan-usage/
// 各平台独立缓存文件，TTL 120 秒

const CACHE_DIR = path.join(os.homedir(), '.claude', 'glm-plan-usage');
const CACHE_TTL_MS = 120_000; // 2 分钟

/** 获取平台对应的缓存文件路径 */
function getCachePath(platform) {
    return path.join(CACHE_DIR, `${platform}-cache.json`);
}

/** 读取指定平台的缓存，过期返回 null */
function readCache(platform) {
    try {
        const cachePath = getCachePath(platform);
        if (!fs.existsSync(cachePath)) return null;
        const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (Date.now() - raw.timestamp < CACHE_TTL_MS) return raw.stats;
    } catch (_) {}
    return null;
}

/** 写入指定平台的缓存 */
function writeCache(platform, stats) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(getCachePath(platform), JSON.stringify({ stats, timestamp: Date.now() }));
    } catch (_) {}
}

// ===================== Transcript JSONL 解析 =====================
// 解析 Claude Code 的 transcript 文件，累计会话 token 用量（含 cache 细分）
// 增量解析：记录上次读取的文件偏移量，只处理新增内容

const TRANSCRIPT_CACHE_PATH = path.join(CACHE_DIR, 'transcript-cache.json');

/** 读取 transcript 缓存 */
function readTranscriptCache() {
    try {
        if (!fs.existsSync(TRANSCRIPT_CACHE_PATH)) return null;
        return JSON.parse(fs.readFileSync(TRANSCRIPT_CACHE_PATH, 'utf8'));
    } catch (_) {}
    return null;
}

/** 写入 transcript 缓存 */
function writeTranscriptCache(data) {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(TRANSCRIPT_CACHE_PATH, JSON.stringify(data));
    } catch (_) {}
}

/**
 * 解析 transcript JSONL 文件，累计 token 用量
 * @param {string} transcriptPath - JSONL 文件路径
 * @returns {{ input, output, cacheRead, cacheCreation, total } | null}
 */
function parseTranscriptTokens(transcriptPath) {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;

    const cached = readTranscriptCache();
    const stat = fs.statSync(transcriptPath);

    // 文件没变化且路径一致 → 直接返回缓存
    if (cached && cached.path === transcriptPath && cached.size === stat.size) {
        return {
            input: cached.input, output: cached.output,
            cacheRead: cached.cacheRead, cacheCreation: cached.cacheCreation,
            total: cached.input + cached.output + cached.cacheRead + cached.cacheCreation,
        };
    }

    // 文件路径变了或文件缩小（压缩）→ 全量重算；文件变大 → 增量解析
    const isNewFile = !cached || cached.path !== transcriptPath;
    const offset = (isNewFile || stat.size < (cached.offset || 0)) ? 0 : (cached.offset || 0);
    const acc = (offset === 0)
        ? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
        : {
            input: cached.input || 0, output: cached.output || 0,
            cacheRead: cached.cacheRead || 0, cacheCreation: cached.cacheCreation || 0,
        };

    try {
        // 只读取新增部分
        const fd = fs.openSync(transcriptPath, 'r');
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);

        const newContent = buf.toString('utf8');
        const lines = newContent.split('\n');

        // 去重：跳过连续重复的 assistant usage 条目（transcript bug）
        let prevKey = null;
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'assistant' && entry.message?.usage) {
                    const u = entry.message.usage;
                    const key = `${u.input_tokens || 0},${u.output_tokens || 0},${u.cache_read_input_tokens || 0},${u.cache_creation_input_tokens || 0}`;
                    if (key !== prevKey) {
                        acc.input += u.input_tokens || 0;
                        acc.output += u.output_tokens || 0;
                        acc.cacheRead += u.cache_read_input_tokens || 0;
                        acc.cacheCreation += u.cache_creation_input_tokens || 0;
                    }
                    prevKey = key;
                }
            } catch (_) {}
        }

        const result = {
            path: transcriptPath, offset: stat.size, size: stat.size,
            input: acc.input, output: acc.output,
            cacheRead: acc.cacheRead, cacheCreation: acc.cacheCreation,
        };
        writeTranscriptCache(result);

        return {
            input: acc.input, output: acc.output,
            cacheRead: acc.cacheRead, cacheCreation: acc.cacheCreation,
            total: acc.input + acc.output + acc.cacheRead + acc.cacheCreation,
        };
    } catch (_) {
        return null;
    }
}

// ===================== GLM（智谱/ZAI）用量追踪 =====================
//
// 支持平台：
//   智谱（bigmodel.cn） - 时区 UTC+8
//   ZAI（api.z.ai）     - 时区 UTC
//
// API 端点：
//   1. {base}/monitor/usage/quota/limit    - 获取配额限制（Token、MCP、周限量）
//   2. {base}/monitor/usage/model-usage    - 获取模型调用次数和 Token 消耗
//
// 套餐区别：
//   老套餐：无 TOKENS_LIMIT unit=6（无周限量）
//   新套餐：有 TOKENS_LIMIT unit=6（有周限量）
//
// 配额类型：
//   TOKENS_LIMIT + unit=3  → 5小时滚动窗口 Token 配额
//   TOKENS_LIMIT + unit=6  → 周限量（仅新套餐）
//   TIME_LIMIT             → 30天 MCP 工具调用次数

function getGlmApiConfig() {
    const token = process.env.GLM_API_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN;
    let apiUrl = process.env.GLM_API_URL;

    if (!apiUrl) {
        const baseUrl = process.env.ANTHROPIC_BASE_URL || '';
        if (baseUrl.includes('api.z.ai')) {
            // ZAI 平台：去掉 /anthropic 后缀
            apiUrl = baseUrl.replace('/api/anthropic', '/api').replace('/anthropic', '');
        } else if (baseUrl.includes('bigmodel.cn') || baseUrl.includes('zhipu')) {
            // 智谱平台：/api/anthropic → /api
            apiUrl = baseUrl.replace('/api/anthropic', '/api').replace('/anthropic', '');
        } else {
            // 默认智谱平台（中国用户兜底）
            apiUrl = 'https://open.bigmodel.cn/api';
        }
    }

    return { token, apiUrl };
}

/** 获取 GLM 用量统计（含缓存） */
async function fetchGlmUsage() {
    const cached = readCache('glm');
    if (cached) return cached;

    const { token, apiUrl } = getGlmApiConfig();
    if (!token) return null;

    try {
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        // 1. 获取配额限制
        const quotaResp = await httpGet(`${apiUrl}/monitor/usage/quota/limit`, headers);
        if (quotaResp.status !== 200) return null;
        const quota = JSON.parse(quotaResp.data);
        if (!quota.success) return null;

        const limits = quota.data?.limits || [];

        // 从 limits 中提取各类配额
        const tokenLimit = limits.find(l => l.type === 'TOKENS_LIMIT' && l.unit === 3);   // 5h Token 配额
        const weeklyLimit = limits.find(l => l.type === 'TOKENS_LIMIT' && l.unit === 6);   // 周限量（新套餐）
        const mcpLimit = limits.find(l => l.type === 'TIME_LIMIT');                         // 30天 MCP 配额

        const stats = {
            // 5h Token 配额使用率 + 重置时间
            tokenUsage: tokenLimit ? {
                percentage: Math.min(100, Math.max(0, tokenLimit.percentage || 0)),
                resetAt: tokenLimit.nextResetTime ? Math.floor(tokenLimit.nextResetTime / 1000) : null,
            } : null,
            // 周限量百分比（仅新套餐有此字段，老套餐为 null）
            weeklyUsage: weeklyLimit ? {
                resetAt: weeklyLimit.nextResetTime ? Math.floor(weeklyLimit.nextResetTime / 1000) : null,
                percentage: Math.min(100, Math.max(0, weeklyLimit.percentage || 0)),
            } : null,
            // MCP 工具调用次数
            mcpUsage: mcpLimit ? {
                used: mcpLimit.currentValue || 0,
                limit: mcpLimit.usage || 0,
            } : null,
            callCount: null,    // 5h API 调用次数（需第二个 API 获取）
            tokensUsed: null,   // 5h Token 消耗总量（需第二个 API 获取）
        };

        // 2. 获取模型调用次数和 Token 消耗（时间窗口与配额窗口同步）
        if (stats.tokenUsage?.resetAt) {
            const resetMs = stats.tokenUsage.resetAt * 1000;
            const startDate = new Date(resetMs - 5 * 3600000); // 5h 前
            const resetDate = new Date(resetMs);

            // 智谱用 UTC+8，ZAI 用 UTC
            const isZai = apiUrl.includes('z.ai');
            const tzOffset = isZai ? 0 : 8;

            const pad = n => String(n).padStart(2, '0');
            const toLocal = (d) => {
                const utc = d.getTime() + d.getTimezoneOffset() * 60000;
                return new Date(utc + tzOffset * 3600000);
            };
            const fmtDt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

            const startStr = fmtDt(toLocal(startDate));
            const endStr = fmtDt(toLocal(resetDate));

            const modelUrl = `${apiUrl}/monitor/usage/model-usage?startTime=${encodeURIComponent(startStr)}&endTime=${encodeURIComponent(endStr)}`;
            const modelResp = await httpGet(modelUrl, headers);
            if (modelResp.status === 200) {
                const modelData = JSON.parse(modelResp.data);
                // 兼容两种字段命名：totalUsage（驼峰）和 total_usage（下划线）
                const total = modelData.data?.totalUsage || modelData.data?.total_usage;
                if (total) {
                    stats.callCount = total.totalModelCallCount || null;   // 5h 内 API 调用次数
                    stats.tokensUsed = total.totalTokensUsage || null;     // 5h 内 Token 消耗总量
                }
            }
        }

        writeCache('glm', stats);
        return stats;
    } catch (_) {
        return null;
    }
}

// ===================== Kimi 用量追踪 =====================
//
// 检测条件：ANTHROPIC_BASE_URL 包含 kimi.com
// Token 来源：ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN
// API 端点：{domain}/coding/v1/usages
//
// Kimi 始终有两个窗口：
//   - 4h 窗口（duration=300, time_unit=TIME_UNIT_MINUTE）
//   - 周窗口（duration=10080）

/** 获取 Kimi 用量统计 */
async function fetchKimiUsage() {
    const cached = readCache('kimi');
    if (cached) return cached;

    const baseUrl = process.env.ANTHROPIC_BASE_URL || '';
    if (!baseUrl.includes('kimi.com')) return null;

    const token = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
    if (!token) return null;

    // 提取域名（scheme + domain）
    const schemeEnd = baseUrl.indexOf('://');
    const scheme = schemeEnd > 0 ? baseUrl.substring(0, schemeEnd + 3) : '';
    const rest = baseUrl.substring(schemeEnd + 3);
    const domainEnd = rest.indexOf('/');
    const domain = schemeEnd > 0 ? scheme + rest.substring(0, domainEnd > 0 ? domainEnd : rest.length) : '';

    try {
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        const resp = await httpGet(`${domain}/coding/v1/usages`, headers);
        if (resp.status !== 200) return null;
        const body = JSON.parse(resp.data);

        const limits = body.limits || [];

        // 4h 窗口：duration=300, timeUnit=TIME_UNIT_MINUTE（注意 API 使用驼峰命名）
        const fourHour = limits.find(l => l.window?.duration === 300 && l.window?.timeUnit === 'TIME_UNIT_MINUTE');
        // 周窗口：Kimi 返回在 body.usage，不在 limits 数组里
        const weekly = body.usage
            ? { detail: body.usage }
            : limits.find(l => l.window?.duration === 10080 || l.window?.duration === 168);

        const calcPct = (l) => {
            if (!l || !l.detail) return 0;
            const limit = parseInt(l.detail.limit, 10) || 0;
            if (limit <= 0) return 0;
            // API 返回 remaining（剩余量），已用量 = limit - remaining
            const remaining = parseInt(l.detail.remaining, 10);
            const used = !isNaN(remaining) ? Math.max(0, limit - remaining) : (parseInt(l.detail.used, 10) || 0);
            return Math.min(100, Math.round((used / limit) * 100));
        };

        const stats = {
            fourHourPct: calcPct(fourHour),
            fourHourResetTs: fourHour?.detail?.resetTime ? new Date(fourHour.detail.resetTime).getTime() : null,
            weeklyPct: weekly ? calcPct(weekly) : null,  // 无周窗口时为 null
            weeklyResetTs: weekly?.detail?.resetTime ? new Date(weekly.detail.resetTime).getTime() : null,
        };

        writeCache('kimi', stats);
        return stats;
    } catch (_) {
        return null;
    }
}

// ===================== MiniMax 用量追踪 =====================
//
// 检测条件：ANTHROPIC_BASE_URL 包含 minimaxi.com 或 minimax.io
// Token 来源：ANTHROPIC_AUTH_TOKEN
// Cookie 来源：MINIMAX_COOKIE 或 HERTZ_SESSION 环境变量
// API 端点：{domain}/v1/api/openplatform/coding_plan/remains
//
// 套餐区别：
//   老套餐：weekly_total_count = 0（无周限制）
//   新套餐：weekly_total_count > 0（有周限制）
//
// 注意：API 返回的是"剩余量"(remains)，不是"已用量"
//   已用量 = 总量 - 剩余量

/** 获取 MiniMax 用量统计 */
async function fetchMiniMaxUsage() {
    const cached = readCache('minimax');
    if (cached) return cached;

    const baseUrl = process.env.ANTHROPIC_BASE_URL || '';
    if (!baseUrl.includes('minimaxi.com') && !baseUrl.includes('minimax.io')) return null;

    const token = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!token) return null;

    // 提取域名
    const schemeEnd = baseUrl.indexOf('://');
    const scheme = schemeEnd > 0 ? baseUrl.substring(0, schemeEnd + 3) : '';
    const rest = baseUrl.substring(schemeEnd + 3);
    const domainEnd = rest.indexOf('/');
    const domain = schemeEnd > 0 ? scheme + rest.substring(0, domainEnd > 0 ? domainEnd : rest.length) : '';

    try {
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        const resp = await httpGet(`${domain}/v1/api/openplatform/coding_plan/remains`, headers);
        if (resp.status !== 200) return null;
        const body = JSON.parse(resp.data);

        // 检查业务级错误（cc-switch 方式）
        if (body.base_resp && body.base_resp.status_code !== 0) return null;

        // 取第一个模型（编程套餐通常只有一个主力模型）
        const model = (body.model_remains || [])[0];
        if (!model) return null;

        // 注意：API 返回的是剩余量，已用 = 总量 - 剩余
        const intervalTotal = model.current_interval_total_count || 0;
        const intervalRemaining = model.current_interval_usage_count || 0;
        const intervalUsed = intervalTotal - intervalRemaining;
        const intervalPct = intervalTotal > 0 ? Math.min(100, Math.round((intervalUsed / intervalTotal) * 100)) : 0;

        // 周限量：仅新套餐有（老套餐 weekly_total_count = 0）
        const weeklyTotal = model.current_weekly_total_count || 0;
        let weeklyPct = null;
        let weeklyReset = null;
        if (weeklyTotal > 0) {
            const weeklyRemaining = model.current_weekly_usage_count || 0;
            const weeklyUsed = weeklyTotal - weeklyRemaining;
            weeklyPct = Math.min(100, Math.round((weeklyUsed / weeklyTotal) * 100));
            weeklyReset = model.weekly_end_time; // 毫秒时间戳
        }

        const stats = {
            intervalUsed,       // 5h 区间已用次数
            intervalTotal,      // 5h 区间总次数
            intervalPct,        // 5h 区间使用百分比
            resetTs: model.end_time || null,  // 区间重置时间戳(ms)
            weeklyPct,          // 周使用百分比（老套餐为 null）
            weeklyResetTs: weeklyReset || null, // 周重置时间戳(ms)
        };

        writeCache('minimax', stats);
        return stats;
    } catch (_) {
        return null;
    }
}

// ===================== 用量格式化工具 =====================

/** Token 数量格式化：>=1M 显示 M，>=10K 显示 K，否则原值 */
function formatTokenCount(n) {
    if (n == null || n < 0) return 'N/A';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

/** 根据百分比返回用量颜色（cc-switch 标准） */
function getUsageColor(pct) {
    if (pct >= 90) return COLORS.red;       // 红色：≥90% 即将耗尽
    if (pct >= 70) return '[38;5;208m'; // 橙色：70-89% 注意用量
    return COLORS.green;                    // 绿色：<70% 用量充足
}

/** 格式化 GLM 用量为 statusline 文本 */
function formatGlmUsage(stats) {
    if (!stats) return null;
    const parts = [];

    // 5h Token 配额使用率 + 重置倒计时
    if (stats.tokenUsage) {
        const color = getUsageColor(stats.tokenUsage.percentage);
        const remain = formatTimeRemaining(stats.tokenUsage.resetAt ? stats.tokenUsage.resetAt * 1000 : null);
        parts.push(remain ? `5h ${color}${stats.tokenUsage.percentage}% · ${remain}${COLORS.reset}` : `5h ${color}${stats.tokenUsage.percentage}%${COLORS.reset}`);
    }

    // 5h API 调用次数
    if (stats.callCount != null) {
        parts.push(`${stats.callCount}次`);
    }

    // 周限量（仅新套餐有，老套餐无此项）
    if (stats.weeklyUsage) {
        const color = getUsageColor(stats.weeklyUsage.percentage);
        const remainW = formatTimeRemaining(stats.weeklyUsage.resetAt ? stats.weeklyUsage.resetAt * 1000 : null);
        parts.push(remainW ? `7d ${color}${stats.weeklyUsage.percentage}% · ${remainW}${COLORS.reset}` : `7d ${color}${stats.weeklyUsage.percentage}%${COLORS.reset}`);
    }

    // 30天 MCP 工具调用配额
    if (stats.mcpUsage) {
        parts.push(`MCP ${stats.mcpUsage.used}/${stats.mcpUsage.limit}`);
    }

    // 5h Token 消耗总量
    if (stats.tokensUsed != null) {
        parts.push(formatTokenCount(stats.tokensUsed));
    }

    if (parts.length === 0) return null;
    return parts.join('  ');
}

/** 格式化剩余时间：1h28m / 3d7h / 28m */
function formatTimeRemaining(ts) {
    if (!ts) return null;
    const diff = ts - Date.now();
    if (diff <= 0) return '0m';

    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    if (days > 0) return `${days}d${hrs % 24}h`;
    if (hrs > 0) return `${hrs}h${mins % 60}m`;
    return `${mins}m`;
}

/** 格式化 Kimi 用量为 statusline 文本 */
function formatKimiUsage(stats) {
    if (!stats) return null;
    const parts = [];

    // cc-switch 风格：百分比 + 重置倒计时
    const color4h = getUsageColor(stats.fourHourPct);
    const remain4h = formatTimeRemaining(stats.fourHourResetTs);
    parts.push(remain4h ? `4h ${color4h}${stats.fourHourPct}% · ${remain4h}${COLORS.reset}` : `4h ${color4h}${stats.fourHourPct}%${COLORS.reset}`);

    if (stats.weeklyPct != null) {
        const colorW = getUsageColor(stats.weeklyPct);
        const remainW = formatTimeRemaining(stats.weeklyResetTs);
        parts.push(remainW ? `7d ${colorW}${stats.weeklyPct}% · ${remainW}${COLORS.reset}` : `7d ${colorW}${stats.weeklyPct}%${COLORS.reset}`);
    }

    return parts.join('  ');
}

/** 格式化 MiniMax 用量为 statusline 文本 */
function formatMiniMaxUsage(stats) {
    if (!stats) return null;
    const parts = [];

    // 5h 区间用量百分比 + 重置倒计时
    const color = getUsageColor(stats.intervalPct);
    const remain = formatTimeRemaining(stats.resetTs);
    parts.push(remain ? `5h ${color}${stats.intervalPct}% · ${remain}${COLORS.reset}` : `5h ${color}${stats.intervalPct}%${COLORS.reset}`);

    // 5h 已用/总量
    parts.push(`${stats.intervalUsed}/${stats.intervalTotal}`);

    // 周用量（仅新套餐有）
    if (stats.weeklyPct != null) {
        const colorW = getUsageColor(stats.weeklyPct);
        const remainW = formatTimeRemaining(stats.weeklyResetTs);
        parts.push(remainW ? `7d ${colorW}${stats.weeklyPct}% · ${remainW}${COLORS.reset}` : `7d ${colorW}${stats.weeklyPct}%${COLORS.reset}`);
    }

    return parts.join('  ');
}

// ===================== 基础 Statusline 组件 =====================

/** 获取 Git 分支信息及工作区状态 */
function getGitInfo(cwd) {
    try {
        const branch = execSync('git --no-optional-locks branch --show-current', {
            cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (!branch) return null;

        const status = execSync('git --no-optional-locks status --porcelain', {
            cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        });

        // 根据工作区状态确定颜色和指示符
        let color = COLORS.green;    // 干净
        let indicator = '';

        if (status.includes('UU')) {
            color = COLORS.red;      // 冲突
            indicator = '!';
        } else if (status.includes(' M') || status.includes('M ') || status.includes('A ') || status.includes('D ')) {
            color = COLORS.yellow;   // 已修改 / 已暂存
            indicator = '*';
        } else if (status.includes('??')) {
            color = COLORS.blue;     // 未跟踪
            indicator = '?';
        }

        return { branch, color, indicator };
    } catch (_) {
        return null;
    }
}

/** 计算上下文窗口使用百分比 */
function getContextPercent(ctx) {
    // 优先使用 Claude Code v2.1.6+ 原生百分比
    const native = ctx.used_percentage;
    if (typeof native === 'number' && !Number.isNaN(native)) {
        return Math.min(100, Math.max(0, Math.round(native)));
    }

    // 兼容旧版本：手动计算
    const size = ctx.context_window_size;
    if (!size || size <= 0) return 0;

    const usage = ctx.current_usage || {};
    const total = (usage.input_tokens || 0) +
                  (usage.cache_creation_input_tokens || 0) +
                  (usage.cache_read_input_tokens || 0);
    const buffer = size * AUTOCOMPACT_BUFFER_PERCENT;
    return Math.min(100, Math.round(((total + buffer) / size) * 100));
}

/** 根据上下文百分比返回进度条颜色（四档） */
function getBarColor(pct) {
    if (pct >= 85) return COLORS.darkRed;   // ≥85% 深红（自动压缩已触发）
    if (pct >= 70) return COLORS.red;       // 70-84% 红色（危险区域）
    if (pct >= 50) return COLORS.yellow;    // 50-69% 黄色（注意）
    return COLORS.green;                    // <50% 绿色（健康）
}

/** 生成彩色进度条 */
function coloredBar(pct, width = 8) {
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    const color = getBarColor(pct);
    return `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}${COLORS.reset}`;
}

/** 分隔符 */
function sep() {
    return `${COLORS.dim}${ICONS.sep}${COLORS.reset}`;
}

/** 目录路径缩写（取最后两级） */
function getShortDir(cwd) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (cwd === home) return '~';

    const parts = cwd.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return cwd;

    const last = parts[parts.length - 1];
    if (parts.length === 1) return last;

    const parent = parts[parts.length - 2];
    return `${parent}/${last}`;
}

/** Token 数量格式化（简短显示） */
function formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

// ===================== 主程序入口 =====================

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
    let data;
    try {
        data = JSON.parse(input);
    } catch (_) {
        return;
    }

    const modelId = data.model?.id || 'unknown';
    const cwd = data.workspace?.current_dir || process.cwd();
    const ctx = data.context_window || {};
    const transcriptPath = data.transcript_path;

    const pct = getContextPercent(ctx);
    const bar = coloredBar(pct);
    const pctColor = getBarColor(pct);

    const dirShort = getShortDir(cwd);
    const gitInfo = getGitInfo(cwd);

    // 第 1 行：模型 + 上下文 + 目录 + Git + Token
    const line1 = [];

    // 模型名（品红色）
    line1.push(`${COLORS.dim}M:${COLORS.reset}${COLORS.magenta}${modelId}${COLORS.reset}`);
    // 上下文进度条 + 百分比
    line1.push(`${COLORS.dim}CTX${COLORS.reset} ${bar} ${pctColor}${pct}%${COLORS.reset}`);
    line1.push(sep());
    // 工作目录（青色） + Git 分支（颜色随状态变化）
    line1.push(`${COLORS.dim}D:${COLORS.reset}${COLORS.cyan}${dirShort}${COLORS.reset}`);
    if (gitInfo) {
        line1.push(`${gitInfo.color}${ICONS.branch} ${gitInfo.branch}${gitInfo.indicator}${COLORS.reset}`);
    }
    // 紧急压缩警告（≥95% 时显示）
    if (pct >= 95) {
        line1.push(`${COLORS.red}${ICONS.fire} ${I18N.compact}${COLORS.reset}`);
    }

    console.log(line1.join(' '));

    // 第 2 行：会话 Token 统计（从 transcript JSONL 解析，含 cache 细分）
    const transcript = parseTranscriptTokens(transcriptPath);
    const line2 = [];
    if (transcript && transcript.total > 0) {
        line2.push(`${COLORS.blue}${I18N.input}:${formatTokens(transcript.input)}${COLORS.reset}`);
        line2.push(`${COLORS.yellow}${I18N.output}:${formatTokens(transcript.output)}${COLORS.reset}`);
        if (transcript.cacheRead > 0) line2.push(`${COLORS.green}${I18N.cacheRead}:${formatTokens(transcript.cacheRead)}${COLORS.reset}`);
        if (transcript.cacheCreation > 0) line2.push(`${COLORS.cyan}${I18N.cacheCreation}:${formatTokens(transcript.cacheCreation)}${COLORS.reset}`);
        line2.push(`${COLORS.dim}${I18N.total}:${formatTokens(transcript.total)}${COLORS.reset}`);
    } else {
        // fallback：用 stdin 的累计值
        const totalIn = ctx.total_input_tokens || 0;
        const totalOut = ctx.total_output_tokens || 0;
        if (totalIn > 0 || totalOut > 0) {
            line2.push(`${COLORS.blue}${I18N.input}:${formatTokens(totalIn)}${COLORS.reset}`);
            line2.push(`${COLORS.yellow}${I18N.output}:${formatTokens(totalOut)}${COLORS.reset}`);
            line2.push(`${COLORS.dim}${I18N.total}:${formatTokens(totalIn + totalOut)}${COLORS.reset}`);
        }
    }
    if (line2.length > 0) {
        console.log(line2.join(' '));
    }

    // 第 3 行：平台用量追踪（仅在使用对应模型时显示）
    const modelLower = modelId.toLowerCase();
    let usageLine = null;

    if (modelLower.includes('glm') || modelLower.includes('chatglm')) {
        const glmStats = await fetchGlmUsage();
        usageLine = formatGlmUsage(glmStats);
    } else if (modelLower.includes('kimi')) {
        const kimiStats = await fetchKimiUsage();
        usageLine = formatKimiUsage(kimiStats);
    } else if (modelLower.includes('minimax')) {
        const minimaxStats = await fetchMiniMaxUsage();
        usageLine = formatMiniMaxUsage(minimaxStats);
    }

    if (usageLine) {
        console.log(usageLine);
    }
});
