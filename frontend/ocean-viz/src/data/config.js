/**
 * data/config.js
 * ==============
 * 
 * 数据访问层的配置 (URL 等)。
 * 把所有"环境相关"的东西集中在这里,方便部署时改。
 */

// API base URL
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8000";


// ============================================================
// 数据源列表 (前端展示用)
// ============================================================
// 必须和后端 data_loader.py 的 DATA_SOURCES 保持一致。
//
// 字段说明:
//   key         - 数据源标识 (和后端 DATA_SOURCES 的 key 一致)
//   group       - 分组 ("ocean" | "atmosphere"), 给 SourcePopover 分组用
//   kind        - 数据类型, 和后端 source_kind 呼应
//   name        - 显示名
//   subtitle    - 副标题
//   resolution  - 分辨率标签
//   variables   - ⭐ 这个源支持哪些标量变量 (前端的"单一真相来源")
//                 切换数据源时, App 用它决定 variable 该重置成什么;
//                 VariablePopover 用它决定显示哪些变量按钮.
//   description - 详细描述
export const SOURCES = [
  {
    key: "perth",
    group: "ocean",
    kind: "ocean",
    name: "Perth waters",
    subtitle: "500m local model",
    resolution: "500 m",
    variables: ["temp", "salt", "zeta"],
    description: "Perth 海域近岸高分辨率 ROMS 模型, 覆盖 Cockburn Sound 和 Rottnest 周边.",
  },
  {
    key: "cwa",
    group: "ocean",
    kind: "ocean",
    name: "Central WA",
    subtitle: "~2km regional model",
    resolution: "2 km",
    variables: ["temp", "salt", "zeta"],
    description: "中西澳大利亚海岸 ROMS 模型, 从 Carnarvon 北部到 Albany, 覆盖整个大陆架.",
  },
  {
    key: "wrf_d01",
    group: "atmosphere",
    kind: "atmosphere",
    name: "Western Australia",
    subtitle: "WRF atmosphere",
    resolution: "2 km",
    variables: ["temp", "Pair", "Qair", "rain", "cloud"],
    description: "西澳大范围 WRF 大气模型, 覆盖整个西澳州. 提供气温、气压、湿度、降雨、云量和 10m 风场.",
  },
  {
    key: "wrf_d02",
    group: "atmosphere",
    kind: "atmosphere",
    name: "Perth region",
    subtitle: "WRF atmosphere",
    resolution: "2 km",
    variables: ["temp", "Pair", "Qair", "rain", "cloud"],
    description: "Perth 区域 WRF 大气模型, 范围对应 Perth 海域. 提供气温、气压、湿度、降雨、云量和 10m 风场.",
  },
];


// ============================================================
// 数据源分组 (给 SourcePopover 分组显示用, B 方案)
// ============================================================
// label 是分组标题; SourcePopover 按这个顺序渲染分组,
// 每组里的源用 SOURCES.filter(s => s.group === key) 取。
export const SOURCE_GROUPS = [
  { key: "ocean",      label: "Ocean (ROMS)" },
  { key: "atmosphere", label: "Atmosphere (WRF)" },
];


// 默认数据源 (启动时显示的)
export const DEFAULT_SOURCE = "perth";


// ⭐ Fallback 日期: 数据集还没加载完时临时用一下,
//    一旦 datesIndex 到位, App 会自动跳到 "remote 最新那天"。
//    所以这个值只在加载的第 1-2 秒可见,不重要。
//    选 2026-05-16 因为它在所有数据集里都存在。
export const FALLBACK_DATE = "2026-05-16";


// 通过 key 找到源的元信息
export function getSourceInfo(key) {
  return SOURCES.find((s) => s.key === key) ?? SOURCES[0];
}


// ⭐ 取某个数据源支持的变量列表
//    找不到就返回 ROMS 的默认 (温度/盐度/海面高度)
export function getSourceVariables(key) {
  const src = SOURCES.find((s) => s.key === key);
  return src?.variables ?? ["temp", "salt", "zeta"];
}


// ⭐ 取某个数据源的默认变量 (= variables 列表的第一个)
//    切换数据源时, 如果当前 variable 在新源里不存在, 就重置到这个.
export function getDefaultVariable(key) {
  return getSourceVariables(key)[0] ?? "temp";
}


// 调试开关
export const DEBUG = import.meta.env.DEV;