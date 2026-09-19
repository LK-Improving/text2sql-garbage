# text2sql-garbage 项目代理规则

## 项目事实

- 仓库形态：外层 Git 仓库包含需求、评测数据、CI/CD 与部署配置；实际 Next.js 应用位于 `text2sql-garbage/` 子目录。
- 技术栈：Next.js 16.3 + React 19 + TypeScript + TailwindCSS 4；LangChain.js 1.x；PostgreSQL `pg`；Zod；Monaco；ECharts；ExcelJS；Netlify + Supabase 部署。
- 入口与主要目录：应用页面在 `text2sql-garbage/app/`，API Route Handler 在 `text2sql-garbage/app/api/`，业务库与安全逻辑在 `text2sql-garbage/lib/`；数据库 schema/seed/评测数据在外层 `test-data/`；需求和交付计划在 `requirements-breakdown.md`、`output-config-spec.md`、`ROADMAP.md`、`CI-CD-PLAN.md`。
- API 与文档来源：当前代码/README 是主要来源；`POST /api/chat` 使用 SSE，`POST /api/execute` 执行已编辑 SQL，`POST /api/export-excel` 返回 Excel；没有独立 OpenAPI，契约放 `.agents/Documents/接口设计/`。

## 最小上下文

- 修改实际应用前，先读取 `text2sql-garbage/AGENTS.md`（Next.js 自动生成规则）和 `text2sql-garbage/CLAUDE.md`，再读取目标文件、直接调用处、测试与 `.agents/repowiki.md`。
- 跨页面、Route Handler、数据库、模型提示词、安全校验、SSE 或部署变更前读取 `.agents/repowiki.md`。
- 保留外层和内层当前 Git 状态；初始化只新增根治理文件，不修改 Next 自动生成的内层 `AGENTS.md`、运行时代码、依赖、Netlify 或数据库文件。
- 不把 `.env`、API key、数据库 URL、GitHub/Netlify secret 或 Supabase 连接串写入治理产物。

## 规则与技能路由

- 修改 React 页面、组件、客户端状态、Monaco/ECharts UI：读取 `.agents/rules/react-frontend.mdc`。
- 修改 Next.js Server Component、Route Handler、LangChain 编排、PostgreSQL、导出或服务端环境变量：读取 `.agents/rules/next-backend.mdc`。
- 修改 `/api/chat` SSE、`/api/execute`、导出、SQL schema、错误格式或评测契约：读取 `.agents/rules/api-contract.mdc`。
- 涉及需求、接口、UI、实现和验收交接：读取 `.agents/rules/artifact-handoff.mdc`。
- PRD/需求触发条件：使用 `.agents/skills/prd-to-design/SKILL.md`。
- 接口文档触发条件：使用 `.agents/skills/api-docs-to-contract/SKILL.md`。
- UI/原型触发条件：使用 `.agents/skills/prototype-to-ui/SKILL.md`。
- React/Next 页面实现触发条件：使用 `.agents/skills/react-page-implementation/SKILL.md`。
- Route Handler、SQL、安全校验、模型或数据库交付触发条件：使用 `.agents/skills/api-backend-delivery/SKILL.md`。
- 端到端、评测门禁和接口联调触发条件：使用 `.agents/skills/integration-acceptance/SKILL.md`。

## 交付与验证

- UI 改动至少在应用目录运行 `pnpm typecheck`；服务端/接口改动补充 `pnpm test`、`pnpm check:schema`，若影响模型质量或性能再运行 `pnpm eval`/`pnpm eval:gate`。
- SQL 只能经过既有安全校验、表白名单和 LIMIT 约束；不要把用户 SQL、查询结果或敏感配置写入治理文档。
- SSE 验证事件顺序、心跳/完成、错误、断开和客户端取消；Excel 验证文件类型、空结果和失败响应。
- 最终只报告实际执行过的命令和结果；不要把 CI/Netlify/Supabase 状态推断为本地已验证。
