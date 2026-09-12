// lib/tools/table-schema-tool.ts
//
// FR2 的真正落地：TableSchemaTool 继承 LangChain.js 的 StructuredTool，
// 输入自然语言问题，按「关键词命中」对表打分排序，取 TopN 表结构注入 prompt，
// 从而杜绝幻表/幻列，同时让 prompt 显著变短（5 张全量 → Top3），改善响应耗时（见 P2-1）。
//
// 面试可讲点：
//   - 自定义 Tool 开发（extends StructuredTool + zod schema 输入约束）
//   - 关键词打分检索这种"确定性"检索 vs 让 LLM 自己选表的区别（更快、更可控、可解释）

import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { TABLE_METADATA, renderTables, type TableMeta } from '../schema';

export class TableSchemaTool extends StructuredTool {
  name = 'table_schema_retriever';
  description =
    '根据用户自然语言问题，检索最相关的若干张表的结构（字段名、类型、业务说明），用于注入 NL2SQL 提示词，杜绝幻表/幻列。' +
    '输入用户原始问题，输出命中表的精简 schema 文本（含字段名、类型、业务说明）。仅在需要生成 SQL 前调用。';

  // 结构化输入：问题 + 可选 topK
  schema = z.object({
    question: z.string().describe('用户的自然语言查询问题'),
    topK: z
      .number()
      .min(1)
      .max(5)
      .optional()
      .default(3)
      .describe('返回最相关的表数量，默认 3'),
  });

  /** 最近一次命中的表名，供审计日志使用 */
  lastPicked: string[] = [];

  async _call(input: { question: string; topK?: number }): Promise<string> {
    const q = (input.question || '').toLowerCase();

    // 1) 关键词命中打分：命中表自身 keywords 记 1 分；问题中直接出现表名强制 +5 分
    const scored = Object.values(TABLE_METADATA).map((t) => {
      let score = 0;
      for (const kw of t.keywords) {
        if (kw && q.includes(kw.toLowerCase())) score += 1;
      }
      if (q.includes(t.name.toLowerCase())) score += 5;
      return { t, score };
    });

    const total = scored.reduce((s, x) => s + x.score, 0);
    let picked: TableMeta[];

    if (total === 0) {
      // 模糊问题（一个关键词都没命中）：返回全部表，宁多勿漏
      picked = scored.map((x) => x.t);
    } else {
      picked = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, input.topK ?? 3)
        .map((x) => x.t);
    }

    // 2) 始终保留核心事实表 t_route_manifest：绝大多数统计（清运量/趟次/趋势）都依赖它，
    //    即便关键词没打中也要兜底带上，避免"明明问的是清运量却把事实表排到 Top3 之外"。
    const factTable = TABLE_METADATA.t_route_manifest;
    if (factTable && !picked.find((t) => t.name === factTable.name)) {
      picked = [factTable, ...picked].slice(0, (input.topK ?? 3) + 1);
    }

    this.lastPicked = picked.map((t) => t.name);
    return renderTables(picked);
  }
}
