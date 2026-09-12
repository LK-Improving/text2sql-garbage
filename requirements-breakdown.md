# 基于 LangChain.js 的垃圾清运 Text-to-SQL 工具 —— 需求梳理与业务拆解

> 背景：面向**无代码基础的运营 / 产品人员**，用自然语言描述查询需求，自动生成可执行的 SQL，并支持表结构自动关联、语法校验、查询结果可视化（Markdown / 图片 / 表格 / ECharts）、一键导出 Excel 并上传 OSS。核心逻辑基于 **LangChain.js**。
>
> 业务场景：**垃圾清运**（路单、磅单、车辆、预警），是 Text-to-SQL 落地的一个典型垂直领域。

---

## 1. 项目背景与目标

### 1.1 痛点
- 运营 / 产品同学**不会写 SQL**，但每天要查「某区域清运量、各车辆趟次、超速预警明细」等数据。
- 传统模式依赖研发写 SQL，排期长、口径不统一、重复劳动多。
- 数据直接开放给非技术同学有**安全与权限风险**（误删、全表扫、越权）。

### 1.2 目标（可量化验收）
| 维度 | 目标建议 | 说明 |
|---|---|---|
| SQL 可执行率 | ≥ 95% | LLM 生成的 SQL 可直接执行的比例 |
| 结果准确率 | ≥ 90% | 抽样人工核对结果正确性 |
| 平均响应时长 | < 5s | 含生成 + 校验 + 执行 |
| 查询类型覆盖率 | 覆盖 Top 20 高频问法 | 区域趋势 / 车辆排行 / 预警明细 / 磅单明细 |
| 安全合规 | 0 高危操作漏网 | DELETE/DROP 等零放行 |

### 1.3 价值
让非技术同学**自助取数**，研发从「写 SQL 工具人」转为「维护 Schema 与提示词」，运营效率与数据口径一致性双提升。

---

## 2. 用户与典型场景

### 2.1 用户角色
- **运营 / 产品（主用户）**：零 SQL 基础，用自然语言取数、看趋势、下载报表。
- **数据分析师**：用工具快速验证想法，导出明细做二次分析。
- **研发 / 管理员（后台）**：维护表结构元数据、Few-Shot 示例、权限白名单。

### 2.2 典型提问（自然语言）
1. 「查一下最近 7 天西湖区每天的清运总量」
2. 「统计上个月所有车辆的出车趟次和总清运量，排个名」
3. 「最近 3 天哪些车发生了超速预警」
4. 「查各区域本月的清运量排行」
5. 「查浙A·12345 这辆车今天的磅单明细」

---

## 3. 功能需求（FR）

| 编号 | 功能 | 说明 |
|---|---|---|
| FR1 | 自然语言转 SQL | 输入自然语言，输出可执行的标准 SELECT |
| FR2 | Schema 感知 | TableSchemaTool 自动检索相关表结构注入 Prompt，杜绝幻表/幻列 |
| FR3 | 语法 / 安全校验 | 黑名单拦截高危操作 + 表名白名单 + 强制 LIMIT |
| FR4 | 执行与可视化 | 表格 / ECharts 图表 / Markdown 摘要多形态渲染 |
| FR5 | Excel 导出 + OSS | exceljs 生成，OSS 预签名 URL（10 分钟有效）一键下载 |
| FR6 | 审计日志 | LangChain Callback 记录全流程，便于排查复盘 |
| FR7 | SQL 编辑器集成 | Monaco Editor 展示并允许编辑生成 SQL |

## 4. 非功能需求（NFR）
- **准确性**：Few-Shot + 真实 Schema 注入，约束 JOIN / 日期 / LIMIT 规范。
- **安全性**：只读（仅 SELECT）、表白名单、参数化查询防注入、OSS 预签名防泄露。
- **性能**：生成温度 0.1 降随机性；强制 LIMIT 防全表扫描。
- **可观测**：全流程审计；导出 / 上传失败不影响主流程（降级）。
- **可维护**：表结构、Few-Shot、白名单均配置化，研发可迭代。

---

## 5. 业务模块拆解（Business Breakdown）

按职责切分为 **6 大模块**，对应「语义理解 → Schema 感知 → 生成 → 安全执行 → 渲染导出 → 审计」：

### 模块一：语义理解层
- **意图识别 / 关键词 → 表匹配**：把「西湖区 + 清运量」映射到 `t_route_manifest / t_region`。
- **实体抽取**：区域名、车牌号、时间窗、垃圾类型（厨余/可回收/其他）、预警类型。
- **（可选）歧义澄清**：多轮追问补充维度（如「哪个区域？」）。

### 模块二：Schema 感知层（TableSchemaTool）
- **元数据管理**：表名、字段说明、关联关系（硬编码或 DB 维护，本方案硬编码 `TABLE_METADATA`）。
- **检索打分**：关键词 → 相关表打分排序，取 Top3 注入上下文。
- **Prompt 注入**：将表结构文本拼进生成模板。

