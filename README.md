# text2sql-garbage · 垃圾清运领域 Text-to-SQL

面向**无代码基础的运营/产品**的对话式查数工具：用自然语言提问，自动生成并执行 PostgreSQL SQL，
返回表格 / 图表 / Excel。基于 **LangChain.js + Next.js 16**。

> 同时是面试作品：考察点见 `requirements-breakdown.md` 第 11 节（自定义 Tool、Few-Shot、输出约束、Monaco+ECharts、SecurityValidator）。

## 技术栈

Next.js 16 · React 19 · Tailwind v4 · LangChain 1.x · PostgreSQL(`pg`) · 评测用 DeepSeek 兼容端点 · 部署 Netlify + Supabase

## CI / CD 状态

![CI](https://github.com/LK-Improving/text2sql-garbage/actions/workflows/ci.yml/badge.svg)
![Deploy](https://github.com/LK-Improving/text2sql-garbage/actions/workflows/deploy.yml/badge.svg)

| 流水线 | 触发 | 门禁 |
|---|---|---|
| `CI` | push/PR → master | G1 安装 · G2 Lint · G3 类型 · G4 单测(+G8) · G5 构建 · G6 schema 一致性 · **G7 评测(真实模型)** |
| `Deploy` | PR→预览 / CI 成功后 push master→生产 | Netlify CLI，受 CI 门禁卡控 |
| `DB Setup` | 手动 `workflow_dispatch` | 灌 Supabase 云库 |

## 快速开始（本地）

```bash
cd text2sql-garbage
cp .env.example .env        # 填 MODEL_NAME/API_KEY/BASE_URL/DATABASE_URL
pnpm install
pnpm dev                    # http://localhost:3000
```

本地需一个 Postgres（`postgresql://postgres:root@localhost:5432/garbage_db`），建表+种子：

```bash
pnpm seed:db                # 执行仓库根 test-data/schema.sql + seed.sql（幂等 DROP+CREATE）
```

## 本地复现评测（G7）

评测门禁在 CI 的 Postgres service container 上跑真实模型；本地可用同一份脚本复现：

```bash
# 1) 起一个本地 Postgres 并灌库
pnpm seed:db
# 2) 起服务
pnpm start                  # 另开终端
# 3) 跑 41 条评测集并断言阈值
pnpm eval                   # 生成 test-data/eval-result-*.json
pnpm eval:gate              # 校验 execRate≥95 / answerAcc≥90 / p95<5，不达标 exit 1
```

阈值与口径见 `requirements-breakdown.md` 的 NFR；评测确定性靠 `temperature:0` + 每次全新进程（缓存天然空）。

## 部署 Runbook（Netlify + Supabase）

> 选型：前端 Netlify（国内访问更稳），云库 Supabase（PostgreSQL，与 Netlify 解耦）。
> 全程 Secret 零入库——密钥只在 GitHub Secrets / Netlify 控制台 / Supabase 控制台设置。

### 1. 建 Supabase 项目并拿连接串
- Supabase 控制台新建项目 → **Project Settings → Database** 复制 **Transaction pooler** 连接串
  （形如 `postgresql://postgres.xxxx:6543/postgres?sslmode=require&pgbouncer=true`）。
- 在 GitHub 仓库 **Settings → Secrets** 加 `HOSTED_DATABASE_URL` = 上面连接串。

### 2. 建 Netlify 站点
- Netlify 控制台 **Add new site → Import from Git** → 选本仓库。
- **Site settings → Build & deploy → Base directory** 填 `text2sql-garbage`（项目在子目录）。
  （`netlify.toml` 已声明 base/command/plugin，导入后会自动识别。）
- **Site settings → Site information → API ID** 即 `NETLIFY_SITE_ID`。
- Netlify 控制台 **User settings → Personal access tokens** 生成 `NETLIFY_AUTH_TOKEN`。
- GitHub Secrets 加 `NETLIFY_AUTH_TOKEN` 与 `NETLIFY_SITE_ID`。

### 3. 在 Netlify 设置运行时环境变量
Site settings → **Environment variables** 加（值与本机 `.env` 同源）：
- `DATABASE_URL` = Supabase Transaction pooler 连接串（同 `HOSTED_DATABASE_URL`）
- `API_KEY` / `BASE_URL` / `MODEL_NAME`（DeepSeek 兼容端点）
- `NEXT_TELEMETRY_DISABLED=1`

> 注：`db.ts` 用 `pg` 直读 `DATABASE_URL`，`sslmode=require` 原生支持，无需改代码。
> 若 Supabase 报 SSL 证书校验错误，可临时在 `db.ts` 的 Pool 加 `ssl:{rejectUnauthorized:false}`（生产建议保留校验）。

### 4. 灌云库（一次性，schema/seed 变更后重跑）
GitHub **Actions → DB Setup → Run workflow**。该流程从全量仓库 checkout 跑 `pnpm seed:db`，
规避「Netlify 子目录构建拿不到仓库根 test-data/」的坑。

### 5. 触发部署
- **预览**：开 PR 到 master → `Deploy` 自动出预览 URL。
- **生产**：push master 且 `CI` 全绿 → `Deploy` 自动 `netlify deploy --prod`。
- **手动**：Actions → Deploy → Run workflow（选 preview / prod）。

### 6. 国内访问优化（可选）
Netlify 默认域名在国内偶发被墙；可在 Netlify 绑定自有域名并配置国内可达的 DNS/CDN，
或用 Netlify Edge Functions 进一步降低延迟。Supabase 同理可套一层就近连接池。

## 目录约定

- 需求/规范：`requirements-breakdown.md` · `output-config-spec.md` · `ROADMAP.md` · `CI-CD-PLAN.md`
- 代码：`text2sql-garbage/`（Next 16 应用）
- 造数/评测：`test-data/`（`schema.sql` · `seed.sql` · `text2sql-eval.jsonl` 共 41 条）
- 门禁脚本：`text2sql-garbage/scripts/`（check-schema / secret-scan / seed-db / check-eval / run-eval）
