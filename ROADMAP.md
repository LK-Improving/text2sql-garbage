# 后续优化计划（Roadmap）

> 生成时间：2026-09-12
> 依据：`requirements-breakdown.md`（FR/NFR 与量化验收）、`output-config-spec.md`（组件契约）、当前代码实现
> 范围：本文只列**未达标项与优化点**，已跑通的主链路（提问 → 生成 SQL → 校验 → 查库 → 表格/图表渲染）不重复描述。

---

## ✅ P0 已完成（2026-09-12）

三项 P0 全部落地，并做了一轮「修复前 vs 修复后」对照实验（`test-data/before/` 为对照组）：

| 指标 | 修复前 | 修复后 | 目标 | 变化 |
|---|---|---|---|---|
| SQL 可执行率 | 79.3% | **100%** | ≥ 95% | +20.7pp，转为达标 |
| 结果准确率 | 55.2% | **62.1%** | ≥ 90% | +6.9pp，仍未达标 |
| 整体通过率 | 53.1% | **65.6%** | — | +12.5pp |
| 平均响应 | 1.9s | 2.0s | < 5s | 持平，达标 |

**修复前的典型失败（直接证明 Schema 感知是废的）**：
- `字段 a.severity 不存在` —— 提示词里写了库里根本没有的 `t_alert.severity`
- `关系 "t_weight_bill" 不存在` —— 表名都拼错（`t_weigh_bill` → `t_weight_bill`），因为注入的是散字符
- 安全拒绝类：把中文说明塞进了 `sql` 字段（旧 prompt 无拒绝规则）

详见 P0-1 / P0-2 / P0-3 各节的「已完成」说明，以及 `test-data/eval-report-*.md` 全量报告。

---

## 0. 现状速览

| 需求 | 现状 | 状态 |
|---|---|---|
| FR1 自然语言转 SQL | 已实现，SSE 流式返回 | ✅ |
| FR2 Schema 感知（TableSchemaTool） | **实质失效**，注入 prompt 的是一串散字符（见 P0-1） | ❌ |
| FR3 语法 / 安全校验 | 仅 6 个关键词的 `includes` 匹配 | ⚠️ 不达标 |
| FR4 执行与可视化 | 表格 + 自绘图表（柱/折/饼）+ Markdown 摘要 | ✅（`image` 类型缺） |
| FR5 Excel 导出 + OSS | 仅前端 CSV 导出，无 exceljs / OSS | ❌ |
| FR6 审计日志（Callback） | 无 | ❌ |
| FR7 Monaco SQL 编辑器 | 只有只读高亮 + 复制 | ❌ |
| 量化验收（可执行率 / 准确率 / 耗时） | **无任何实测数据** | ❌ |

---

## P0 · 正确性与底线

> 以下三项均已完成，保留问题描述作为回归依据。

### P0-1 表结构注入失效 —— prompt 里的"表结构"是一串单字符 ✅ 已完成

- **证据**：`lib/table-metadata.ts` 导出的是模板字符串，而 `app/api/chat/route.ts:201` 写的是
  `Object.values(TABLE_METADATA)`。对字符串调用 `Object.values` 返回**字符数组**，实测得到 40 个元素：
  `["1", ".", " ", "表", "名", ":", " ", "t", "_", ...]`，再 `JSON.stringify` 后注入 `{tableInfo}`。
- **为什么一直没暴露**：Few-Shot 示例里恰好带了表名、JOIN 关系、`region_name` 字段，模型靠示例硬扛；
  一旦问到 `t_weigh_bill` / `t_alert` 这类示例未覆盖的表，必然幻列。
- **附带问题**：`lib/schema.ts` 与 `lib/table-metadata.ts` **同时导出同名 `TABLE_METADATA` 但类型不同**
  （前者是结构化对象、缺 `t_weigh_bill`；后者是字符串、有 5 张表）。两处各自演化是隐患根源。
- **方案**：确立**单一数据源** = `lib/schema.ts`（结构化）：
  1. 按 `test-data/schema.sql` 补齐 5 张表，补上 `t_weigh_bill`、`t_vehicle.vehicle_type/status`、`t_alert.severity/status`；
  2. 删除 `lib/table-metadata.ts`，改由结构化定义渲染成紧凑文本注入；
  3. 渲染时附带 JOIN 关系速查（`t_route_manifest.region_id -> t_region.id` 等）。
