// lib/audit.ts
//
// FR6 审计日志：实现 LangChain.js 的 BaseCallbackHandler，
// 记录「提问 → 候选表 → 生成 SQL → 安全校验 → 执行 → 行数 → 导出」全链路，
// 落盘 logs/audit-YYYY-MM-DD.jsonl。
//
// 用途：
//   - 可观测性 / 全链路追踪（面试可讲"可观测性"）；
//   - 线上问题排查的唯一依据（哪一步开始错、错在哪条 SQL）；
//   - 配合 LLM 回调拿到 token 用量与耗时。
//
// 注意：LLM 相关的钩子（handleLLMStart/End/Error）由 LangChain 在把本 handler 作为
// callbacks 传入 llm 调用时自动触发；业务步骤（候选表/校验/执行）由 route 显式调用
// setXxx 方法补充记录。

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import fs from 'node:fs';
import path from 'node:path';

type AuditRecord = {
  question: string;
  startedAt: string;
  finishedAt?: string;
  selectedTables?: string[];
  sql?: string;
  valid?: boolean;
  validationError?: string;
  dbRows?: number | null;
  dbError?: string;
  status?: string;
  llmTokens?: { prompt?: number; completion?: number; total?: number };
  latencyMs?: number;
  error?: string;
};

export class AuditCallbackHandler extends BaseCallbackHandler {
  name = 'text2sql-audit';

  private record: AuditRecord;
  private logDir = path.resolve(process.cwd(), 'logs');

  constructor(question: string) {
    super();
    this.record = {
      question,
      startedAt: new Date().toISOString(),
    };
  }

  /* ── LangChain 自动回调：LLM 生命周期 ── */

  handleLLMStart(): Promise<void> {
    return Promise.resolve();
  }

  handleLLMEnd(output: unknown): Promise<void> {
    try {
      const llmOutput = (output as { llmOutput?: any })?.llmOutput;
      const usage =
        llmOutput?.tokenUsage ?? llmOutput?.usage ?? llmOutput?.token_usage ?? null;
      if (usage) {
        this.record.llmTokens = {
          prompt: usage.promptTokens ?? usage.prompt_tokens ?? undefined,
          completion: usage.completionTokens ?? usage.completion_tokens ?? undefined,
          total: usage.totalTokens ?? usage.total_tokens ?? undefined,
        };
      }
    } catch {
      /* 解析失败不阻断主流程 */
    }
    return Promise.resolve();
  }

  handleLLMError(err: unknown): Promise<void> {
    this.record.error = err instanceof Error ? err.message : String(err);
    return Promise.resolve();
  }

  /* ── 业务步骤：由 route 显式调用补充记录 ── */

  setSelectedTables(tables: string[]): void {
    this.record.selectedTables = tables;
  }

  setValidation(valid: boolean, sql?: string, error?: string): void {
    this.record.valid = valid;
    this.record.sql = sql;
    this.record.validationError = error;
  }

  setDb(rows: number | null, error?: string): void {
    this.record.dbRows = rows;
    this.record.dbError = error;
  }

  setStatus(status: string): void {
    this.record.status = status;
  }

  /** 记录整体错误（非 LLM 回调触发的异常） */
  recordError(message: string): void {
    this.record.error = message;
  }

  /** 落盘单条 JSONL 审计记录 */
  async flush(): Promise<void> {
    this.record.finishedAt = new Date().toISOString();
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      const file = path.join(this.logDir, `audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
      const line = JSON.stringify(this.record, (_k, v) => (v === undefined ? null : v));
      fs.appendFileSync(file, line + '\n', 'utf8');
    } catch (e) {
      console.warn('[audit] 写入审计日志失败：', e);
    }
  }
}
