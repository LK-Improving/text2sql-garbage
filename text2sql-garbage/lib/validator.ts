// lib/validator.ts —— SQL 安全校验（FR3：黑名单 + 表名白名单 + 强制 LIMIT）
//
// 设计要点：**先剥离字符串字面量与注释，再对"真 SQL 正文"做词法级匹配**。
// 直接对原始 SQL 做 includes('DELETE') 会误杀 `WHERE remark = 'DELETE'`，
// 也会漏掉藏在注释里的 `/* DELETE FROM t_x */`。

import { ALLOWED_TABLES } from './schema';

/** 写操作 / DDL / 破坏性关键字 */
const WRITE_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'MERGE',
  'VACUUM',
  'COPY',
  'LOCK',
  'COMMENT',
  'SET',
  'RESET',
  'CLUSTER',
  'REINDEX',
  'REFRESH',
];

/** 危险函数与系统对象：只读场景下仍可能被用于读文件 / DoS / 元数据探测 */
const DANGEROUS_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bpg_read_file\b/i, reason: '禁止读取服务器文件（pg_read_file）' },
  { pattern: /\bpg_ls_dir\b/i, reason: '禁止遍历目录（pg_ls_dir）' },
  { pattern: /\bpg_sleep\b/i, reason: '禁止耗时函数（pg_sleep）' },
  { pattern: /\blo_import\b|\blo_export\b|\blo_get\b|\blo_put\b/i, reason: '禁止大对象读写' },
  { pattern: /\bdblink\b|\bpostgres_fdw\b/i, reason: '禁止外部数据源连接' },
  { pattern: /\bcopy\b/i, reason: '禁止 COPY（可读写服务端文件）' },
  { pattern: /\binformation_schema\b/i, reason: '禁止访问 information_schema' },
  { pattern: /\bpg_catalog\b/i, reason: '禁止访问 pg_catalog' },
  { pattern: /\bpg_authid\b|\bpg_shadow\b/i, reason: '禁止读取账号凭据表' },
  { pattern: /\bpg_terminate_backend\b|\bpg_cancel_backend\b/i, reason: '禁止终止会话' },
];

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

export type ValidateResult = {
  valid: boolean;
  error?: string;
  sql?: string;
  /** 命中的表名，便于审计与调试 */
  tables?: string[];
};

/**
 * 把字符串字面量与注释替换成占位符，返回"真 SQL 正文"。
 * 单引号字符串 → ''；行注释 / 块注释 → 空格；双引号标识符保留（可能是表名）。
 */
export function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];

    // 行注释 --
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }

    // 块注释 /* ... */，支持嵌套
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out += ' ';
      continue;
    }

    // 单引号字符串，'' 为转义
    if (ch === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += "''";
      continue;
    }

    // 双引号标识符
    if (ch === '"') {
      i += 1;
      let ident = '';
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            ident += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        ident += sql[i];
        i += 1;
      }
      out += `"${ident}"`;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * CTE 名与子查询别名：不是真实表，白名单校验时要排除。
 * 只认 `AS x` 会漏掉 `FROM (SELECT ...) sub` 这种不带 AS 的写法，
 * 只认 `) x` 又会漏掉 CTE，所以两个来源都收集。
 */
function extractPseudoTableNames(body: string): Set<string> {
  const names = new Set<string>();
  let m: RegExpExecArray | null;

  // CTE 名：`WITH x AS (`、`), y AS (`
  // ⚠️ 不能写成 `\b(?:with|,)`：\b 要求一侧是单词字符，而 `),` 的逗号两侧都不是单词字符，
  //    会导致第 2 个及之后的 CTE 全部漏抓（曾把 month_alert 当成真实表误拦）。
  const cteRe = /(?:\bwith|,)\s+"?([a-zA-Z_][\w$]*)"?\s+as\s*\(/gi;
  while ((m = cteRe.exec(body)) !== null) names.add(m[1].toLowerCase());

  // 所有 AS 之后的标识符（CTE、列别名、表别名），统一当别名排除
  const asRe = /\bas\s+"?([a-zA-Z_][\w$]*)"?/gi;
  while ((m = asRe.exec(body)) !== null) names.add(m[1].toLowerCase());

  // 不带 AS 的派生表别名：`FROM (SELECT ...) sub`
  const aliasRe = /\)\s*(?:as\s+)?"?([a-zA-Z_][\w$]*)"?/gi;
  while ((m = aliasRe.exec(body)) !== null) names.add(m[1].toLowerCase());

  return names;
}

