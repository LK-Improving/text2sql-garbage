# text2sql-garbage 治理初始化状态

## 发现结果

- 初始化时间：2026-09-18
- 工作区：`D:\Study\重点项目\text2sql-garbage`
- Git 状态：`master...origin/master [gone]`；外层仓库当前未显示工作区改动。内层 Next 应用有自己的 `AGENTS.md` 和 `CLAUDE.md`，已保留。
- 已识别技术栈：Next.js 16.3、React 19、TypeScript、TailwindCSS 4、LangChain.js 1.x、PostgreSQL、Zod、Monaco、ECharts、ExcelJS、Netlify、Supabase、SSE。
- 待确认技术栈或边界：外层 Git 与内层应用是否长期保持双层仓库关系；根治理以外层为入口，实际代码规则由内层 Next `AGENTS.md` 补充。

## 五阶段

- [x] 1. 项目发现与初始状态
- [x] 2. AGENTS 与架构 Wiki
- [x] 3. 技术栈规则
- [x] 4. 需求、接口、UI 与实现技能
- [x] 5. 后端交付、产物交接与联调验收

## 生成的文件

| 文件 | 阶段 | 说明 |
| --- | --- | --- |
| `AGENTS.md` | 2 | 外层仓库入口规则与内层 Next 路由 |
| `.agents/repowiki.md` | 2 | Next、LangChain、SQL、安全与评测架构索引 |
| `.agents/rules/*.mdc` | 3/5 | React、Next 服务端、SSE/API、交接规则 |
| `.agents/skills/*/SKILL.md` | 4/5 | 需求、契约、UI、页面、服务端交付、验收流程 |
| `.agents/Documents/**/README.md` | 5 | 需求、接口、UI、联调验收产物目录 |
| `.agents/governance-state.md` | 1 | 初始化证据与双层仓库待确认项 |

## 合并与待确认事项

- 保留 `text2sql-garbage/text2sql-garbage/AGENTS.md` 的 Next.js 自动生成内容及 `CLAUDE.md` 引用关系，未覆盖或改写。
- 未把 README 中的远程 CI、Netlify、Supabase 或真实模型评测状态当作本地已验证事实。
- 根仓库 upstream 分支显示 `origin/master` 已不存在；这不是本次治理初始化处理范围。
