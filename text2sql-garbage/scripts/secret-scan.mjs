#!/usr/bin/env node
// scripts/secret-scan.mjs
// pre-commit 密钥扫描（零依赖）。扫描暂存文件中的高危密钥，并阻止提交真实 .env。
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SECRET_PATTERNS = [
  { re: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI API Key (sk-...)' },
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key (AKIA...)' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, label: '私钥 (BEGIN PRIVATE KEY)' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, label: 'GitHub Token (ghp_/gho_/...)' },
];

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    console.warn('⚠️ 无法执行 git（可能不在仓库中），跳过密钥扫描。');
    return [];
  }
}

function isRealEnvFile(f) {
  const base = f.split('/').pop().split('\\').pop();
  if (base === '.env') return true;
  if (/^\.env\.[^.]+$/.test(base) && base !== '.env.example') return true;
  return false;
}

const files = getStagedFiles();
let blocked = false;

for (const f of files) {
  if (isRealEnvFile(f)) {
    console.error(`❌ 检测到真实 .env 文件被暂存：${f}（.env 已 gitignore，禁止入库；请用 .env.example）`);
    blocked = true;
    continue;
  }
  if (!existsSync(f)) continue;
  let content = '';
  try {
    content = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(content)) {
      console.error(`❌ 文件 ${f} 命中疑似密钥：${label}`);
      blocked = true;
    }
  }
}

if (blocked) {
  console.error('\n如需跳过（极不推荐），可用 git commit --no-verify。但请先确认没有泄露凭证。');
  process.exit(1);
}
console.log('✅ 密钥扫描通过：未检测到高危凭证或真实 .env 入库。');
process.exit(0);