- **验收**：断点/日志确认 prompt 内含 5 张表的字段说明；评测集中"磅单"类 2 条用例不再出现幻列。

### P0-2 重写 SecurityValidator ✅ 已完成

`lib/validator.ts` 目前只有 16 行，与 FR3「黑名单 + 表名白名单 + 强制 LIMIT」的要求差距明显：

| # | 问题 | 后果 |
|---|---|---|
| a | `;` 被列为禁用词 | 单语句结尾的 `;` 无害却被拒；`LIKE '%a;b%'` 这类字符串被误伤 |
| b | `includes('DELETE')` 等做子串匹配 | `WHERE remark = 'DELETE'` 被误杀；也无法区分标识符与关键字 |
| c | **无表名白名单** | 可查任意表，越权风险（FR3 明确要求，也是面试考点） |
| d | 无系统表 / 危险函数拦截 | `pg_read_file`、`pg_sleep`、`COPY`、`information_schema`、`pg_catalog` 全放行 |
| e | 无多语句拦截 | `SELECT 1; DROP TABLE x` 中 `DROP` 虽被拦，但组合变体多 |
| f | `LIMIT` 判断也是 `includes` | 字符串里出现 `LIMIT` 就漏加，全表扫描仍可能发生 |
| g | 无查询超时 | 慢查询长时间占用连接池 |

- **方案**：先剥离字符串字面量与注释，再做词法级校验：
  1. 必须以 `SELECT` 或 `WITH ... SELECT` 开头（CTE 属于只读，要放行）；
  2. 提取所有表名（含 JOIN / 子查询 / CTE 别名）→ 比对白名单 `t_region/t_vehicle/t_route_manifest/t_alert/t_weigh_bill`；
  3. 拦截系统表与危险函数；
  4. 断言单语句；
  5. 强制 `LIMIT`（缺失时补 1000，超限时收敛）；
  6. 执行层加 `SET LOCAL statement_timeout = '10s'`。
- **验收**：评测集"安全拒绝"3 条全部被拦下；"边界陷阱"4 条不被误杀（当前 `;` 规则很可能已经误杀了一部分）。

### P0-3 跑通评测集，产出基线数据 ✅ 已完成

- **现状**：`test-data/text2sql-eval.jsonl` 已有 32 条（区域趋势 4 / 车辆排行 4 / 预警明细 5 / 边界陷阱 4 /
  安全拒绝 3 / 时间聚合 3 / 车辆明细 3 / 综合查询 2 / 磅单 2 / 状态聚合 1 / 区域明细 1），
  但**没有任何执行脚本**。需求文档里的"可执行率 ≥95%、准确率 ≥90%、响应 <5s"目前全是空头承诺。
- **方案**：新增 `scripts/run-eval.mts`：逐条调用 `/api/chat` → 记录生成 SQL、是否执行成功、耗时、
  返回行数 → 与用例的 expected 比对 → 输出 `eval-report-YYYYMMDD.md`（按类别统计准确率 + 失败用例清单 + 失败原因归类）。
- **价值**：这是"我把准确率从 X% 提到 Y%"这句话的唯一依据；同时让每次改 prompt / validator 都能立即回归。
- **验收**：一条命令产出报告；报告能区分「SQL 语法错 / 字段幻觉 / 口径错 / 被安全拦截」四类失败。

**已交付**：`text2sql-garbage/scripts/run-eval.mjs`

```bash
node scripts/run-eval.mjs                  # 全量 32 条，输出到 test-data/
node scripts/run-eval.mjs --only=B04,F01   # 只跑指定用例（调试用）
node scripts/run-eval.mjs --concurrency=5  # 调并发，注意模型限流
```

判定口径（比逐字比对 SQL 更贴近"答案对不对"）：

| 状态 | 含义 | 计分 |
|---|---|---|
| `match` | 结果集完全一致 | ✅ |
| `match_extra` | `expected_columns` 的值全对，只是多给了额外列 | ✅ |
| `partial` | 值一致但列顺序 / 别名不同 | ✅ |
| `mismatch` | 结果集不同 | ❌ |
| `exec_error` | SQL 执行报错（含幻列 / 幻表） | ❌ |
| `false_reject` | 合法 SQL 被安全校验误杀 | ❌ |
| `false_accept` | 应拒绝的请求却生成了 SQL | ❌ |

