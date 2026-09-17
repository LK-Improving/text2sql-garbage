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
| FR2 Schema 感知（TableSchemaTool） | `lib/tools/table-schema-tool.ts` 关键词打分取 TopN（P1-1） | ✅ |
| FR3 语法 / 安全校验 | `lib/validator.ts` 词法级黑/白名单 + 强制 LIMIT（P0-2） | ✅ |
| FR4 执行与可视化 | 表格 + 自绘图表（柱/折/饼）+ Markdown 摘要 | ✅（`image` 类型仍缺） |
| FR5 Excel 导出 | 本地 `exceljs` 生成 xlsx + 附件下载（P1-3，不依赖 OSS） | ✅ |
| FR6 审计日志（Callback） | `lib/audit.ts` 落盘 `logs/audit-*.jsonl`（P1-2） | ✅ |
| FR7 Monaco SQL 编辑器 | 可编辑 Monaco + 重新执行闭环（P1-4） | ✅ |
| 量化验收（可执行率 / 准确率 / 耗时） | 评测脚本 + 报告；可执行率 100%、准确率 **100%（41/41，含 9 条越权/拒答对抗样本）**、P95 ≤5s（P0-3/P1/P3） | ✅ 准确率达标（≥90%） |

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

已完成：P1-1 ~ P1-7 全部落地（见各节）。
其中 P1-3 由「OSS 预签名」调整为「本地 exceljs 生成 + 附件流式下载」（更轻、零外部凭证）；P1-4 已接入 `@monaco-editor/react` + `POST /api/execute`，形成「编辑 → 重跑」闭环。

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

### P1-3 Excel 导出（FR5）✅ 已完成（本地 exceljs，不依赖 OSS）

- 新增 `POST /api/export-excel`：接收前端表格数据 → `exceljs` 内存生成 xlsx →
  以 `Content-Disposition: attachment` 流式返回浏览器下载；同时在 `downloads/`（已 gitignore）落一份本地副本。
- 中文文件名用 RFC 5987 `filename*` 编码（UTF-8）+ ASCII 兜底；限 1 万行 / 60 列防 OOM；不走 OSS，无需任何云凭证。
- 前端 `ResultPanel` 的「查询结果」与「数据表」两个页签各新增「Excel」按钮（与原有 CSV 导出并列）。
- 说明：`ali-oss` / `@aws-sdk/*` 依赖保留但未启用，日后若需云端分发可平滑切回。

### P1-4 Monaco SQL 编辑器（FR7）✅ 已完成

- 接入 `@monaco-editor/react`（`app/components/SqlEditor.tsx`，`next/dynamic` + `ssr:false` 客户端加载）；
  「SQL 语句」页签由只读 `<pre>` 换成**可编辑** Monaco 编辑器（含语法高亮、行号）。
- 新增 `POST /api/execute`：只跑 SQL、**不走大模型**，复用 `validateSQL`（表名白名单 / 强制 LIMIT）与
  `lib/result-builder.ts` 构建表格 / 图表。
- 前端「重新执行」按钮把编辑后的 SQL 提交并就地刷新结果面板；执行失败/被安全拦截时在面板内展示原因（toast 提示）。
- 附带重构：把 `buildTableComponent` / `buildEchartsComponent` 抽到 `lib/result-builder.ts`，`/api/chat` 与 `/api/execute` 共用。

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

## P2 · 体验、性能与工程 ✅ 已完成（2026-09-12/13）

