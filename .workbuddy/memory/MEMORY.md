# 项目长期记忆 · text2sql-garbage

## 项目定位
- 面向**无代码基础的运营/产品**的垃圾清运领域 Text-to-SQL 工具，基于 **LangChain.js + Next.js**。
- 同时是**面试作品**：`requirements-breakdown.md` 第 11 节明确列出考察点
  —— LangChain.js 自定义 Tool（TableSchemaTool）、Few-Shot 提示词、输出格式约束、Monaco + ECharts、
  SecurityValidator 黑名单/白名单。**做技术选型时优先考虑"能不能讲清楚"，而不只是"能不能跑"。**

## 目录约定
- 需求与规范文档在**仓库根目录**：`requirements-breakdown.md`（FR/NFR/量化验收）、
  `output-config-spec.md`（组件契约）、`ROADMAP.md`（后续优化计划）。
- 代码在 `text2sql-garbage/`（Next 16 + React 19 + Tailwind v4 + LangChain 1.x + pg）。
- 造数/评测资产在 `test-data/`：`schema.sql`（5 表 DDL）、`seed.sql`、`text2sql-eval.jsonl`（32 条评测集）。

## 关键约定（务必遵守）
1. **表结构单一数据源 = `lib/schema.ts`**。历史上 `lib/schema.ts` 与 `lib/table-metadata.ts`
   同时导出同名 `TABLE_METADATA` 但类型不同（对象 vs 字符串），导致 route 里出现
   `Object.values(字符串)` → 注入一串散字符的事故。不要再新增第二个 schema 源。
2. **方言统一 PostgreSQL**（`lib/db.ts` 用 `pg`），日期写 `CURRENT_DATE - INTERVAL '7 days'`，
   不要出现 MySQL 的 `DATE_SUB/CURDATE`。
3. `t_region` 的列名是 **`region_name`**（以 table-metadata 原始提示词为准，schema.ts 已对齐）。
4. 数据库：`postgresql://postgres:root@localhost:5432/garbage_db`，5 张表
   `t_region / t_vehicle / t_route_manifest / t_alert / t_weigh_bill`。
5. 前端 SSE 协议：事件以 `\n\n` 结尾，类型 `llm_stream` / `result` / `error`，结束帧 `data: [DONE]\n\n`。
6. 图表配色用品牌蓝系（`globals.css` 的 `--color-brand-*`），中文语境**涨红跌绿**不适用于本项目的运营图表，
   但若做 KPI 同比图需注意。

## 已知坑（重复踩过）
- `PromptTemplate.fromTemplate()` 按 f-string 解析，模板正文里的裸 `{}` 必须写成 `{{ }}`，
  否则报 `Missing value for input xxx`。
- Next 16 同一项目只允许一个 `next dev` 实例（会提示 PID 与已有端口）。
- React 严格模式下「mount 读 localStorage + state→effect 写 localStorage」会互相污染，
  布局偏好必须**在事件回调里落盘**。
- 前端解析图表数据要同时兼容标准 echarts `xAxis.data` 与后端精简结构 `xAxisData`。
