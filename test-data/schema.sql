-- ============================================================
-- 垃圾清运 Text-to-SQL 评测库 DDL（PostgreSQL）
-- 对齐 lib/schema.ts 的结构化元数据；t_weigh_bill 按 table-metadata.ts 文本补齐。
-- 说明：
--   1. t_region 区域列名用 region_name（与原始提示词 table-metadata.ts 一致；之前误写为 name）。
--   2. status 未定义枚举，这里用 VARCHAR(32)，测试 SQL 用 'completed'。
--   3. 顶部 DROP 用于干净重建测试库；生产请删掉。
-- ============================================================

-- 干净重建（可选，注释掉即可保留旧数据）
DROP TABLE IF EXISTS t_weigh_bill CASCADE;
DROP TABLE IF EXISTS t_alert CASCADE;
DROP TABLE IF EXISTS t_route_manifest CASCADE;
DROP TABLE IF EXISTS t_vehicle CASCADE;
DROP TABLE IF EXISTS t_region CASCADE;

-- 区域维表
CREATE TABLE t_region (
    id            SERIAL PRIMARY KEY,
    region_name   VARCHAR(64) NOT NULL,
    CONSTRAINT uq_region_region_name UNIQUE (region_name)
);
COMMENT ON TABLE  t_region IS '区域信息表';
COMMENT ON COLUMN t_region.region_name IS '区域名称，如西湖区';

-- 车辆表
CREATE TABLE t_vehicle (
    id           SERIAL PRIMARY KEY,
    plate_number VARCHAR(20) NOT NULL,
    region_id    INTEGER NOT NULL,
    CONSTRAINT uq_vehicle_plate UNIQUE (plate_number),
    CONSTRAINT fk_vehicle_region FOREIGN KEY (region_id) REFERENCES t_region (id)
);
COMMENT ON TABLE  t_vehicle IS '车辆信息表';
COMMENT ON COLUMN t_vehicle.plate_number IS '车牌号，如 浙A·12345';
COMMENT ON COLUMN t_vehicle.region_id IS '所属区域ID，关联 t_region';

-- 清运路单表
CREATE TABLE t_route_manifest (
    id           SERIAL PRIMARY KEY,
    vehicle_id   INTEGER NOT NULL,
    region_id    INTEGER NOT NULL,
    route_date   DATE NOT NULL,
    total_weight INTEGER NOT NULL DEFAULT 0,   -- 总清运量，单位 kg
    total_trips  INTEGER NOT NULL DEFAULT 0,   -- 出车趟次
    status       VARCHAR(32) NOT NULL DEFAULT 'completed',
    CONSTRAINT fk_manifest_vehicle FOREIGN KEY (vehicle_id) REFERENCES t_vehicle (id),
    CONSTRAINT fk_manifest_region  FOREIGN KEY (region_id)  REFERENCES t_region  (id)
);
COMMENT ON TABLE  t_route_manifest IS '清运路单表，记录车辆每天的清运总览';
COMMENT ON COLUMN t_route_manifest.total_weight IS '总清运量，单位kg';
COMMENT ON COLUMN t_route_manifest.total_trips  IS '出车趟次';
COMMENT ON COLUMN t_route_manifest.status       IS '路单状态，示例取值 completed';

-- 预警事件表
CREATE TABLE t_alert (
    id         SERIAL PRIMARY KEY,
    vehicle_id INTEGER NOT NULL,
    alert_type VARCHAR(32) NOT NULL,           -- 如 超速
    alert_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_alert_vehicle FOREIGN KEY (vehicle_id) REFERENCES t_vehicle (id)
);
COMMENT ON TABLE  t_alert IS '车辆预警事件表，如超速';
COMMENT ON COLUMN t_alert.alert_type IS '预警类型，如 超速';
COMMENT ON COLUMN t_alert.alert_time IS '预警时间';

-- 磅单表（table-metadata.ts 引用，但原 schema.ts 缺失，这里补齐以便 I 类用例可跑）
CREATE TABLE t_weigh_bill (
    id          SERIAL PRIMARY KEY,
    manifest_id INTEGER NOT NULL,
    weight      INTEGER NOT NULL DEFAULT 0,    -- 重量，单位 kg
    waste_type  VARCHAR(32),                   -- 垃圾类型，如 厨余/可回收/其他
    CONSTRAINT fk_bill_manifest FOREIGN KEY (manifest_id) REFERENCES t_route_manifest (id)
);
COMMENT ON TABLE  t_weigh_bill IS '磅单（进出场称重）表';
COMMENT ON COLUMN t_weigh_bill.weight     IS '重量，单位kg';
COMMENT ON COLUMN t_weigh_bill.waste_type IS '垃圾类型';

-- 常用查询索引（FK + 高频过滤/分组列）
CREATE INDEX idx_vehicle_region      ON t_vehicle (region_id);
CREATE INDEX idx_manifest_vehicle    ON t_route_manifest (vehicle_id);
CREATE INDEX idx_manifest_region     ON t_route_manifest (region_id);
CREATE INDEX idx_manifest_route_date ON t_route_manifest (route_date);
CREATE INDEX idx_manifest_status     ON t_route_manifest (status);
CREATE INDEX idx_alert_vehicle       ON t_alert (vehicle_id);
CREATE INDEX idx_alert_time          ON t_alert (alert_time);
CREATE INDEX idx_bill_manifest       ON t_weigh_bill (manifest_id);
