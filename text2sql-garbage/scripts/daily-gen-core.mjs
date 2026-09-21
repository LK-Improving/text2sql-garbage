#!/usr/bin/env node
/**
 * 每日随机清运数据生成核心逻辑（与 Next 运行时解耦，纯 ESM + pg）。
 *
 * 设计要点：
 *  - 只接受「已连接好的 pg Client」，调用方（CLI / 定时任务）负责解析 DATABASE_URL、
 *    处理 Supabase 自签名证书等连接细节 —— 逻辑与连接解耦，便于复用。
 *  - 不写死 id：全部走 SERIAL 自增，避免与 seed.sql 的确定性基线（id 1..131）冲突；
 *    seed.sql 末尾用 setval 复位序列，本脚本插入的数据在 seed:db 全量重置时一并被清掉，符合预期。
 *  - 幂等：默认 skipExisting，对 (vehicle_id, route_date) 已存在的路单直接跳过，
 *    因此定时任务重复跑、或手动补跑都不会产生重复行。
 *  - 仅覆盖「清运事实主表 + 关联明细/预警」：
 *      t_route_manifest（核心，最近 N 天查询依赖它）
 *      t_weigh_bill（每路单 2 张磅单，保持外键不悬空）
 *      t_alert（当天按概率散落若干预警，贴近真实）
 *
 * 用法（被 gen-daily.mjs 调用，不直接执行）：
 *   import { fillDateRange } from './daily-gen-core.mjs';
 *   await fillDateRange(client, { from: '2026-09-12', to: '2026-09-21' });
 */

import { randomInt } from 'node:crypto';

const WASTE_TYPES = ['厨余', '可回收', '其他'];
const ALERT_TYPES = ['超速', '疲劳驾驶', '偏离路线'];

/** 85% 完成、15% 待处理，贴近真实路单状态分布 */
function pickStatus() {
  return Math.random() < 0.85 ? 'completed' : 'pending';
}

function pick(arr) {
  return arr[randomInt(0, arr.length)];
}

/**
 * 把 'YYYY-MM-DD' 拆成本地 Date（避免 Date.parse 的 UTC 偏移歧义）。
 * 返回 { y, m, d } 数字。
 */
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`非法日期（应为 YYYY-MM-DD）：${s}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** 枚举 [from, to] 闭区间内的每一天，返回 'YYYY-MM-DD' 数组（本地时区格式化） */
export function enumerateDates(from, to) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  const start = new Date(a.y, a.m - 1, a.d);
  const end = new Date(b.y, b.m - 1, b.d);
  if (start > end) throw new Error(`from(${from}) 晚于 to(${to})`);
  const out = [];
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const y = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, '0');
    const da = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${mo}-${da}`);
  }
  return out;
}

/**
 * 在 [from, to] 闭区间内为指定车辆生成随机清运数据。
 * @param {import('pg').Client} client 已连接的 pg 客户端（调用方负责关闭）
 * @param {object} opts
 *   from/to      {string}  'YYYY-MM-DD'，闭区间
 *   vehicles     {number[]}车辆 id 列表，默认 1..9
 *   withBills    {boolean} 是否生成磅单（默认 true）
 *   withAlerts   {boolean} 是否生成预警（默认 true）
 *   skipExisting {boolean} 已存在的路单是否跳过（默认 true，幂等）
 *   onLog        {(msg:string)=>void} 日志回调
 * @returns {Promise<{dates:number, planned:number, inserted:number, bills:number, alerts:number, skipped:number}>}
 */
export async function fillDateRange(client, opts = {}) {
  const {
    from,
    to,
    vehicles = [1, 2, 3, 4, 5, 6, 7, 8, 9],
    withBills = true,
    withAlerts = true,
    skipExisting = true,
    onLog = () => {},
  } = opts;

  if (!from || !to) throw new Error('fillDateRange 需要 from 与 to');
  const dates = enumerateDates(from, to);
  const summary = { dates: dates.length, planned: dates.length * vehicles.length, inserted: 0, bills: 0, alerts: 0, skipped: 0 };

  for (const d of dates) {
    for (const vid of vehicles) {
      if (skipExisting) {
        const ex = await client.query(
          'SELECT 1 FROM t_route_manifest WHERE vehicle_id = $1 AND route_date = $2 LIMIT 1',
          [vid, d],
        );
        if (ex.rows.length) {
          summary.skipped++;
          continue;
        }
      }

      const totalWeight = randomInt(1000, 2000);
      const totalTrips = randomInt(2, 6);
      const status = pickStatus();

      const ins = await client.query(
        `INSERT INTO t_route_manifest (vehicle_id, region_id, route_date, total_weight, total_trips, status)
         VALUES ($1, (SELECT region_id FROM t_vehicle WHERE id = $1), $2, $3, $4, $5)
         RETURNING id`,
        [vid, d, totalWeight, totalTrips, status],
      );
      const mid = ins.rows[0].id;
      summary.inserted++;

      if (withBills) {
        // 每路单 2 张磅单，重量随机，垃圾类型随机；不与 total_weight 强校验
        for (let i = 0; i < 2; i++) {
          await client.query(
            'INSERT INTO t_weigh_bill (manifest_id, weight, waste_type) VALUES ($1, $2, $3)',
            [mid, randomInt(400, 1000), pick(WASTE_TYPES)],
          );
          summary.bills++;
        }
      }

      if (withAlerts && Math.random() < 0.15) {
        // 当天该车的某次预警，时间随机落在 00:00-23:59
        const secs = randomInt(0, 86399);
        const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
        const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
        const ss = String(secs % 60).padStart(2, '0');
        await client.query(
          'INSERT INTO t_alert (vehicle_id, alert_type, alert_time) VALUES ($1, $2, $3)',
          [vid, pick(ALERT_TYPES), `${d} ${hh}:${mm}:${ss}`],
        );
        summary.alerts++;
      }
    }
    onLog(`  ✓ ${d} 完成（已生成 ${summary.inserted} 条路单）`);
  }

  return summary;
}
