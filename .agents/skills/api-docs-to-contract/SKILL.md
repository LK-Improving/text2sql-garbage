---
name: api-docs-to-contract
description: 将text2sql-garbage的Route Handler、README、schema和评测资料整理为SSE/HTTP/SQL规范化契约。
---

# 文档到契约

读取 `app/api/`、`lib/`、README、schema/评测文件，按代码实际行为输出到 `.agents/Documents/接口设计/`。逐项记录请求、响应、SSE 事件、完成/错误/断开、SQL 安全、空结果、Excel 内容类型、schema 版本和待确认项；不以截图推测字段。
