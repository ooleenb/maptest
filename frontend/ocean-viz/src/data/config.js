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
export const SOURCES = [
  {
    key: "perth",
    name: "Perth waters",
    subtitle: "500m local model",
    resolution: "500 m",
    description: "Perth 海域近岸高分辨率 ROMS 模型, 覆盖 Cockburn Sound 和 Rottnest 周边.",
  },
  {
    key: "cwa",
    name: "Central WA",
    subtitle: "~2km regional model",
    resolution: "2 km",
    description: "中西澳大利亚海岸 ROMS 模型, 从 Carnarvon 北部到 Albany, 覆盖整个大陆架.",
  },
];


// 默认数据源 (启动时显示的)
export const DEFAULT_SOURCE = "perth";


// ⭐ Fallback 日期: 数据集还没加载完时临时用一下,
//    一旦 datesIndex 到位, App 会自动跳到 "remote 最新那天"。
//    所以这个值只在加载的第 1-2 秒可见,不重要。
//    选 2026-03-11 因为它在 Perth 和 CWA 数据集里都存在。
export const FALLBACK_DATE = "2026-05-16";


// 通过 key 找到源的元信息
export function getSourceInfo(key) {
  return SOURCES.find((s) => s.key === key) ?? SOURCES[0];
}


// 调试开关
export const DEBUG = import.meta.env.DEV;