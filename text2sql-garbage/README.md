# 垃圾清运 Text-to-SQL（面试作品 / 运营自助查询）

面向**无代码基础的运营/产品**的「自然语言 → SQL → 结果可视化」工具：用大白话问，系统自动生成 PostgreSQL 只读查询、跑库、返回表格 + 图表 + 下载。

技术栈 **LangChain.js + Next.js 16 + React 19 + TypeScript + Tailwind v4 + PostgreSQL**，整条链路可解释、可观测、可回归。

---

## 架构

```
┌────────────┐     POST /api/chat (SSE)      ┌──────────────────────────┐
│  前端面板   │ ───────────────────────────▶ │  route.ts (流式编排)       │
│ React 19    │                              │   1. TableSchemaTool 检索  │
│ Monaco 编辑器│ ◀── llm_stream / result ── │   2. Few-Shot + 系统提示词  │
│ 表格/图表   │                              │   3. withStructuredOutput  │
│ Excel 下载  │                              │   4. validateSQL 安全校验   │
└────────────┘                              │   5. pg 执行 + 组件构建     │
                                           │   6. AuditCallbackHandler  │
                                           └────────────┬─────────────┘
                                                        │
                                          ┌─────────────┼───────────────┐
                                          ▼             ▼               ▼
                                  TableSchemaTool  validator.ts   result-builder.ts
                                  (打分检索 TopN)  (白名单+黑名单)  (table/echarts)
```

关键设计：**表结构单一数据源**（`lib/schema.ts`）。所有提示词注入、校验白名单、缓存都从这里取，杜绝「两份 schema 漂移」导致的幻列。

---

## 技术亮点（面试可讲）

| 考察点 | 实现 |
|---|---|
| **自定义 LangChain Tool** | `TableSchemaTool`：按问题关键词 + 表名打分检索 TopN 表，始终兜底事实表 `t_route_manifest` |
| **Few-Shot 提示工程** | 5 例覆盖区域趋势 / 车辆排行 / 预警明细 / 磅单明细 / 区域排行，f-string 模板规避转义坑 |
| **结构化输出** | `withStructuredOutput(json_mode)` 流式 + Zod 校验，失败时正则兜底 |
| **输出格式约束** | 模型只出 SQL，图表/表格由后端按真实查询结果自动构建（避免幻列、保证口径一致） |
| **安全校验（SecurityValidator）** | 先剥离字符串字面量与注释再做词法匹配：黑名单关键词 + 表名白名单 + 强制 LIMIT，防注入/越权 |
| **可观测性** | `AuditCallbackHandler` 全链路落 JSONL：候选表 → SQL → token → 行数 → 状态 |
| **Monaco 编辑器** | SQL 页签可编辑 → 「重新执行」走 `/api/execute` 闭环（不再调大模型） |
| **Excel 导出** | `exceljs` 服务端生成 xlsx 直接作为附件下载，**不依赖 OSS** |
| **多轮对话** | 前端回传最近 1~2 轮上下文，后端解析「那上个月呢」类指代 |
| **性能（P2-1）** | SQL 生成结果内存缓存（归一化问题+历史签名为 key），命中即跳过 LLM、仅重查库 |
| **错误分级（P2-3）** | 把 pg/校验错误归类为「字段/表/语法/权限/超时/连接」，给中文说明 + 改写建议 |

---

## 评测口径

跑 `pnpm eval`（需本地 PostgreSQL + 正在运行的 dev server，见下）：

- **SQL 可执行率** ≥ 95%
- **结果准确率** ≥ 90%（值的多重集合比对，容忍列顺序/别名差异 `match_extra`）
- **P95 响应** < 5s（TopN 裁剪 + 缓存之后 P95 已降至 ~2.6s）

评测集在 `test-data/text2sql-eval.jsonl`（32 例，含安全拒绝用例）。

---

## 快速开始

```bash
pnpm install

# 1) 准备数据库（PostgreSQL，库名 garbage_db）
psql -U postgres -c "CREATE DATABASE garbage_db;"
psql -U postgres -d garbage_db -f test-data/schema.sql
psql -U postgres -d garbage_db -f test-data/seed.sql

# 2) 配置环境变量（参考 .env.example）
#   MODEL_NAME / API_KEY / BASE_URL 指向兼容 OpenAI 的 LLM
#   DATABASE_URL / PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE

# 3) 启动
pnpm dev          # http://localhost:3000
```

> 缓存开关：`SQL_CACHE_ENABLED=0` 关闭，`SQL_CACHE_TTL_MS=600000` 调整 TTL（毫秒）。

---

## 工程能力（可回归）

```bash
pnpm typecheck          # tsc --noEmit
pnpm test              # vitest 单测（validator / field-labels / error-hints / result-builder / sql-cache / derive）
pnpm eval --base=http://localhost:3000   # 跑评测集
```

测试覆盖：词法级安全校验（含 CTE 误判回归）、字段中文化映射、错误分级判定、组件推断、缓存命中/失效。

---

## 安全防护小结

- SELECT-only：剥离字面量/注释后再匹配，写操作、DDL、`pg_*` 危险函数、跨库元数据全部拦下。
- 表名白名单：只允许 5 张业务表；CTE/子查询别名自动排除，避免误拦。
- 强制 LIMIT：无 LIMIT 补 1000，超 10000 收敛，防全表拉取。
- 缓存只存 SQL 计划、不存查询结果：命中后依然重新查库，数据实时性不受影响。
