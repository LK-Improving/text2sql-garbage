#!/usr/bin/env node
// scripts/setup-git-hooks.mjs  （pnpm prepare 自动执行）
// 将 .githooks/pre-commit 安装到 .git/hooks/pre-commit（零依赖，不引入 husky）。
import { copyFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, '.githooks', 'pre-commit');
const hooksDir = resolve(root, '.git', 'hooks');
const dest = resolve(hooksDir, 'pre-commit');

try {
  if (!existsSync(src)) {
    console.log('[setup-git-hooks] 未找到 .githooks/pre-commit，跳过。');
    process.exit(0);
  }
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  copyFileSync(src, dest);
  try {
    chmodSync(dest, 0o755);
  } catch {
    /* Windows 上 chmod 可能无效，忽略 */
  }
  console.log('[setup-git-hooks] pre-commit hook 已安装 → .git/hooks/pre-commit');
} catch (e) {
  console.warn('[setup-git-hooks] 安装 hook 失败（不影响依赖安装）：', e.message);
}
process.exit(0);
