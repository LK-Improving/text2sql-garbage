import { query } from '@/lib/db';
import { renderGlobalHints } from '@/lib/schema';
import { validateSQL } from '@/lib/validator';
import { PromptTemplate, ChatPromptTemplate, FewShotChatMessagePromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { NextRequest } from 'next/server';
import { TableSchemaTool } from '@/lib/tools/table-schema-tool';
import { AuditCallbackHandler } from '@/lib/audit';
import z from 'zod';
import { buildResultComponents } from '@/lib/result-builder';
import { makeCacheKey, getCachedPlan, setCachedPlan } from '@/lib/sql-cache';
import { formatErrorHint } from '@/lib/error-hints';
import { SYSTEM_TEMPLATE } from '@/lib/prompts';

// 后端返回给前端的完整结果结构（与前端 types.ts 中的 OutputConfig 对齐）
type ComponentType = 'markdown' | 'image' | 'table' | 'echarts' | 'excel_download';
type OutputComponent = { type: ComponentType; data: any };
/** 响应遥测（P2-1）：性能面板/前端徽标用，缺省时前端忽略 */
type Telemetry = { cacheHit: boolean; ttftMs?: number; totalMs?: number };
type OutputConfig = {
  sql: string;
  title: string;
  summary: string;
  components: OutputComponent[];
  telemetry?: Telemetry;
};

/** 对话历史消息（P2-2 多轮对话） */
type HistoryMessage = { role: string; content: string };

const modelName = process.env.MODEL_NAME;
const apiKey = process.env.API_KEY;
const baseURL = process.env.BASE_URL;

const llm = new ChatOpenAI({
  model: modelName,
  temperature: 0,
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

/* ────────────── Few-Shot：9 个覆盖高频场景的示例（需求原要求 5 例；增 1 例强化「按日二维聚合」、增 1 例强化「平均每天=度量折叠日期」、增 1 例强化「既…又…=交集」、增 1 例强化「时间范围内的量默认按天拆解」） ────────────── */
// 每个示例的 output 都是完整 JSON，且与"规则 4"结构完全一致，避免模型照着只吐裸 SQL。
const FEW_SHOT: { input: string; output: string }[] = [
  {
    input: '上个月每个区每天的平均清运量是多少',
    output: JSON.stringify({
      sql: "SELECT r.region_name AS 区域, rm.route_date AS 日期, AVG(rm.total_weight) AS 日均清运量_kg FROM t_route_manifest rm JOIN t_region r ON rm.region_id = r.id WHERE rm.route_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month' AND rm.route_date < date_trunc('month', CURRENT_DATE) GROUP BY r.region_name, rm.route_date ORDER BY r.region_name, rm.route_date LIMIT 1000",
      title: '上个月各区域每日平均清运量',
      summary: '按「区域 × 日期」二维粒度统计上个月每日平均清运量（kg），不要把日期维度再聚合掉。',
      components: [{ type: 'markdown', data: { content: '上个月各区域每日平均清运量如下。' } }],
    }),
  },
  {
    input: '每辆车平均每天的清运量是多少',
    output: JSON.stringify({
      sql: "SELECT v.plate_number AS 车牌号, SUM(rm.total_weight) * 1.0 / COUNT(DISTINCT rm.route_date) AS 日均清运量_kg FROM t_route_manifest rm JOIN t_vehicle v ON rm.vehicle_id = v.id GROUP BY v.plate_number ORDER BY 日均清运量_kg DESC LIMIT 1000",
      title: '各车辆平均每日清运量',
      summary: '按车牌聚合，用总清运量除以有清运记录的天数得到「平均每车每天」清运量（kg）；日期维度已折叠，每车一行。',
      components: [{ type: 'markdown', data: { content: '各车辆平均每日清运量如下。' } }],
    }),
  },
  {
    input: '这个月既有超速预警、清运量又排前 5 的车',
    output: JSON.stringify({
      sql: "WITH top5 AS (SELECT v.id, v.plate_number, SUM(rm.total_weight) AS total_weight FROM t_route_manifest rm JOIN t_vehicle v ON rm.vehicle_id = v.id WHERE rm.route_date >= date_trunc('month', CURRENT_DATE) GROUP BY v.id, v.plate_number ORDER BY total_weight DESC LIMIT 5), overspeed AS (SELECT DISTINCT vehicle_id FROM t_alert WHERE alert_type = '超速' AND alert_time >= date_trunc('month', CURRENT_DATE)) SELECT t.plate_number AS 车牌号, t.total_weight AS 本月清运量_kg FROM top5 t JOIN overspeed o ON t.id = o.vehicle_id ORDER BY t.total_weight DESC LIMIT 1000",
      title: '本月超速预警且清运量 Top5 的车辆',
      summary: '先取本月清运量前 5 的车，再与「本月有超速预警」的车辆取交集（「既…又…」= 交集语义），得到既超速预警、清运量又进前 5 的车。',
      components: [{ type: 'markdown', data: { content: '本月超速预警且清运量 Top5 的车辆如下。' } }],
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
      sql: "SELECT wb.id AS 磅单号, wb.weight AS 重量_kg, wb.waste_type AS 垃圾类型, rm.route_date AS 清运日期 FROM t_weigh_bill wb JOIN t_route_manifest rm ON wb.manifest_id = rm.id JOIN t_vehicle v ON rm.vehicle_id = v.id WHERE v.plate_number = '浙A·12345' AND rm.route_date = CURRENT_DATE ORDER BY wb.id LIMIT 1000",
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
    input: '查下西湖最近一周的垃圾量',
    output: JSON.stringify({
      sql: "SELECT rm.route_date AS 日期, SUM(rm.total_weight) AS 清运量_kg FROM t_route_manifest rm JOIN t_region r ON rm.region_id = r.id WHERE r.region_name = '西湖区' AND rm.route_date >= CURRENT_DATE - INTERVAL '7 days' GROUP BY rm.route_date ORDER BY rm.route_date LIMIT 1000",
      title: '西湖区最近一周每日清运量',
      summary: '按天拆解西湖区最近 7 天每日清运量（kg），呈现趋势而非只给一个总和。',
      components: [{ type: 'markdown', data: { content: '西湖区最近一周每日清运量如下。' } }],
    }),
  },
];

// System 模板已抽到 @/lib/prompts.ts（SYSTEM_TEMPLATE），便于 G8 单测校验 f-string 变量。

/** 构造发给 LLM 的 messages：system + 5 条 few-shot + 对话历史 + 用户问题 */
async function buildMessages(
  userQuestion: string,
  tableInfo: string,
  history: HistoryMessage[] = [],
) {
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

  // P2-2：把最近几轮对话夹在 few-shot 与当前问题之间，让模型能解析「那上个月呢」这类指代。
  // 只保留最后 4 条（约 2 轮），避免历史无限增长撑爆上下文。
  const historyMessages = history
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-4)
    .map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content,
    }));

  return [
    { role: 'system' as const, content: systemText },
    ...fewShotMessages.map(toMessageLike),
    ...historyMessages,
    { role: 'user' as const, content: userQuestion },
  ];
}

/* ────────────── 主入口 ────────────── */

const tableSchemaTool = new TableSchemaTool();

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const lastMessage = Array.isArray(messages) ? messages[messages.length - 1] : null;
  const userQuestion = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
  // P2-2：除最后一条用户提问外的即对话历史（前端只上传最近 1~2 轮）
  const history: HistoryMessage[] = Array.isArray(messages)
    ? messages
        .slice(0, -1)
        .filter((m: any) => m && typeof m?.content === 'string')
        .map((m: any) => ({ role: String(m.role ?? 'user'), content: String(m.content) }))
    : [];

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
        // P2-2：用「最近几问 + 当前问题」一起做检索，指代型追问（「那上个月呢」）也能命中正确的表。
        const recentUserQuestions = history
          .filter((m) => m.role !== 'assistant')
          .slice(-2)
          .map((m) => m.content);
        const retrievalQuery = [...recentUserQuestions, userQuestion].join(' ');
        const relevantSchema = await tableSchemaTool.invoke({ question: retrievalQuery });
        audit.setSelectedTables(tableSchemaTool.lastPicked);
        const tableInfoString = `${renderGlobalHints()}\n\n${relevantSchema}`;

        // 2. P2-1：先查 SQL 生成缓存。命中即跳过 LLM（链路里最慢的一步），复用上次的计划。
        //    缓存 key 带上历史签名，避免多轮里同一句话在不同上下文命中错误的 SQL。
        const historySignature = history.map((m) => `${m.role}:${m.content}`).join('|');
        const cacheKey = makeCacheKey(userQuestion, historySignature);
        const cached = getCachedPlan(cacheKey);

        let llmOutput: LlmOutput | null = null;
        let fullText = '';

        if (cached) {
          audit.setCacheHit(true, cacheKey);
          llmOutput = cached.plan as LlmOutput;
          console.log(
            `[text2sql] 命中 SQL 缓存（${Math.round(cached.ageMs / 1000)}s 前），跳过 LLM`,
          );
        } else {
          audit.setCacheHit(false, cacheKey);

          // 3. 构造 messages（system + 5 few-shot + 对话历史 + 用户问题）
          const llmMessages = await buildMessages(userQuestion, tableInfoString, history);

          // 4. 调用 LLM：优先 withStructuredOutput(json_mode) 流式，失败回退普通流式 + 正则解析
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
                    audit.markFirstToken(); // P2-1：TTFT 埋点
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
                audit.markFirstToken();
                fullText += piece;
                enqueue({ type: 'llm_stream', content: piece });
              }
            }
          } else {
            const llmStream = await llm.stream(llmMessages, { callbacks: [audit] });
            for await (const chunk of llmStream) {
              const piece = chunkToText(chunk.content);
              if (!piece) continue;
              audit.markFirstToken();
              fullText += piece;
              enqueue({ type: 'llm_stream', content: piece });
            }
          }
          audit.markLlmDone();

          console.log('[text2sql] LLM 原始输出长度:', fullText.length);

          // 5. 解析 LLM 返回的 JSON（结构化优先，宽松兜底）
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
        }

        let safeSql = llmOutput?.sql?.trim() ?? '';
        if (!safeSql && fullText) {
          const sqlBlockMatch = fullText.match(/```(?:sql)?\s*\n([\s\S]*?)```/i);
          if (sqlBlockMatch) safeSql = sqlBlockMatch[1].trim();
          else {
            const selectMatch = fullText.match(/(SELECT[\s\S]*?)(?:LIMIT|\s*;?\s*$)/i);
            if (selectMatch) safeSql = selectMatch[1].trim();
          }
          console.warn('[text2sql] 未从 JSON 提取到 SQL，使用全文正则兜底');
        }

        // 6. 拒绝场景：LLM 明确不生成 SQL（删数据/建表/无关问题）
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
            telemetry: audit.timing(),
          };
          console.warn('[text2sql] LLM 未生成 SQL，按拒绝场景返回说明');
          enqueue({ type: 'result', data: refusal });
          return;
        }

        // 7. 安全校验（FR3：黑名单 + 表名白名单 + 强制 LIMIT）
        //    命中即代表请求越界（写操作 / 非白名单表 / 多语句等）。这里**不再抛 error 事件**，
        //    而是像「LLM 主动返回空 SQL」那样走优雅拒绝（result 事件 + 中文说明），
        //    前端统一渲染成正常完成态，不会弹出「系统出错」红框。error 事件只保留给真正的意外异常。
        const validated = validateSQL(safeSql);
        audit.setValidation(validated.valid, validated.sql, validated.error);
        if (!validated.valid) {
          audit.setStatus('rejected_by_validator');
          const hint = formatErrorHint(validated.error || '安全校验不通过');
          const refusal: OutputConfig = {
            sql: '',
            title: '请求已被安全校验拦截',
            summary: `${hint.hint.label}：${hint.hint.message}`,
            components: [
              { type: 'markdown', data: { content: hint.markdown } },
            ],
            telemetry: audit.timing(),
          };
          enqueue({ type: 'result', data: refusal });
          return;
        }
        safeSql = validated.sql!;

        // P2-1：走到这里说明 SQL 已通过安全校验，可以把「问题 → 计划」写入缓存。
        // 缓存的是 SQL 计划而非查询结果，命中后仍会重新查库，数据实时性不受影响。
        setCachedPlan(cacheKey, {
          sql: safeSql,
          title: llmOutput?.title || '查询结果',
          summary: llmOutput?.summary || '',
          components: Array.isArray(llmOutput?.components) ? llmOutput!.components : [],
        });

        // 8. 执行查询真实数据库
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

        // 9. 用真实查询结果构建最终 OutputConfig
        const llmComponents: OutputComponent[] = Array.isArray(llmOutput?.components)
          ? llmOutput!.components
          : [];
        let finalComponents: OutputComponent[] = [];

        if (dbResult && dbResult.rows.length > 0) {
          const mdComp = llmComponents.find((c) => c.type === 'markdown');
          if (mdComp) finalComponents.push(mdComp);
          finalComponents.push(...buildResultComponents(dbResult));
        } else {
          finalComponents = [...llmComponents];
          if (queryError) {
            // P2-3：把原始英文报错归类成「类别 + 说明 + 建议」，运营才看得懂
            const { markdown } = formatErrorHint(queryError);
            finalComponents.push({ type: 'markdown', data: { content: markdown } });
          } else if (dbResult && dbResult.rows.length === 0) {
            finalComponents.push({ type: 'markdown', data: { content: '✅ 查询执行成功，但未返回任何数据。' } });
          }
        }

        const errorHint = queryError ? formatErrorHint(queryError).hint : null;
        const outputConfig: OutputConfig = {
          sql: safeSql,
          title: llmOutput?.title || '查询结果',
          summary:
            (llmOutput?.summary || '') + (errorHint ? `\n⚠️ ${errorHint.label}：${errorHint.message}` : ''),
          components: finalComponents,
          telemetry: audit.timing(),
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