### 模块三：NL2SQL 生成层（FewShot + LLM）
- **Few-Shot 模板**：内置 5 个覆盖常见场景的自然语言↔SQL 示例。
- **生成规范**：仅 SELECT、日期规范（CURDATE/DATE_SUB）、JOIN 规范、默认 LIMIT 1000、时间倒序。
- **LLM 调用**：`ChatOpenAI`（temperature=0.1，降随机性）。

### 模块四：安全与执行层
- **SecurityValidator**：黑名单（DELETE/DROP/...）+ 白名单（5 张表）+ 强制 LIMIT。
- **SQL 执行器**：参数化查询，防注入。
- **结果格式化**：转为 JSON 配置（见 `output-config-spec.md`）。

### 模块五：渲染与导出层
- **JSON Config 输出**：`components[]` 按 `type` 分发。
- **前端渲染器**：`markdown / image / table / echarts / excel_download` 分发。
- **Excel 导出**：exceljs，限 1 万行防 OOM；OSS 预签名 URL 下载。

### 模块六：审计层（Callback）
- LangChain `CallbackHandler` 记录「提问 → 表 → SQL → 校验 → 执行 → 导出」全链路。

---

## 6. 端到端数据流

```
用户提问
  │
  ▼
[TableSchemaTool] ── 检索相关表结构 ──┐
  │                                   │
  ▼                                   ▼
[FewShotPrompt + LLM] ── 生成 SQL ──► [SecurityValidator]
                                        │ (黑名单/白名单/强制LIMIT)
                                        ▼
                                   [SQL 执行器]
                                        │
                                        ▼
                              [结果格式化 → OutputConfig(JSON)]
                                        │
                  ┌─────────────────────┼─────────────────────┐
                  ▼                     ▼                       ▼
            [前端 ResultRenderer]   [Excel 导出]          [OSS 上传]
            (按 type 分发渲染)       (exceljs)            (预签名URL)
```

---

## 7. 数据模型（垃圾清运核心 4 表）

| 表 | 含义 | 关键字段 | 关联 |
|---|---|---|---|
| `t_route_manifest` | 清运路单 | id, vehicle_id, region_id, route_date, total_weight, total_trips, status | → t_vehicle, → t_region |
| `t_weigh_bill` | 磅单（进出场称重） | id, manifest_id, vehicle_id, weigh_in/out_time, weight, waste_type | → t_route_manifest, → t_vehicle |
| `t_vehicle` | 车辆 | id, plate_number, vehicle_type, region_id, status | → t_region |
| `t_alert` | 预警事件 | id, vehicle_id, alert_type, alert_time, severity, status | → t_vehicle |

> ⚠️ 原文档中 `t_region` 被引用（关联 / 白名单）但未给出建表 DDL，落地时需补齐区域维表。

---

## 8. 关键风险与对策

| 阶段 | 风险 | 对策 |
|---|---|---|
| LLM 生成 | 幻表 / 幻列 | TableSchemaTool 注入真实结构 |
| SQL 安全 | DELETE/DROP 漏网 | 黑名单 + 白名单 + 强制 LIMIT |
| SQL 准确性 | JOIN / 关联关系错 | Few-Shot 覆盖常见 JOIN；关联关系速查表 |
| 输出稳定性 | 格式不固定 | 强制 LIMIT、正则抽取 ```sql``` 块 |
| 大表查询 | 全表扫描 | 自动追加 LIMIT 1000 |
| Excel 导出 | 数据量过大 OOM | 限制 1 万行 + 提示 |
| OSS 安全 | 文件公开泄露 | 预签名 URL（10 分钟有效） |
| 异常降级 | 导出 / 上传失败 | try/catch 不影响主流程结果返回 |

---

## 9. JSON 输出配置（前端 type 分发）

查询结果统一以 JSON 配置返回，前端 `ResultRenderer` 按 `components[].type` 分发到对应组件。**完整 Schema 与字段定义见 `output-config-spec.md`。**

支持的类型：
- `markdown` —— 文本摘要
- `image` —— 图片（业务图 / 图表截图）
- `table` —— 数据表格
- `echarts` —— ECharts 图表
- `excel_download` —— Excel 下载按钮

---

## 10. 实施里程碑建议

- **MVP（P0）**：FR1+FR2+FR3+FR4（table+markdown）+ FR6。先跑通「提问→SQL→表格」。
- **增强（P1）**：FR4 的 echarts 可视化 + FR5 Excel/OSS。
- **进阶（P2）**：多轮澄清、方言适配（PG/Hive/ClickHouse）、Schema 元数据库化、权限按人隔离。

---

## 11. 与面试考察要点的对应

| 考察要点 | 本项目落点 |
|---|---|
| LangChain.js 自定义 Tool 开发 | `TableSchemaTool extends StructuredTool` |
| 结构化数据提示词 + Few-Shot | `FewShotChatMessagePromptTemplate` + 5 示例 |
| 大模型输出准确性与格式约束 | 生成规范 + 正则抽取 + 强制 LIMIT |
| 前端 SQL 编辑器与可视化集成 | Monaco + ECharts + 动态组件分发 |
| 安全与格式约束 | SecurityValidator 黑名单/白名单 |