/** 提取 FROM / JOIN 之后的表名（去掉 schema 前缀与引号） */
function extractTableNames(body: string): string[] {
  const re = /\b(?:from|join)\s+"?([a-zA-Z_][\w$]*)"?(?:\s*\.\s*"?([a-zA-Z_][\w$]*)"?)?/gi;
  const names: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(body)) !== null) {
    // m[2] 存在说明带了 schema 前缀，取后半段
    const base = (m[2] || m[1]).replace(/"/g, '');
    names.push(base.toLowerCase());
  }

  return names;
}

export function validateSQL(sql: string): ValidateResult {
  const raw = (sql || '').trim();
  if (!raw) return { valid: false, error: 'SQL 为空' };

  // 1) 剥离字面量与注释后再判断
  const body = stripLiteralsAndComments(raw);

  // 2) 单条语句：只允许结尾一个分号
  const withoutTrailing = body.replace(/\s*;+\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return { valid: false, error: '检测到多条语句，仅允许单条 SELECT' };
  }

  // 3) 必须是只读查询：SELECT，或 WITH ... SELECT
  if (!/^(select|with)\b/i.test(withoutTrailing)) {
    return { valid: false, error: '仅允许 SELECT 查询（支持 WITH ... SELECT）' };
  }
  if (/^with\b/i.test(withoutTrailing) && !/\bselect\b/i.test(withoutTrailing)) {
    return { valid: false, error: 'CTE 最终必须是 SELECT 查询' };
  }

  // 3.5) 禁止 SELECT INTO / WITH ... SELECT INTO：它会**创建新表**，属于写操作，
  // 而上文只拦截了 INSERT/UPDATE/... 这类关键字，漏掉了 SELECT 形式的建表。
  if (/\binto\b/i.test(withoutTrailing)) {
    return { valid: false, error: '禁止创建新表（不支持 SELECT INTO）' };
  }

  // 4) 写操作关键字（字符串已剥离，不会误杀）
  const upper = withoutTrailing.toUpperCase();
  for (const keyword of WRITE_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(upper)) {
      return { valid: false, error: `禁止的操作：${keyword}` };
    }
  }

  // 5) 危险函数与系统对象
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(withoutTrailing)) {
      return { valid: false, error: reason };
    }
  }

  // 6) 表名白名单
  const pseudo = extractPseudoTableNames(withoutTrailing);
  const tableNames = extractTableNames(withoutTrailing).filter((name) => !pseudo.has(name));
  const allowed = new Set(ALLOWED_TABLES.map((t) => t.toLowerCase()));

  if (!tableNames.length) {
    return { valid: false, error: '未识别到任何数据表' };
  }
  const illegal = tableNames.filter((name) => !allowed.has(name));
  if (illegal.length) {
    return {
      valid: false,
      error: `不允许访问的表：${[...new Set(illegal)].join('、')}（白名单：${ALLOWED_TABLES.join('、')}）`,
    };
  }

  // 7) 强制 LIMIT：没有就补，超上限就收敛
  //    先剥掉结尾的行注释，否则 `-- 说明` 会把追加的 LIMIT 吞进注释里（LIMIT 失效、可返回全表）。
  let finalSql = raw.replace(/\s*;+\s*$/, '').replace(/--[^\n]*$/, '').trim();
  const limitMatch = /\bLIMIT\s+(\d+)\b/i.exec(withoutTrailing);
  if (!limitMatch) {
    finalSql += ` LIMIT ${DEFAULT_LIMIT}`;
  } else if (Number(limitMatch[1]) > MAX_LIMIT) {
    finalSql = finalSql.replace(/\bLIMIT\s+\d+\b/i, `LIMIT ${MAX_LIMIT}`);
  }

  return { valid: true, sql: finalSql, tables: [...new Set(tableNames)] };
}
