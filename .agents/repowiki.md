# text2sql-garbage 架构 Wiki

## 1. 项目定位与运行时

这是面向垃圾清运运营/产品人员的自然语言查数工具：用户提问，系统检索表结构和 Few-Shot 示例，调用兼容 OpenAI 的模型生成只读 PostgreSQL SQL，经过安全校验后执行，并返回解释、表格、图表和 Excel。实际运行是 `text2sql-garbage/` 下的 Next.js 16 App Router；外层仓库承载需求、schema/seed、评测、CI/CD 和部署资料。

## 2. 源码分层

```text
text2sql-garbage/app (Next 页面、客户端组件、Route Handlers)
  ├─ app/components (Chat、SQL 编辑器、结果表格/图表、侧栏)
  ├─ app/api/chat (SSE 流式编排：schema tool → prompt → LLM → 校验 → pg → result)
  ├─ app/api/execute (编辑后的 SQL 重新执行)
  └─ app/api/export-excel (服务端生成 xlsx)
       ↓
text2sql-garbage/lib
  ├─ schema.ts / tools/table-schema-tool.ts (schema 单一来源与检索)
  ├─ prompts.ts / validator.ts / result-builder.ts (生成、安全、结果构建)
  ├─ db.ts / sql-cache.ts / audit.ts (数据库、缓存、审计)
  └─ error-hints.ts / field-labels.ts (错误和展示口径)
       ↓
外层 test-data/schema.sql、seed.sql、评测集；模型/数据库/对象存储为运行时外部边界
```

客户端通过 fetch 读取 SSE，服务端 Route Handler 负责模型、SQL、数据库和文件输出；服务端环境变量不进入客户端 bundle。

## 3. 模块、页面与路由

| 模块或路径 | 文件/目录 | 职责 |
| --- | --- | --- |
| 页面入口 | `text2sql-garbage/app/page.tsx`, `layout.tsx` | 对话式查数工作台和全局布局 |
| 客户端组件 | `text2sql-garbage/app/components/` | Chat、SQL 编辑器、结果面板、图表、导航与 Toast |
| 对话 API | `text2sql-garbage/app/api/chat/route.ts` | SSE 流式生成、执行和审计编排 |
| SQL 执行 API | `text2sql-garbage/app/api/execute/route.ts` | 安全校验后重新执行用户编辑 SQL |
| 导出 API | `text2sql-garbage/app/api/export-excel/route.ts` | 用 ExcelJS 生成 xlsx |
| 安全与 schema | `text2sql-garbage/lib/validator.ts`, `schema.ts` | SELECT-only、表白名单、LIMIT 和 schema 单一来源 |
| 结果与提示 | `text2sql-garbage/lib/result-builder.ts`, `prompts.ts` | 根据真实结果构建表格/图表和模型输入 |
| 数据/观测 | `text2sql-garbage/lib/db.ts`, `sql-cache.ts`, `audit.ts` | PostgreSQL、SQL 计划缓存和 JSONL 审计 |
| 评测/数据 | `test-data/`, `text2sql-garbage/scripts/` | schema/seed、评测集、门禁和辅助脚本 |

## 4. 数据、接口与鉴权

PostgreSQL schema 的权威文件在外层 `test-data/schema.sql`，seed 在 `test-data/seed.sql`；`lib/schema.ts` 是运行时提示、白名单和缓存共享的应用单一来源。当前 README 未描述用户鉴权，数据库和模型凭据通过服务端环境变量提供。API 错误需保持中文可解释分级，不泄露连接串或模型凭据。

## 5. 异步、流式与第三方边界

`POST /api/chat` 使用 SSE 输出模型流、SQL/结果阶段、完成和错误；客户端必须处理断开和重试边界。模型通过 LangChain.js 兼容端点调用；PostgreSQL 通过 `pg` 执行；ExcelJS 生成附件。SQL 计划缓存只缓存 SQL，不缓存查询结果；审计记录候选表、SQL、token、行数和状态时需遵守脱敏约束。

## 6. 开发约定与风险

- Next 服务端组件/Route Handler 与客户端组件边界要明确；服务端机密不得进入 props 或浏览器。
- 页面不重复实现 SSE 解析、SQL 安全校验或数据库访问；所有 SQL 路径复用 `validator.ts` 和 schema 单一来源。
- schema/seed 变化必须同步 `lib/schema.ts`、提示词、白名单、评测集和 `check:schema`。
- 最小验证：在 `text2sql-garbage/` 运行 `pnpm typecheck`、`pnpm test`；schema 改动补 `pnpm check:schema`；模型质量改动再跑评测门禁。
- 待确认：外层仓库的 CI/CD 与内层应用的部署基目录关系。
