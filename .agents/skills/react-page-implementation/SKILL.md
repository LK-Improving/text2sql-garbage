---
name: react-page-implementation
description: 依据text2sql-garbage需求、UI规格和SSE/HTTP契约实现Next.js React工作台。
---

# React/Next 页面实现

先读取对应需求、UI、契约、内层 `text2sql-garbage/AGENTS.md`、`CLAUDE.md` 和 React/Next 规则。明确 Server/Client Component 边界，沿用现有 fetch/SSE、Monaco、ECharts 和 Tailwind；不把服务端凭据或数据库逻辑带入浏览器。实现后覆盖部分流、完成、错误、断开、空结果、重复提交和导出状态，并运行 `pnpm typecheck`/相关测试。
