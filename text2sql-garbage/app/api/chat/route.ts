import { query } from '@/lib/db';
import { renderGlobalHints } from '@/lib/schema';
import { validateSQL } from '@/lib/validator';
import { PromptTemplate, ChatPromptTemplate, FewShotChatMessagePromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { NextRequest } from 'next/server';
import { TableSchemaTool } from '@/lib/tools/table-schema-tool';
import { AuditCallbackHandler } from '@/lib/audit';
import z from 'zod';

// 后端返回给前端的完整结果结构（与前端 types.ts 中的 OutputConfig 对齐）
type ComponentType = 'markdown' | 'image' | 'table' | 'echarts' | 'excel_download';
type OutputComponent = { type: ComponentType; data: any };
type OutputConfig = {
  sql: string;
  title: string;
  summary: string;
  components: OutputComponent[];
};

const modelName = process.env.MODEL_NAME;
const apiKey = process.env.API_KEY;
const baseURL = process.env.BASE_URL;

const llm = new ChatOpenAI({
  model: modelName,
  temperature: 0.1,
  streaming: true,
  maxRetries: 2,
  apiKey,
  configuration: {
    baseURL,
  },
});

// 输出 JSON 的 Zod Schema（用于结构化校验 LLM 输出）
const OutputComponentSchema = z.object({
  type: z.enum(['markdown', 'image', 'table', 'echarts', 'excel_download']),
  data: z.any(),
});
const OutConfigSchema = z.object({
  sql: z.string(),
  title: z.string(),
  summary: z.string(),
  components: z.array(OutputComponentSchema),
});

type LlmOutput = z.infer<typeof OutConfigSchema>;

/** 从 LLM 全文里捞出 JSON 片段：优先 ```json 代码块，其次第一个 { ... } */
function extractJsonText(fullText: string): string | null {
  const block = fullText.match(/```json\s*([\s\S]*?)```/i);
  if (block) return block[1].trim();
  const brace = fullText.match(/\{[\s\S]*\}/);
  return brace ? brace[0] : null;
}

/** LLM 返回的 message.content 在部分模型/版本下是 content block 数组，统一成字符串 */
function chunkToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }
  return '';
}

/** BaseMessage → 可传给 ChatOpenAI 的 {role, content} */
function toMessageLike(m: any): { role: 'system' | 'user' | 'assistant'; content: string } {
  const type = typeof m._getType === 'function' ? m._getType() : 'human';
  const role: 'system' | 'user' | 'assistant' =
    type === 'ai' ? 'assistant' : type === 'system' ? 'system' : 'user';
  let content = '';
  if (typeof m.content === 'string') content = m.content;
  else if (Array.isArray(m.content))
    content = m.content.map((c: any) => c?.text ?? '').join('');
  else content = JSON.stringify(m.content);
  return { role, content };
}