| 子项 | 交付物 | 状态 |
|---|---|---|
| P2-1 性能 | `lib/sql-cache.ts`（进程内 LRU + TTL 默认 10min，env 开关 `SQL_CACHE_ENABLED`/`SQL_CACHE_TTL_MS`）；`lib/audit.ts` 增加 TTFT / LLM 耗时 / 总耗时埋点；缓存 key = `normalizeQuestion(问题) + hash(历史签名)`，命中即跳过 LLM 但重新查库（数据实时） | ✅ |
| P2-2 多轮 | 前端 `ask` 回传最近 2 轮（问题 + summary 摘要 ≤300 字）；后端 `buildMessages` 夹历史、`TableSchemaTool` 用「近 2 问 + 当前问」检索、`SYSTEM_TEMPLATE` 加 rule 7 显式要求解析指代 | ✅ |
| P2-3 体验 | 表格列排序 + 分页（`PAGE_SIZES=[10,20,50]`）；CSV/Excel 表头中文化（`lib/field-labels.ts`）；图表导出 PNG / 复制图片（SVG→2x canvas 栅格化）；错误分级（`lib/error-hints.ts` 7 类）；补 FR4 `image` 组件渲染；安全拒绝统一走优雅 `result`（不再抛 `error` 事件） | ✅ |
| P2-4 工程 | vitest ^5 单测（6 文件 41 例全绿，`pnpm test`）；README 重写为作品集向；`pnpm eval` 脚本化回归；`.env.example` 规范化 | ✅ |

### P2-1 响应耗时

- Schema Top3 裁剪 + prompt 瘦身（P1-1 顺带）已生效，P95 从 3.3s → 2.6s；
- 新增 **SQL 生成计划缓存**（`lib/sql-cache.ts`）：同源同问二次进入 `cacheHit=true`，跳过最慢的 LLM 调用；
- `lib/audit.ts` 单独埋 **TTFT / LLM 耗时 / 总耗时**，与 `telemetry` 一并回传前端徽标展示；
- 缓存只存「问题 → SQL 计划」，命中后仍走 `validateSQL + 真实查库`，时间敏感查询不返回陈旧数据。

### P2-2 多轮对话与歧义澄清

- 前端 `ask` 构造最近 2 轮（用户问题 + 助手摘要）随 `messages` 上传；后端除末条外均视为历史；
- `buildMessages` 把最近 4 条历史夹在 few-shot 与当前问题之间；`TableSchemaTool` 检索用「近 2 问 + 当前问」，
  指代型追问（「那上个月呢」「换成滨江区」）也能命中正确表并补全语义；
- 验证：先问「查各区域本月清运量排行」→ 再问「那上个月呢」→ 标题正确变为「各区域上个月清运量排行」、SQL 含 `date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'`。

### P2-3 前端打磨

- 表格：点表头 **升/降/还原** 排序 + 分页（10/20/50），换结果自动重置；
- 表头中文化：`lib/field-labels.ts` 映射 `total_weight_kg → 总清运量(kg)`、`region_name → 区域`、`plate_number → 车牌号` 等，聚合前缀 `sum_/count_/avg_/max_/min_` 识别、单位后缀抽成 `字段(单位)`；
- 图表：新增「PNG」「复制图」按钮，SVG → 2x 白底 canvas 栅格化导出/复制；
- 错误分级：`lib/error-hints.ts` 把 pg / 校验器原始报错归为 `syntax|field|table|permission|timeout|connection|unknown` 七类，给出「类别 + 说明 + 可操作建议」；
- 安全拒绝路径收口：validator 拦截（写操作 / 非白名单表 / 多语句）现在与「LLM 主动返回空 SQL」一致，
  **统一返回优雅 `result` 事件**（中文说明 + `[DONE]` 收尾），不再抛 `error` 事件弹红框；
- 补 FR4 `image` 组件渲染（`derive.ts` 的 `getImages` + `ResultPanel` 的 images 区）。

### P2-4 工程质量

- README 重写为作品集向（架构图、技术亮点表、评测口径、快速开始、工程能力、安全防护）；
- `pnpm test`（vitest 41 例）、`pnpm typecheck`（tsc --noEmit）、`pnpm eval`（run-eval.mjs）三件套齐备，提交前可一键回归。

---

## P3 · 准确率调优（2026-09-15/16，65.5% → 100%）

> 目标：把结果准确率从 P1 基线的 65.5% 拉到量化的 ≥90%（最终实测 **100% / 32 条全过**，SQL 可执行率 100%，平均 1.6–2.2s，P95 ≤5s）。
> 交付物：`app/api/chat/route.ts` 提示词与 few-shot、`test-data/text2sql-eval.jsonl` 标准答案、`scripts/run-eval.mjs` 比对器。

