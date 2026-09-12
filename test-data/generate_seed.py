# -*- coding: utf-8 -*-
"""
垃圾清运评测库 种子数据生成器
============================
依赖 schema.sql 已执行。输出 seed.sql，在空表上插入示例数据，
覆盖评测集 text2sql-eval.jsonl 的主要查询窗口：
  最近7天 / 本月(2026-09) / 上个月(2026-08) / 2026-03 / 今年(2026年)
并补齐预警(t_alert)、磅单(t_weigh_bill)，以及 G03 需要的无间隔点车牌 浙A12345。
数据确定性（random.seed 固定），可重复生成。
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))

# 区域 (id, name)
regions = [
    (1, "西湖区"), (2, "滨江区"), (3, "拱墅区"), (4, "余杭区"), (5, "上城区"),
]

# 车辆 (id, plate_number, region_id)
vehicles = [
    (1, "浙A·12345", 1), (2, "浙A·88888", 1), (3, "浙A·66666", 2), (4, "浙A·77777", 2),
    (5, "浙A·55555", 3), (6, "浙A·99999", 4), (7, "浙A·11111", 5), (8, "浙A·22222", 1),
    (9, "浙A12345", 1),   # 无间隔点车牌，专供 G03（"浙A12345"）
]

# 每车单次清运基准重量(kg)与趟次，使 v2/v3 明显靠前，便于排行类用例
base_w = {1: 1200, 2: 1800, 3: 1700, 4: 1500, 5: 1300, 6: 1400, 7: 1100, 8: 1250, 9: 1000}
base_t = {1: 3, 2: 4, 3: 4, 4: 3, 5: 3, 6: 3, 7: 2, 8: 3, 9: 2}

# 覆盖各查询窗口的日期
dates = (
    ["2026-09-01", "2026-09-05", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]  # 本月 + 最近7天(05~11)
    + ["2026-08-05", "2026-08-12", "2026-08-20", "2026-08-28"]                              # 上个月
    + ["2026-03-05", "2026-03-15", "2026-03-25"]                                          # 2026-03
    + ["2026-01-15", "2026-06-10", "2026-07-20"]                                           # 今年其他月份
)

waste_types = ["厨余", "可回收", "其他"]

L = []
L.append("-- 垃圾清运评测库 种子数据（PostgreSQL）")
L.append("-- 依赖 schema.sql 已执行。本文件在空表上插入示例数据，确定性可重复。\n")

# 区域
L.append("-- 区域维表")
for rid, name in regions:
    L.append(f"INSERT INTO t_region (id, region_name) VALUES ({rid}, '{name}');")

# 车辆
L.append("\n-- 车辆表")
for vid, plate, rid in vehicles:
    L.append(f"INSERT INTO t_vehicle (id, plate_number, region_id) VALUES ({vid}, '{plate}', {rid});")

# 路单：8 辆主车跑全部日期；v9 额外补 09-09~09-11（供 G03）
L.append("\n-- 清运路单表")
mid = 0
manifest_meta = []  # (manifest_id, vehicle_id, date)
for d in dates:
    for vid in (1, 2, 3, 4, 5, 6, 7, 8):
        mid += 1
        w = base_w[vid] + (mid % 7) * 15
        t = base_t[vid] + (mid % 3)
        status = "pending" if mid % 17 == 0 else "completed"
        L.append(
            f"INSERT INTO t_route_manifest (id, vehicle_id, region_id, route_date, total_weight, total_trips, status) "
            f"VALUES ({mid}, {vid}, {vehicles[vid - 1][2]}, '{d}', {w}, {t}, '{status}');"
        )
        manifest_meta.append((mid, vid, d))
for d in ["2026-09-09", "2026-09-10", "2026-09-11"]:
    mid += 1
    vid = 9
    w = base_w[9] + (mid % 5) * 10
    t = base_t[9]
    L.append(
        f"INSERT INTO t_route_manifest (id, vehicle_id, region_id, route_date, total_weight, total_trips, status) "
        f"VALUES ({mid}, {vid}, {vehicles[vid - 1][2]}, '{d}', {w}, {t}, 'completed');"
    )
    manifest_meta.append((mid, vid, d))

# 磅单：每个路单挂 2 条（覆盖 I01/I02）
L.append("\n-- 磅单表")
wid = 0
for (m, v, _d) in manifest_meta:
    for k in range(2):
        wid += 1
        wt = waste_types[wid % 3]
        bw = base_w[v] // 2 + (wid % 20)
        L.append(
            f"INSERT INTO t_weigh_bill (id, manifest_id, weight, waste_type) "
            f"VALUES ({wid}, {m}, {bw}, '{wt}');"
        )

# 预警事件：覆盖 C01~C05 / F01（最近3天超速、本周全部、浙A·12345历史、类型分布）
L.append("\n-- 预警事件表")
alerts = [
    (1, "2026-03-10 08:12:00", "超速"),
    (1, "2026-06-15 14:30:00", "疲劳驾驶"),
    (1, "2026-09-09 09:05:00", "超速"),     # 浙A·12345 最近3天超速
    (2, "2026-09-10 07:50:00", "超速"),
    (2, "2026-09-08 22:10:00", "超速"),     # 最近7天
    (2, "2026-08-20 18:22:00", "偏离路线"),
    (3, "2026-09-11 06:40:00", "超速"),
    (3, "2026-09-06 13:15:00", "疲劳驾驶"),
    (4, "2026-09-09 19:45:00", "超速"),
    (4, "2026-09-07 11:00:00", "偏离路线"),
    (5, "2026-09-05 16:20:00", "超速"),     # 恰好最近7天起点
    (6, "2026-08-15 10:05:00", "超速"),     # 上个月，不在最近7天
    (7, "2026-09-10 12:30:00", "疲劳驾驶"),
    (8, "2026-09-11 05:55:00", "超速"),
    (9, "2026-09-10 08:00:00", "超速"),     # v9 无间隔点车牌也有预警
]
aid = 0
for vid, ts, atype in alerts:
    aid += 1
    L.append(f"INSERT INTO t_alert (id, vehicle_id, alert_type, alert_time) VALUES ({aid}, {vid}, '{atype}', '{ts}');")

# 同步 serial 序列，避免后续自增主键冲突
L.append("\n-- 同步 serial 序列到当前最大值")
seq_max = {
    "t_region_id_seq": max(r[0] for r in regions),
    "t_vehicle_id_seq": max(v[0] for v in vehicles),
    "t_route_manifest_id_seq": mid,
    "t_weigh_bill_id_seq": wid,
    "t_alert_id_seq": aid,
}
for seq, mx in seq_max.items():
    L.append(f"SELECT setval('{seq}', {mx});")

out = os.path.join(HERE, "seed.sql")
with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(L) + "\n")

print(f"生成完成：{out}")
print(f"  区域 {len(regions)} | 车辆 {len(vehicles)} | 路单 {mid} | 磅单 {wid} | 预警 {aid}")
