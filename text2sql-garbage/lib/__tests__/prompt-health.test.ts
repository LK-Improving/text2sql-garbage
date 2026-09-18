// G8：prompt-template 健康测试
// 守住不变量：SYSTEM_TEMPLATE 只声明 {tableInfo} 一个 f-string 变量，
// 且正文里的 JSON 示例必须写成 {{ ... }}（转义后输出单花括号）。
// 一旦有人把 {{ 误写成 { 或漏写转义，.format() 会抛 "Missing value for input xxx"，
// 这个用例能在 CI（G4 单元测试）里拦下来，避免污染线上。
import { describe, it, expect } from 'vitest';
import { PromptTemplate } from '@langchain/core/prompts';
import { SYSTEM_TEMPLATE } from '@/lib/prompts';

describe('G8 prompt-template health', () => {
  it('SYSTEM_TEMPLATE 只声明 tableInfo 一个变量', () => {
    const tpl = PromptTemplate.fromTemplate(SYSTEM_TEMPLATE);
    expect([...tpl.inputVariables].sort()).toEqual(['tableInfo']);
  });

  it('SYSTEM_TEMPLATE 能正常格式化，且 JSON 示例转义正确', async () => {
    const tpl = PromptTemplate.fromTemplate(SYSTEM_TEMPLATE);
    const out = await tpl.format({ tableInfo: '<<TABLE_INFO>>' });

    // 变量被替换
    expect(out).toContain('<<TABLE_INFO>>');

    // 转义后的 JSON 示例应以单花括号呈现（{{ -> {）
    expect(out).toContain('"sql"');
    expect(out).toContain('"components"');

    // 若有人漏写 {{ 转义，输出里会残留 {{ 或 }}，这里必须没有
    expect(out).not.toContain('{{');
    expect(out).not.toContain('}}');
  });
});