/* ────────────── Few-Shot：5 个覆盖高频场景的示例（需求要求 5 例） ────────────── */
// 每个示例的 output 都是完整 JSON，且与"规则 4"结构完全一致，避免模型照着只吐裸 SQL。
const FEW_SHOT: { input: string; output: string }[] = [
  {
    input: '查一下最近 7 天西湖区每天的清运总量',
    output: JSON.stringify({
      sql: "SELECT rm.route_date, SUM(rm.total_weight) AS total_weight FROM t_route_manifest rm JOIN t_region r ON rm.region_id = r.id WHERE r.region_name = '西湖区' AND rm.route_date >= CURRENT_DATE - INTERVAL '7 days' GROUP BY rm.route_date ORDER BY rm.route_date DESC LIMIT 1000",
      title: '最近 7 天西湖区每日清运总量',
      summary: '按日期统计西湖区最近 7 天每日清运总重量（kg）。',
      components: [{ type: 'markdown', data: { content: '西湖区最近 7 天每日清运总量如下，趋势可结合图表查看。' } }],
    }),
  },
  {
    input: '统计上个月所有车辆的出车趟次和总清运量，排个名',
    output: JSON.stringify({
      sql: "SELECT v.plate_number AS 车牌号, SUM(rm.total_trips) AS 出车趟次, SUM(rm.total_weight) AS 总清运量_kg FROM t_route_manifest rm JOIN t_vehicle v ON rm.vehicle_id = v.id WHERE rm.route_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' AND rm.route_date < date_trunc('month', CURRENT_DATE) GROUP BY v.plate_number ORDER BY 总清运量_kg DESC LIMIT 1000",
      title: '上个月各车辆出车趟次与总清运量排行',
      summary: '按车牌聚合上个月出车趟次与总清运量，按清运量降序排名。',
      components: [{ type: 'markdown', data: { content: '上个月各车辆出车趟次与总清运量排名如上。' } }],
    }),
  },
  {
    input: '最近 3 天哪些车发生了超速预警',
    output: JSON.stringify({
      sql: "SELECT a.id, v.plate_number AS 车牌号, a.alert_type AS 预警类型, a.alert_time AS 预警时间 FROM t_alert a JOIN t_vehicle v ON a.vehicle_id = v.id WHERE a.alert_type = '超速' AND a.alert_time >= CURRENT_DATE - INTERVAL '3 days' ORDER BY a.alert_time DESC LIMIT 1000",
      title: '最近 3 天超速预警明细',
      summary: '列出最近 3 天发生超速预警的车辆与预警时间。',
      components: [{ type: 'markdown', data: { content: '最近 3 天超速预警明细如下。' } }],
    }),
  },
  {
    input: '查浙A·12345 这辆车今天的磅单明细',
    output: JSON.stringify({
      sql: "SELECT wb.id AS 磅单号, wb.weight AS 重量_kg, wb.waste_type AS 垃圾类型, rm.route_date AS 清运日期 FROM t_weigh_bill wb JOIN t_route_manifest rm ON wb.manifest_id = rm.id JOIN t_vehicle v ON rm.vehicle_id = v.id WHERE v.plate_number LIKE '%浙A%12345%' AND rm.route_date = CURRENT_DATE ORDER BY wb.id LIMIT 1000",
      title: '浙A·12345 今日磅单明细',
      summary: '查询浙A·12345 今日所有磅单的重量与垃圾类型。',
      components: [{ type: 'markdown', data: { content: '浙A·12345 今日磅单明细如下。' } }],
    }),
  },
  {
    input: '查各区域本月的清运量排行',
    output: JSON.stringify({
      sql: "SELECT r.region_name AS 区域, SUM(rm.total_weight) AS 总清运量_kg FROM t_route_manifest rm JOIN t_region r ON rm.region_id = r.id WHERE rm.route_date >= date_trunc('month', CURRENT_DATE) GROUP BY r.region_name ORDER BY 总清运量_kg DESC LIMIT 1000",
      title: '各区域本月清运量排行',
      summary: '按区域聚合本月清运总量并降序排名。',
      components: [{ type: 'markdown', data: { content: '各区域本月清运量排行如上。' } }],
    }),
  },
];

