/**
 * data/config.js
 * ==============
 * 
 * 数据访问层的配置 (URL 等)。
 * 把所有"环境相关"的东西集中在这里,方便部署时改。
 * 
 * 开发环境: API 在 http://localhost:8000
 * 生产环境: 部署时改成你的服务器域名
 */

// API base URL
// 优先从 Vite 环境变量读, 没有则用默认值
// 部署时可以在 .env.production 里配 VITE_API_BASE
export const API_BASE =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

// 默认数据源
// 未来要切到 CWA 等其他数据源, 只改这里
export const DEFAULT_SOURCE = "perth";

// 调试开关
// 设为 true 时 loader 会打印详细日志
export const DEBUG = import.meta.env.DEV;