// lib/field-labels.ts
//
// P2-3：把数据库字段名本地化成中文业务名，用于表格表头 / CSV / Excel。
//
// 之前表头直接显示字段名（`total_weight`、`region_name`），导出的表格给运营看很别扭。
// 这里以 lib/schema.ts 的业务说明为准维护一份字典；命不中的字段做「保底美化」：
//   - 已经是中文（模型用了 `AS 车牌号` 别名）→ 原样保留；
//   - 带聚合前缀 `sum_` / `count_` → 去掉前缀再查字典；
//   - 带 `_kg` 等单位后缀 → 抽成 `xxx(kg)`；
//   - 其余把下划线换成空格。

/** 字段名 → 中文业务名（全部小写 key） */
const FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  region_id: '区域ID',
  region_name: '区域',
  vehicle_id: '车辆ID',
  plate_number: '车牌号',
  manifest_id: '路单ID',
  route_date: '清运日期',
  total_weight: '总清运量',
  total_trips: '出车趟次',
  status: '状态',
  alert_type: '预警类型',
  alert_time: '预警时间',
  weight: '重量',
  waste_type: '垃圾类型',
  name: '名称',
  count: '数量',
  total: '合计',
};

/** 字段名自带单位后缀时，抽出来拼到中文名后面 */
const UNIT_SUFFIX: Record<string, string> = {
  kg: 'kg',
  km: 'km',
  t: '吨',
  ton: '吨',
  tons: '吨',
  pct: '%',
  rate: '%',
  ratio: '%',
};

// 注意：别把 `total_` 当聚合前缀——它是常见列名前缀（total_weight / total_trips），
// 一旦剥离会把「总清运量」错翻成「重量」。
const AGG_PREFIXES = ['sum_', 'count_', 'avg_', 'max_', 'min_'];

function lookup(key: string): string | undefined {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  // 去掉聚合前缀再查一次
  for (const prefix of AGG_PREFIXES) {
    if (key.startsWith(prefix)) {
      const rest = key.slice(prefix.length);
      if (FIELD_LABELS[rest]) return FIELD_LABELS[rest];
    }
  }
  return undefined;
}

/**
 * 字段名 → 展示用中文标签。
 * 命中字典返回业务名（必要时补单位），否则退回一个「还看得过去」的形态。
 */
export function humanizeField(field: string): string {
  const raw = String(field ?? '').trim();
  if (!raw) return raw;

  // 模型已经给了中文别名（如 `AS 车牌号`），直接采用
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;

  const key = raw.toLowerCase();
  const hit = lookup(key);
  if (hit) return hit;

  // 去掉聚合前缀后，再尝试「去单位后缀」命中字典
  let base = key;
  for (const prefix of AGG_PREFIXES) {
    if (base.startsWith(prefix)) {
      base = base.slice(prefix.length);
      break;
    }
  }

  // 单位后缀：`total_weight_kg` / `weight_kg`
  const unitMatch = /^(.*?)_(kg|km|t|ton|tons|pct|rate|ratio)$/.exec(base);
  if (unitMatch) {
    const unit = UNIT_SUFFIX[unitMatch[2]];
    const named = FIELD_LABELS[unitMatch[1]];
    if (named) return `${named}(${unit})`;
    return `${beautify(unitMatch[1])}(${unit})`;
  }

  const named = FIELD_LABELS[base];
  if (named) return named;

  return beautify(base);
}

/** 保底美化：下划线换空格、去掉多余的空白 */
function beautify(field: string): string {
  return field.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim() || field;
}

/** 批量映射（列数组，label 为空时用 field 兜底） */
export function localizeColumns<T extends { field: string; label?: string }>(
  columns: T[],
): T[] {
  return columns.map((col) => ({
    ...col,
    label: humanizeField(col.field),
  }));
}