> 为什么容忍「多给列」：评测集自带 `expected_columns`，设计意图是校验关键列，而非要求 SELECT 列表逐字一致。
> 修复后仍有 11 条失败，绝大多数是**口径语义问题**（如「清运量最多的车」没加 `LIMIT 1`、
> 「最近 3 天」的时间窗理解偏差），属于 P1-5「Few-Shot 扩容 + 口径提示」要解决的范畴。

---

## P1 进展（2026-09-12，已端到端验证）

| 指标 | P0 基线 | P1 后 | 变化 |
|---|---|---|---|
| SQL 可执行率 | 100% | 100% | 持平，达标 |
| 结果准确率 | 62.1% | **65.5%** | +3.4pp |
| 整体通过率 | 65.6% | **68.8%** | +3.2pp |
| 平均响应 | 2.0s | 1.9s | 达标 |
| P95 响应 | 3.3s | **2.6s** | −0.7s（Top3 裁剪 prompt 生效） |

已完成：P1-1 / P1-2 / P1-5 / P1-6 / P1-7（见各节）。
延期（需额外决策/资源）：P1-3 Excel+OSS（需 OSS 凭证且未配置）、P1-4 Monaco（需装 `@monaco-editor/react` + 新增 `/api/execute` 编辑重跑闭环）。

## 版本控制（2026-09-12 建立）

- 在项目根目录（即 `D:\Study\重点项目\text2sql-garbage`）初始化 git 仓库，首提交固化 P0+P1 全部源码。
- 移除 create-next-app 遗留的嵌套 `.git`（位于子目录 `text2sql-garbage/.git`），避免被识别为子模块、导致源码无法纳入版本控制。
- `.gitignore` 已排除 `.env` / `node_modules` / `.next` / `logs` / `package-lock.json`（npm 残留，项目实际用 pnpm，以 `pnpm-lock.yaml` 为准）/ `.workbuddy/shots/`；`.env.example` 保留为配置模板。
- 默认分支 `master`，尚未关联远程仓库。

## P1 · 补齐需求缺口（面试考察点）—— 下一步重点

### P1-1 TableSchemaTool（FR2 的真正落地）✅ 已完成

需求文档写明 `TableSchemaTool extends StructuredTool`、"关键词 → 相关表打分排序，取 Top3 注入"，
现在完全没有这层。这是「LangChain.js 自定义 Tool 开发」这一考察点的**唯一落点**。

- 方案：`lib/tools/table-schema-tool.ts`，`extends StructuredTool`，输入自然语言问题，
  输出按关键词命中的 Top3 表结构文本（区域/车辆/预警/磅单/日期等词表打分）。
- 附带收益：schema 从"全量注入"变"Top3 注入"，prompt 显著变短，**响应速度同步改善**（见 P2-1）。

### P1-2 审计日志（FR6，LangChain CallbackHandler）✅ 已完成

- 自定义 `CallbackHandler` 记录「提问 → 候选表 → 生成 SQL → 校验结果 → 执行耗时 → 行数 → 导出动作」，
  落盘 `logs/audit-YYYY-MM-DD.jsonl`。
- 面试可讲"可观测性 / 全链路追踪"；排查线上问题时也是唯一依据。

### P1-3 Excel 导出 + OSS 预签名（FR5）⏸ 延期（需 OSS 凭证）

- `package.json` 已装 `exceljs`、`ali-oss`、`@aws-sdk/client-s3`，但代码里**一次都没用到**。
- 方案：后端新增 `excel_download` 组件（exceljs 生成 xlsx → 上传 OSS → 返回 10 分钟预签名 URL）；
  限 1 万行防 OOM；OSS 未配置时**降级**为直接流式下载，不阻断主流程。

### P1-4 Monaco SQL 编辑器（FR7）⏸ 延期（需装 @monaco-editor/react + 新增 /api/execute）

- 现在只有只读 `<pre>` + 语法高亮。需求要的是"展示**并允许编辑**生成 SQL"。
- 方案：接入 `@monaco-editor/react`，支持"编辑 SQL → 重新执行"闭环（新增 `POST /api/execute` 只跑 SQL 不走 LLM）。

