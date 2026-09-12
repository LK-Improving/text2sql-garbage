// lib/schema.ts —— 表结构**唯一**数据源
//
// ⚠️ 本文件必须与真实库严格一致（建表脚本 `test-data/schema.sql`）。
//    核对方式：
//      psql -d garbage_db -At -F'|' -c \
//        "SELECT table_name||'.'||column_name FROM information_schema.columns \
//         WHERE table_schema='public' ORDER BY table_name, ordinal_position"
//
// 历史教训：此前 `lib/table-metadata.ts` 另有一份**字符串版**表结构，里面写了库里根本
// 不存在的列（如 `t_alert.severity`、`t_vehicle.vehicle_type`），而 route 又用
// `Object.values(字符串)` 把它拆成了一串单字符注入 prompt —— Schema 感知形同虚设，
// 模型只能靠 Few-Shot 硬扛，问到未覆盖的表必然幻列。该文件已删除，勿再新增第二份。

export type ColumnMeta = {
  name: string;
  /** PostgreSQL 类型 */
  type: string;
  /** 业务说明：这是模型选列的关键依据，要写清单位、取值、口径 */
  description: string;
};

export type TableMeta = {
  name: string;
  comment: string;
  /** 命中这些词说明该表与问题相关（P1 的 TableSchemaTool 打分用） */
  keywords: string[];
  columns: ColumnMeta[];
};

export const TABLE_METADATA: Record<string, TableMeta> = {
  t_region: {
    name: 't_region',
    comment: '区域维表，5 个行政区',
    keywords: ['区域', '区', '行政区', '片区', '西湖', '滨江', '余杭', '拱墅', '上城', 'region'],
    columns: [
      { name: 'id', type: 'integer', description: '主键 ID' },
      {
        name: 'region_name',
        type: 'varchar',
        description: '区域名称，如 西湖区、滨江区、余杭区、拱墅区、上城区',
      },
    ],
  },

  t_vehicle: {
    name: 't_vehicle',
    comment: '环卫车辆信息表',
    keywords: ['车', '车辆', '车牌', '车号', '环卫车', 'transport', 'vehicle', '浙A'],
    columns: [
      { name: 'id', type: 'integer', description: '主键 ID' },
      {
        name: 'plate_number',
        type: 'varchar',
        description: '车牌号，如 浙A·12345（注意中间可能带间隔点「·」）',
      },
      { name: 'region_id', type: 'integer', description: '所属区域 ID，关联 t_region.id' },
    ],
  },

  t_route_manifest: {
    name: 't_route_manifest',
    comment: '清运路单表，记录每辆车每天的清运总览（事实表，绝大多数统计都从这里出）',
    keywords: [
      '路单',
      '清运',
      '清运量',
      '垃圾量',
      '趟次',
      '出车',
      '收运',
      '作业',
      '趋势',
      '总量',
      '同比',
      '环比',
    ],
    columns: [
      { name: 'id', type: 'integer', description: '主键 ID' },
      { name: 'vehicle_id', type: 'integer', description: '车辆 ID，关联 t_vehicle.id' },
      { name: 'region_id', type: 'integer', description: '区域 ID，关联 t_region.id' },
      { name: 'route_date', type: 'date', description: '清运日期（date 类型）' },
      { name: 'total_weight', type: 'integer', description: '当日总清运量，单位 kg' },
      { name: 'total_trips', type: 'integer', description: '当日出车趟次' },
      { name: 'status', type: 'varchar', description: '路单状态，示例取值 completed' },
    ],
  },

  t_alert: {
    name: 't_alert',
    comment: '车辆预警事件表（超速等）',
    keywords: ['预警', '告警', '报警', '超速', '违规', 'alert'],
    columns: [
      { name: 'id', type: 'integer', description: '主键 ID' },
      { name: 'vehicle_id', type: 'integer', description: '车辆 ID，关联 t_vehicle.id' },
      { name: 'alert_type', type: 'varchar', description: '预警类型，如 超速' },
      { name: 'alert_time', type: 'timestamp', description: '预警发生时间' },
    ],
  },

  t_weigh_bill: {
    name: 't_weigh_bill',
    comment: '磅单表（进出场称重记录），一条路单可对应多条磅单',
    keywords: ['磅单', '称重', '过磅', '垃圾类型', '厨余', '可回收', 'weigh'],
    columns: [
      { name: 'id', type: 'integer', description: '主键 ID' },
      { name: 'manifest_id', type: 'integer', description: '关联 t_route_manifest.id' },
      { name: 'weight', type: 'integer', description: '称重重量，单位 kg' },
      { name: 'waste_type', type: 'varchar', description: '垃圾类型，如 厨余/可回收/其他' },
    ],
  },
};