// System 模板：{tableInfo} 由 TableSchemaTool 检索出的 TopN 表结构 + 全局关联/口径填充。
// ⚠️ 模板正文里的 JSON 示例必须写成 {{ ... }}（f-string 转义），否则会被当成变量占位符。
const SYSTEM_TEMPLATE = `你是一个垃圾清运领域的 SQL 专家。请根据用户的问题和下方提供的「相关表结构」，生成可执行的 PostgreSQL 只读查询。

### 相关表结构（按问题检索出的 Top 表，完整关联关系见下方）：
{tableInfo}

### 规则:
1. 只允许使用 SELECT 语句（可用 WITH ... SELECT 形式的 CTE）。
2. 使用 PostgreSQL 语法：日期区间用 CURRENT_DATE - INTERVAL '7 days'；统计本月/上月用 date_trunc('month', CURRENT_DATE)。不要用 MySQL 的 DATE_SUB / CURDATE。
3. 必须包含 LIMIT，如果没有则自动加上 LIMIT 1000（上限 10000）。
4. 只输出一个 JSON 对象，不要输出任何额外解释文字。JSON 结构为：
   {{ "sql": string, "title": string, "summary": string, "components": [{{ "type": "markdown" | "table" | "echarts" | "excel_download", "data": any }}] }}
5. sql 字段只放生成的 SELECT 语句（末尾不要分号）；components 里只需要一个 markdown 组件（data.content 放简短中文分析摘要）即可，table 与 echarts 数据由后端按查询结果自动生成，不要你提供。
6. 本工具只提供只读查询。若用户要求删除/修改/新增数据、要求建表或改表、或问题与本业务无关：不要生成任何 SQL，也不要改成"展示数据"变相响应。此时令 sql 为空字符串，title 写「无法执行该请求」，summary 说明拒绝原因，components 放一个 markdown 组件解释原因。

### 示例（严格仿照其 JSON 结构与字段命名）
下方对话已给出「用户问题 → 标准答案(JSON)」范例，覆盖区域趋势 / 车辆排行 / 预警明细 / 磅单明细 / 状态聚合等高频场景。`;

/** 构造发给 LLM 的 messages：system + 5 条 few-shot + 用户问题 */
async function buildMessages(userQuestion: string, tableInfo: string) {
  const systemTemplate = PromptTemplate.fromTemplate(SYSTEM_TEMPLATE);
  const examplePrompt = ChatPromptTemplate.fromMessages([
    ['human', '用户问题：{input}'],
    ['ai', '标准答案(JSON)：{output}'],
  ]);
  const fewShotPrompt = new FewShotChatMessagePromptTemplate({
    inputVariables: ['input', 'output'],
    examples: FEW_SHOT,
    examplePrompt,
    exampleSeparator: '\n\n',
  });

  const systemText = await systemTemplate.format({ tableInfo });
  const fewShotMessages = await fewShotPrompt.formatMessages({});

  return [
    { role: 'system' as const, content: systemText },
    ...fewShotMessages.map(toMessageLike),
    { role: 'user' as const, content: userQuestion },
  ];
}

/* ────────────── 从 DB 查询结果构建 table / echarts 组件 ────────────── */

function isNumericColumn(rows: Record<string, any>[], field: string): boolean {
  let hits = 0;
  let total = 0;
  for (const row of rows.slice(0, 40)) {
    const raw = row[field];
    if (raw === null || raw === undefined || raw === '') continue;
    total += 1;
    const v = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
    if (Number.isFinite(v)) hits += 1;
  }
  return total > 0 && hits / total >= 0.8;
}

function buildTableComponent(dbResult: { rows: any[]; fields: { name: string }[] }) {
  if (!dbResult?.rows?.length || !dbResult.fields?.length) return null;
  const columns = dbResult.fields.map((f) => ({ field: f.name, label: f.name }));
  const rows = dbResult.rows.map((row) => {
    const obj: Record<string, any> = {};
    for (const col of columns) obj[col.field] = row[col.field] ?? null;
    return obj;
  });
  return { type: 'table' as const, data: { columns, rows } };
}

function buildEchartsComponent(dbResult: { rows: any[]; fields: { name: string }[] }) {
  if (!dbResult?.rows?.length || !dbResult.fields?.length) return null;
  const rows = dbResult.rows.map((row) => {
    const obj: Record<string, any> = {};
    for (const f of dbResult.fields) obj[f.name] = row[f.name];
    return obj;
  });
  const fieldNames = dbResult.fields.map((f) => f.name);
  const numericFields = fieldNames.filter((f) => isNumericColumn(rows, f));
  if (!numericFields.length) return null;
  const labelField = fieldNames.find((f) => !numericFields.includes(f)) ?? fieldNames[0];
  const valueField = numericFields[0];
  const xAxisData = rows.map((r) => String(r[labelField] ?? ''));
  const seriesData = rows.map((r) => {
    const v = r[valueField];
    return typeof v === 'number' ? v : parseFloat(String(v)) || 0;
  });
  if (xAxisData.length < 2) return null;
  return {
    type: 'echarts' as const,
    data: { chartType: 'bar', title: '查询结果图表', xAxisData, series: [{ name: valueField, data: seriesData }] },
  };
}