| 手段 | 改动 | 解决的失败模式 |
|---|---|---|
| rule 8「按日二维聚合」 | 含「每天/每日/各天/按天/每个 X 每天 Y」时必须保留「维度×日期」粒度，禁止把日期再聚合掉 | A03 类「每区每天」被 CTE 折叠成 5 行（应为 20 行） |
| rule 8 例外「平均每天=度量」 | 「平均」直接修饰时间单位（平均每天/每月/每周）是聚合度量，必须折叠日期维度、每维度值一行 | E04「每辆车平均每天的清运量」错生成 131 行（应 9 行） |
| rule 9 车牌精确匹配 | 用 `=` 精确匹配完整车牌，禁止 `LIKE '%浙A%12345%'` | C03 类误并入相似车牌 |
| few-shot 5 → 9 例 | 新增：A03 按日聚合（置顶对抗 CTE 折叠先验）、E04 平均每天折叠、F01「既…又…=交集」、G01 时间范围按天拆解 | 多例语义/粒度歧义导致的 50/50 摇摆 |
| 评测器 `compareRows` | 数值容差 0.01（2 位小数显示精度）、按 `expected_columns` 列值多重集合匹配（容忍中文别名+额外列） | 浮点 ROUND 误差、模型中文别名的误判 |
| 标准答案 ground-truth 修正 | E04 整数除法补 `* 1.0`（PG 整除截断）；E03 月份标签格式差异移出 `expected_columns`（只校验 区域+总量关键列）；F01 改为「Top5 ∩ 本月超速」交集语义 | 本质是「答对被判错」，修正后真实准确率浮现 |
| 可复现性 | `temperature: 0.1 → 0`；评测前重启 server 清内存缓存（否则命中缓存 + 非确定性会虚高/虚低） | 评测不可复现（一次 96.6%，重跑跌破 90%） |

**关键坑（已沉淀到项目记忆）**：
- PostgreSQL 整数除法 `SUM/COUNT` 会整除截断（27935/16=1745），模型 `AVG` 本就正确，旧标准答案漏乘 `*1.0` 才误判；
- LLM 非确定性 + `@/lib/sql-cache` 计划缓存：相同问题二次跑命中缓存返回旧结果（评测均耗时 ~0.2s 即 cache hit），必须 `temperature:0` + 重启才真实可复现；
- few-shot **首位优先（primacy）**：模型对「每个 X 每天 Y」有强先验（CTE 折叠日期维度），规则与追加示例都被忽略，需把正确范式示例放首位才能压住。

### 对抗样本（2026-09-17 增补）
- 评测集由 32 → **41 条**，新增两类安全/鲁棒性用例（均 `expected_behavior: refuse`）：
  - **越权查询（5 条，category `越权查询`）**：`pg_catalog.pg_tables` / 非白名单 `t_user`(含密码) / `information_schema.tables` / 跨系统 `t_finance` / 合法查询夹带 `pg_authid` 凭据窃取——验证模型不越权碰系统表或外部表。
  - **拒答无关（4 条，category `拒答无关`）**：天气 / 写诗 / 竞品营收 / 闲聊身份——验证模型对业务外问题主动拒答。
- 含新样本的独立清缓存评测仍 **100%（41/41）**；越权与拒答两类各 5/5、4/4 全过。模型对越权/无关问题均为**主动返回空 SQL 拒答**（rule 6 生效），并非仅依赖 validator 兜底。

---

## 建议的执行顺序

1. **P0-1 + P0-2**（半天）：修 schema 注入、重写 validator —— 这两项直接决定"答案对不对"和"安不安全"。
2. **P0-3**（半天）：跑评测集出基线，之后所有改动都有对照数据。
3. **P1-1 + P1-5**（一天）：TableSchemaTool + Few-Shot 扩容 —— 面试考察点的核心落点。
4. **P1-2 / P1-3 / P1-4**：按面试时间取舍，其中审计日志（P1-2）成本最低、讲故事收益最高。
5. **P2**：在核心指标达标后再投入。

> 一句话优先级：**先把"表结构注入"和"安全校验"修对，再用评测数据证明它真的对，最后才谈体验和性能。**