/** 表名白名单：SecurityValidator 与后续 TableSchemaTool 共用 */
export const ALLOWED_TABLES: string[] = Object.keys(TABLE_METADATA);

/** 关联关系，写进 prompt 帮模型 JOIN 对 */
export const JOIN_RELATIONS: { left: string; right: string; desc: string }[] = [
  { left: 't_route_manifest.vehicle_id', right: 't_vehicle.id', desc: '路单 → 车辆' },
  { left: 't_route_manifest.region_id', right: 't_region.id', desc: '路单 → 区域' },
  { left: 't_vehicle.region_id', right: 't_region.id', desc: '车辆 → 区域' },
  { left: 't_alert.vehicle_id', right: 't_vehicle.id', desc: '预警 → 车辆' },
  { left: 't_weigh_bill.manifest_id', right: 't_route_manifest.id', desc: '磅单 → 路单' },
];

/** 口径提醒：这些坑模型最容易踩，单独列出来 */
export const QUERY_HINTS: string[] = [
  't_weigh_bill 没有 vehicle_id 列：要按车辆统计磅单，必须先 JOIN t_route_manifest 再关联 t_vehicle。',
  '车牌号存在「浙A·12345」与「浙A12345」两种写法，等值匹配容易落空，必要时用 LIKE。',
  '「清运量」指 t_route_manifest.total_weight（单位 kg），不是磅单的 weight。',
  't_alert 只有 4 列，不存在 severity 或 status 列，不要生成这些字段。',
  "统计「本月 / 上个月」用 date_trunc('month', CURRENT_DATE)，不要用 MySQL 的 DATE_SUB / CURDATE。",
];

/** 只渲染指定表的字段块（不含关联/口径，后者全局固定注入） */
export function renderTables(tables: TableMeta[]): string {
  return tables
    .map((table) => {
      const cols = table.columns
        .map((col) => `  - ${col.name} (${col.type})：${col.description}`)
        .join('\n');
      return `### ${table.name} —— ${table.comment}\n${cols}`;
    })
    .join('\n\n');
}

/**
 * 全局固定的「关联关系 + 口径提醒」。
 * 无论 TableSchemaTool 检索到哪些表，这段都注入，
 * 因为 JOIN 关系与易错口径（如 t_weigh_bill 没有 vehicle_id）对任何查询都适用，
 * 只靠 Top3 表结构容易漏掉导致错 JOIN / 幻列。
 */
export function renderGlobalHints(): string {
  const joins = JOIN_RELATIONS.map((rel) => `- ${rel.left} = ${rel.right}（${rel.desc}）`).join('\n');
  const hints = QUERY_HINTS.map((hint) => `- ${hint}`).join('\n');
  return `### 关联关系\n${joins}\n\n### 口径提醒\n${hints}`;
}

/**
 * 把表结构渲染成注入 prompt 的紧凑文本。
 * 默认全量（5 张表）+ 全局关联/口径；供旧调用与调试使用。
 * 正常链路改由 TableSchemaTool 只返回 TopN 表（renderTables）+ renderGlobalHints()。
 */
export function renderTableInfo(tables: TableMeta[] = Object.values(TABLE_METADATA)): string {
  return `${renderTables(tables)}\n\n${renderGlobalHints()}`;
}
