// lib/error-hints.ts
//
// P2-3：错误分级提示。
//
// 之前的做法是把 pg / 校验器抛出的原始英文错误直接拼进 summary 给用户看
// （例如 `column "region" does not exist`），运营同学既看不懂也不知道下一步该干嘛。
// 这里把错误归类，给出「类别 + 中文说明 + 可操作的下一步建议」，
// 前端与后端共用同一套判定，避免两边文案漂移。

export type ErrorCategory =
  | 'syntax'
  | 'field'
  | 'table'
  | 'permission'
  | 'timeout'
  | 'connection'
  | 'unknown';

export type ErrorHint = {
  category: ErrorCategory;
  /** 简短类别名，用于徽标展示 */
  label: string;
  /** 面向用户的一句话说明 */
  message: string;
  /** 下一步建议（可操作） */
  suggestion: string;
};

/**
 * 按错误文本归类。匹配顺序从「最具体」到「最宽泛」，
 * 因为 pg 的报错里常常同时出现 `does not exist` 和具体的 column/relation 词。
 */
export function classifyError(rawMessage: string): ErrorHint {
  const msg = String(rawMessage ?? '').trim();
  const lower = msg.toLowerCase();

  // —— 安全校验器拦下的请求（validator.ts 的文案）——
  if (/禁止的操作|仅允许 select|多条语句|cte 最终必须是/.test(msg)) {
    return {
      category: 'permission',
      label: '安全拦截',
      message: '这条语句不属于只读查询，已被安全校验拦下。',
      suggestion: '本工具只支持 SELECT 查询。若想删除或修改数据，请到业务系统操作。',
    };
  }
  if (/不允许访问的表|未识别到任何数据表/.test(msg)) {
    return {
      category: 'table',
      label: '表名不合法',
      message: '查询引用了不在白名单内的数据表。',
      suggestion: '只能用 t_region / t_vehicle / t_route_manifest / t_alert / t_weigh_bill 这五张表。',
    };
  }

  // —— 数据库返回的错误 ——
  if (/permission denied|not authorized|must be owner/.test(lower)) {
    return {
      category: 'permission',
      label: '权限不足',
      message: '当前数据库账号没有访问该对象的权限。',
      suggestion: '换一个业务字段或联系管理员开通只读权限。',
    };
  }
  if (/column .* does not exist|does not exist.*column|cannot find column|unknown column/.test(lower)) {
    return {
      category: 'field',
      label: '字段不存在',
      message: 'SQL 里引用了不存在的字段名。',
      suggestion: '检查字段拼写，或改成「按区域 / 按车辆」这类口径重新提问。',
    };
  }
  if (/relation .* does not exist|does not exist.*relation|undefined table|unknown table/.test(lower)) {
    return {
      category: 'table',
      label: '表不存在',
      message: 'SQL 里引用了不存在的表。',
      suggestion: '请使用本项目的五张业务表重新提问。',
    };
  }
  if (/syntax error|invalid input syntax|cannot cast|operator does not exist|type mismatch/.test(lower)) {
    return {
      category: 'syntax',
      label: 'SQL 语法错误',
      message: '生成的 SQL 语法有误，数据库无法解析。',
      suggestion: '可以在「SQL 语句」页签里手动修正后点「重新执行」。',
    };
  }
  if (/timeout|timed out|canceling statement|statement timeout/.test(lower)) {
    return {
      category: 'timeout',
      label: '查询超时',
      message: '查询耗时过长，已被数据库中断。',
      suggestion: '缩小时间范围（如把「全部」改成「最近 7 天」）或减少统计维度后重试。',
    };
  }
  if (/econnrefused|connection terminated|terminating connection|getaddrinfo|enotfound|connection refused/.test(lower)) {
    return {
      category: 'connection',
      label: '数据库连接失败',
      message: '无法连接到数据库。',
      suggestion: '确认本地数据库已启动、连接串配置正确后再试。',
    };
  }

  return {
    category: 'unknown',
    label: '执行失败',
    message: 'SQL 执行失败。',
    suggestion: '可以在「SQL 语句」页签里手动调整后点「重新执行」。',
  };
}

/** 把错误整理成一段带类别徽标的中文文案（用于 markdown 组件） */
export function formatErrorHint(rawMessage: string): { markdown: string; hint: ErrorHint; raw: string } {
  const hint = classifyError(rawMessage);
  const markdown = `**⚠️ ${hint.label}**：${hint.message}\n\n> ${hint.suggestion}\n\n原始错误：\`${String(rawMessage).slice(0, 300)}\``;
  return { markdown, hint, raw: String(rawMessage) };
}