/* ────────────── 主入口 ────────────── */

const tableSchemaTool = new TableSchemaTool();

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const userQuestion = messages[messages.length - 1].content;

  const audit = new AuditCallbackHandler(userQuestion);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const enqueue = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          /* 流已关闭 */
        }
      };

      try {
        // 1. TableSchemaTool 检索 TopN 表结构（FR2 落地）
        const relevantSchema = await tableSchemaTool.invoke({ question: userQuestion });
        audit.setSelectedTables(tableSchemaTool.lastPicked);
        const tableInfoString = `${renderGlobalHints()}\n\n${relevantSchema}`;

        // 2. 构造 messages（system + 5 few-shot + 用户问题）
        const llmMessages = await buildMessages(userQuestion, tableInfoString);

        // 3. 调用 LLM：优先 withStructuredOutput(json_mode) 流式，失败回退普通流式 + 正则解析
        let fullText = '';
        const structuredLLM = (() => {
          try {
            return llm.withStructuredOutput(OutConfigSchema, { method: 'json_mode' });
          } catch {
            return null;
          }
        })();

        if (structuredLLM) {
          try {
            const eventStream = await structuredLLM.streamEvents(llmMessages, {
              version: 'v2',
              callbacks: [audit],
            });
            for await (const event of eventStream) {
              if (event.event === 'on_chat_model_stream') {
                const chunk = (event as any).data?.chunk;
                const text =
                  chunk?.text ?? (typeof chunk?.content === 'string' ? chunk.content : '');
                if (text) {
                  fullText += text;
                  enqueue({ type: 'llm_stream', content: text });
                }
              }
            }
          } catch (e) {
            console.warn('[text2sql] withStructuredOutput 流式失败，回退正则解析:', e);
            fullText = '';
            const llmStream = await llm.stream(llmMessages, { callbacks: [audit] });
            for await (const chunk of llmStream) {
              const piece = chunkToText(chunk.content);
              if (!piece) continue;
              fullText += piece;
              enqueue({ type: 'llm_stream', content: piece });
            }
          }
        } else {
          const llmStream = await llm.stream(llmMessages, { callbacks: [audit] });
          for await (const chunk of llmStream) {
            const piece = chunkToText(chunk.content);
            if (!piece) continue;
            fullText += piece;
            enqueue({ type: 'llm_stream', content: piece });
          }
        }

        console.log('[text2sql] LLM 原始输出长度:', fullText.length);

        // 4. 解析 LLM 返回的 JSON（结构化优先，宽松兜底）
        let llmOutput: LlmOutput | null = null;
        const jsonText = extractJsonText(fullText);
        if (jsonText) {
          try {
            llmOutput = OutConfigSchema.parse(JSON.parse(jsonText));
          } catch (err) {
            console.warn('[text2sql] Zod 严格校验未通过，尝试宽松提取:', err);
            try {
              const parsed = JSON.parse(jsonText);
              llmOutput = {
                sql: typeof parsed.sql === 'string' ? parsed.sql : '',
                title: typeof parsed.title === 'string' ? parsed.title : '查询结果',
                summary: typeof parsed.summary === 'string' ? parsed.summary : '',
                components: Array.isArray(parsed.components) ? parsed.components : [],
              };
            } catch (parseErr) {
              console.warn('[text2sql] JSON 解析失败，转入 SQL 正则兜底:', parseErr);
            }
          }
        }

        let safeSql = llmOutput?.sql?.trim() ?? '';
        if (!safeSql) {
          const sqlBlockMatch = fullText.match(/```(?:sql)?\s*\n([\s\S]*?)```/i);
          if (sqlBlockMatch) safeSql = sqlBlockMatch[1].trim();
          else {
            const selectMatch = fullText.match(/(SELECT[\s\S]*?)(?:LIMIT|\s*;?\s*$)/i);
            if (selectMatch) safeSql = selectMatch[1].trim();
          }
          console.warn('[text2sql] 未从 JSON 提取到 SQL，使用全文正则兜底');
        }

        // 5. 拒绝场景：LLM 明确不生成 SQL（删数据/建表/无关问题）
        if (!safeSql) {
          audit.setStatus('refused');
          const llmComponentsRef = Array.isArray(llmOutput?.components)
            ? (llmOutput!.components as OutputComponent[])
            : [];
          const refusal: OutputConfig = {
            sql: '',
            title: llmOutput?.title || '无法执行该请求',
            summary: llmOutput?.summary || '该请求无法转换为只读查询，已拒绝执行。',
            components: llmComponentsRef.length
              ? llmComponentsRef
              : [{ type: 'markdown', data: { content: '抱歉，本工具只提供**只读查询**能力，无法删除、修改或新增数据，也不支持建表改表。请换个查询类的问题试试。' } }],
          };
          console.warn('[text2sql] LLM 未生成 SQL，按拒绝场景返回说明');
          enqueue({ type: 'result', data: refusal });
          return;
        }

        // 6. 安全校验（FR3：黑名单 + 表名白名单 + 强制 LIMIT）
        const validated = validateSQL(safeSql);
        audit.setValidation(validated.valid, validated.sql, validated.error);
        if (!validated.valid) {
          audit.setStatus('rejected_by_validator');
          throw new Error(`SQL 安全校验不通过: ${validated.error}`);
        }
        safeSql = validated.sql!;

        // 7. 执行查询真实数据库
        let dbResult: { rows: any[]; fields: { name: string }[] } | null = null;
        let queryError: string | undefined;
        try {
          const res = await query(safeSql);
          dbResult = { rows: res.rows, fields: res.fields };
          audit.setDb(res.rows.length);
        } catch (err: any) {
          queryError = err.message || String(err);
          audit.setDb(null, queryError);
          console.error('[text2sql] SQL 执行失败:', queryError);
        }

        // 8. 用真实查询结果构建最终 OutputConfig
        const llmComponents: OutputComponent[] = Array.isArray(llmOutput?.components)
          ? llmOutput!.components
          : [];
        let finalComponents: OutputComponent[] = [];

        if (dbResult && dbResult.rows.length > 0) {
          const tableComp = buildTableComponent(dbResult);
          const echartsComp = buildEchartsComponent(dbResult);
          const mdComp = llmComponents.find((c) => c.type === 'markdown');
          if (mdComp) finalComponents.push(mdComp);
          if (tableComp) finalComponents.push(tableComp);
          if (echartsComp) finalComponents.push(echartsComp);
        } else {
          finalComponents = [...llmComponents];
          if (queryError)
            finalComponents.push({ type: 'markdown', data: { content: `⚠️ SQL 执行失败：${queryError}` } });
          else if (dbResult && dbResult.rows.length === 0)
            finalComponents.push({ type: 'markdown', data: { content: '✅ 查询执行成功，但未返回任何数据。' } });
        }

        const outputConfig: OutputConfig = {
          sql: safeSql,
          title: llmOutput?.title || '查询结果',
          summary: (llmOutput?.summary || '') + (queryError ? `\n⚠️ ${queryError}` : ''),
          components: finalComponents,
        };
        audit.setStatus(queryError ? 'exec_error' : 'ok');

        enqueue({ type: 'result', data: outputConfig });
      } catch (error: any) {
        console.error('[text2sql] 处理失败:', error);
        audit.setStatus('error');
        audit.recordError(error?.message || String(error));
        enqueue({ type: 'error', message: error?.message || String(error) });
      } finally {
        // 结束帧：必须发送原始 `data: [DONE]`（前端 page.tsx 与评测脚本均按此判定流结束）
        if (!closed) {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch {
            /* ignore */
          }
        }
        try {
          await audit.flush();
        } catch {
          /* ignore */
        }
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
