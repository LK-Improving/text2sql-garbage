---
name: api-backend-delivery
description: 依据text2sql-garbage契约交付Next Route Handler、LangChain、PostgreSQL、SQL安全校验和导出能力。
---

# 服务端交付

先读取需求、接口契约、schema、评测集和 `.agents/repowiki.md`。保持 Route Handler、lib 业务模块、数据库和外部模型边界；所有 SQL 复用安全校验、表白名单和 LIMIT；SSE 定义生命周期；导出和错误响应可诊断且脱敏。实现后运行 typecheck、test、check:schema，模型质量改动再运行评测门禁。