### P1-5 Few-Shot 从 1 例扩到 5 例 ✅ 已完成

- 需求写"内置 5 个覆盖常见场景的示例"，现在只有 1 个（区域 + 日期趋势）。
- 建议覆盖：区域趋势 / 车辆排行 / 预警明细 / 磅单明细 / 状态聚合；改用 `FewShotChatMessagePromptTemplate`。

### P1-6 用 `withStructuredOutput()` 替代正则解析 ✅ 已完成

- 当前靠 `extractJsonText` + 正则兜底解析 LLM 输出，脆弱。
- 换成 LangChain 的 `withStructuredOutput(OutConfigSchema)`（结合 zod），流式可用 `streamEvents`；
  正则仅作为降级路径保留。

### P1-7 组件契约对齐 `output-config-spec.md` ✅ 已完成

| 不一致点 | 详情 |
|---|---|
| 缺 `image` 类型 | spec 定义了 5 种组件，前端 `types.ts` 只有 4 种，无 image 渲染分支 |
| echarts 结构不符 | spec 要求标准 `data.option`，后端 `buildEchartsComponent` 实际产出精简结构 `{ chartType, xAxisData, series:[{name,data}] }` —— 这正是前端图表轴标签此前全部退化成 `#1 #2 #3` 的根因（前端已做兼容，但根上应统一） |
| `excel_download` 无渲染 | 类型在，组件不在 |

- 方案：二选一 —— 后端按 spec 输出标准 option，或修订 spec 承认精简结构；**建议后者**（自绘图表更轻、无需引入 echarts 包）。

---

## P2 · 体验、性能与工程

### P2-1 响应耗时（距 <5s 目标差距最大）

- 实测单次问答约 20~40s，瓶颈在 LLM 生成（`deepseek-flash`）。可做的：
  - Schema Top3 裁剪 + prompt 瘦身（P1-1 顺带）；
  - 首 token 时间（TTFT）单独埋点，与总耗时分开考核；
  - 热点问题结果缓存（相同问题直接回放，需处理时间敏感查询的失效）；
  - 评估更快的模型 / 开启推理加速，并在评测报告里对比不同模型的准确率-耗时曲线。

### P2-2 多轮对话与歧义澄清

- 现在 `messages` 只取最后一条，历史轮次被丢弃，前端也没传上下文。
- 先做「接着上次问」（注入最近 1~2 轮），再考虑主动追问补全维度（需求 P2 阶段项）。

### P2-3 前端打磨

- 图表导出 PNG / 复制图表；
- 表格列排序、分页（当前超 40 行只截断）；
- CSV 表头中文化（字段名 → 业务名，从 schema 的 `description` 取，如 `total_weight` → 总清运量(kg)）；
- 错误分级提示：区分"字段不存在 / 语法错误 / 权限拦截 / 超时"，并给出改写建议。

### P2-4 工程质量

- **README 仍是脚手架默认内容** —— 作品集项目必须重写：架构图、技术亮点、指标数据、截图、本地启动说明；
- `.env.explame` 拼写错误 → 改为 `.env.example`；
- **`API_KEY` 明文写在 `.env`**：虽已 gitignore，但建议轮换一次，并检查 git 历史里是否曾提交过；
- 补最小单测（`validator` 的词法校验、`derive` 的图表推断都是纯函数，vitest 易覆盖）；
- 引入 `npm run eval` 作为提交前回归（配合 P0-3）。

---

## 建议的执行顺序

1. **P0-1 + P0-2**（半天）：修 schema 注入、重写 validator —— 这两项直接决定"答案对不对"和"安不安全"。
2. **P0-3**（半天）：跑评测集出基线，之后所有改动都有对照数据。
3. **P1-1 + P1-5**（一天）：TableSchemaTool + Few-Shot 扩容 —— 面试考察点的核心落点。
4. **P1-2 / P1-3 / P1-4**：按面试时间取舍，其中审计日志（P1-2）成本最低、讲故事收益最高。
5. **P2**：在核心指标达标后再投入。

> 一句话优先级：**先把"表结构注入"和"安全校验"修对，再用评测数据证明它真的对，最后才谈体验和性能。**
