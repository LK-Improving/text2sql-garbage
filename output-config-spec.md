# JSON 输出配置规范（OutputConfig）

> 本规范定义 Text-to-SQL 工具「执行结果」的统一返回结构。后端把查询结果封装为一份 JSON 配置，前端 `ResultRenderer` 根据 `components[].type` 字段**分发渲染**到对应组件：Markdown 文本、图片、表格、ECharts 图表、Excel 下载按钮。

---

## 1. 顶层结构（OutputConfig）

```jsonc
{
  "sql": "string",          // 最终执行的 SQL（已通过校验、已补 LIMIT）
  "title": "string",        // 本次查询标题（用于卡片头 / 导出文件名）
  "summary": "string",      // Markdown 摘要（与 components 中 markdown 可重复，便于列表预览）
  "components": [           // 渲染组件列表，按数组顺序从上到下渲染
    { "type": "markdown",  "data": { ... } },
    { "type": "image",     "data": { ... } },
    { "type": "table",     "data": { ... } },
    { "type": "echarts",   "data": { ... } },
    { "type": "excel_download", "data": { ... } }
  ]
}
```

### 字段说明
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sql` | string | 是 | 生成并经安全校验后的 SQL |
| `title` | string | 是 | 查询标题 |
| `summary` | string | 否 | Markdown 摘要，列表/卡片预览用 |
| `components` | array | 是 | 渲染组件数组，至少 1 个 |

---

## 2. 组件类型（ComponentConfig）

每个组件统一为：
```jsonc
{ "type": "组件类型", "data": { /* 该类型专属字段 */ } }
```

### 2.1 markdown —— 文本摘要
```jsonc
{ "type": "markdown", "data": { "content": "✅ 查询成功！共找到 **10** 辆车的清运数据……" } }
```
| data 字段 | 类型 | 说明 |
|---|---|---|
| `content` | string | Markdown 文本，前端用 marked/react-markdown 渲染 |

### 2.2 image —— 图片
> 用于承载业务架构图、SQL 执行流程图，或把 ECharts 图表导出为图片后的静态图。
```jsonc
{ "type": "image", "data": { "url": "https://.../arch.png", "caption": "垃圾清运 Text-to-SQL 整体架构" } }
```
| data 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 图片地址（http / https / data:URI） |
| `caption` | string | 否 | 图片说明文字 |

### 2.3 table —— 数据表格
```jsonc
{
  "type": "table",
  "data": {
    "columns": [ { "field": "车牌号", "label": "车牌号" }, { "field": "出车趟次", "label": "出车趟次" } ],
    "rows": [ { "车牌号": "浙A·88888", "出车趟次": 86 } ]
  }
}
```
| data 字段 | 类型 | 说明 |
|---|---|---|
| `columns` | array<{field,label}> | field=数据键，label=表头显示名 |
| `rows` | array<object> | 行数据，键须与 columns.field 对应 |

### 2.4 echarts —— ECharts 图表
支持**两种传法**：
1. **精简式**（推荐，前端按 chartType 拼 option）：
```jsonc
{
  "type": "echarts",
  "data": {
    "chartType": "bar",
    "title": "各车辆上月清运量排行",
    "xAxisData": ["浙A·88888", "浙A·66666", "浙A·77777"],
    "series": [ { "name": "总清运量(kg)", "data": [152300, 148700, 132100] } ]
  }
}
```
2. **完整式**（直接给 ECharts option，前端 `echarts.init().setOption(data.option)`）：
```jsonc
{ "type": "echarts", "data": { "option": { "xAxis": {...}, "series": [...] } } }
```
| data 字段 | 类型 | 说明 |
|---|---|---|
| `chartType` | string | bar/line/pie 等，精简式必填 |
| `title` | string | 图表标题 |
| `xAxisData` | array | 类目轴数据 |
| `series` | array | 系列数组（name + data） |
| `option` | object | 完整 ECharts option（完整式） |

> 前端约定：有 `option` 直接用，否则按 `chartType + xAxisData + series` 拼装。

### 2.5 excel_download —— Excel 下载
```jsonc
{
  "type": "excel_download",
  "data": {
    "url": "https://oss-cn-hangzhou.aliyuncs.com/...?Expires=...&Signature=...",
    "filename": "各车辆上月清运量排行.xlsx",
    "expire": "10分钟"
  }
}
```
| data 字段 | 类型 | 说明 |
|---|---|---|
| `url` | string | OSS 预签名下载地址 |
| `filename` | string | 建议下载文件名 |
| `expire` | string | 有效期提示文案（预签名通常 10 分钟） |

---

## 3. 完整示例（垃圾清运：各车辆上月清运量排行）

```json
{
  "sql": "SELECT v.plate_number AS 车牌号, COUNT(r.id) AS 出车趟次, SUM(r.total_weight) AS 总清运量_kg FROM t_route_manifest r JOIN t_vehicle v ON r.vehicle_id = v.id WHERE r.route_date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH) AND r.status = 'completed' GROUP BY v.id, v.plate_number ORDER BY 总清运量_kg DESC LIMIT 10;",
  "title": "各车辆上月清运量排行",
  "summary": "✅ 查询成功！共找到 **10** 辆车的清运数据。排名前3：**浙A·88888**（152.3吨）、**浙A·66666**（148.7吨）、**浙A·77777**（132.1吨）。",
  "components": [
    {
      "type": "markdown",
      "data": { "content": "✅ 查询成功！共找到 **10** 辆车的清运数据。排名前3：**浙A·88888**（152.3吨）、**浙A·66666**（148.7吨）、**浙A·77777**（132.1吨）。" }
    },
    {
      "type": "image",
      "data": { "url": "https://via.placeholder.com/640x200?text=Garbage+Text2SQL+Arch", "caption": "垃圾清运 Text-to-SQL 整体架构示意" }
    },
    {
      "type": "table",
      "data": {
        "columns": [
          { "field": "车牌号", "label": "车牌号" },
          { "field": "出车趟次", "label": "出车趟次" },
          { "field": "总清运量_kg", "label": "总清运量(kg)" }
        ],
        "rows": [
          { "车牌号": "浙A·88888", "出车趟次": 86, "总清运量_kg": 152300 },
          { "车牌号": "浙A·66666", "出车趟次": 79, "总清运量_kg": 148700 },
          { "车牌号": "浙A·77777", "出车趟次": 74, "总清运量_kg": 132100 }
        ]
      }
    },
    {
      "type": "echarts",
      "data": {
        "chartType": "bar",
        "title": "各车辆上月清运量排行(kg)",
        "xAxisData": ["浙A·88888", "浙A·66666", "浙A·77777"],
        "series": [ { "name": "总清运量(kg)", "data": [152300, 148700, 132100] } ]
      }
    },
    {
      "type": "excel_download",
      "data": {
        "url": "https://oss-cn-hangzhou.aliyuncs.com/exports/2026/09/09/各车辆上月清运量排行.xlsx?Expires=600&Signature=...",
        "filename": "各车辆上月清运量排行.xlsx",
        "expire": "10分钟"
      }
    }
  ]
}
```

---

## 4. 前端分发约定（伪代码）

```ts
function ResultRenderer({ components }: { components: ComponentConfig[] }) {
  return components.map((comp, i) => {
    switch (comp.type) {
      case 'markdown':       return <Markdown content={comp.data.content} />;
      case 'image':          return <img src={comp.data.url} alt={comp.data.caption} />;
      case 'table':          return <Table columns={comp.data.columns} rows={comp.data.rows} />;
      case 'echarts':        return <Echarts option={comp.data.option ?? buildOption(comp.data)} />;
      case 'excel_download': return <DownloadButton url={comp.data.url} filename={comp.data.filename} />;
      default:               return null; // 未知 type 静默忽略，保证健壮性
    }
  });
}
```

> 设计要点：**未知 type 静默忽略**，后端新增组件类型时前端不崩溃（向前兼容）。
