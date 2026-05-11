/**
 * data/api.js
 * ===========
 * 
 * API 客户端: 把后端 FastAPI 的所有端点封装成 JS 函数。
 * 
 * 这一层只做"网络请求 + 基本错误处理",不做任何数据解码/转换。
 * 解码逻辑在 decoder.js,组合逻辑在 loader.js。
 * 
 * 所有方法返回 Promise。
 * 出错时 throw 一个带 status / message / url 的 Error。
 */

import { API_BASE, DEBUG } from "./config.js";

// ============================================================
// 通用工具: 构造 URL
// ============================================================
function buildUrl(path, params) {
  let url = `${API_BASE}${path}`;
  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }
  return url;
}

// ============================================================
// 通用工具: 统一错误处理
// ============================================================
class ApiError extends Error {
  constructor(status, message, url) {
    super(`API ${status} at ${url}: ${message}`);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
  }
}

async function checkResponse(resp) {
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      // FastAPI 错误格式: {"detail": "..."}
      const json = await resp.json();
      detail = json.detail ?? detail;
    } catch {
      // 不是 JSON 错误响应, 用 statusText
    }
    throw new ApiError(resp.status, detail, resp.url);
  }
  return resp;
}

// ============================================================
// 端点封装
// ============================================================

/**
 * GET /api/sources
 * 列出所有可用的数据源
 */
export async function listSources() {
  const url = buildUrl("/api/sources");
  if (DEBUG) console.log("[api] listSources", url);
  const resp = await checkResponse(await fetch(url));
  return resp.json();
}

/**
 * GET /api/sources/{source}
 * 取某数据源的基本信息(显示名、分辨率、时间范围)
 */
export async function getSourceInfo(source) {
  const url = buildUrl(`/api/sources/${source}`);
  if (DEBUG) console.log("[api] getSourceInfo", url);
  const resp = await checkResponse(await fetch(url));
  return resp.json();
}

/**
 * GET /api/sources/{source}/grid
 * 取网格 JSON (polygons + bounds + suggested_view)
 */
export async function getGrid(source) {
  const url = buildUrl(`/api/sources/${source}/grid`);
  if (DEBUG) console.log("[api] getGrid", url);
  const resp = await checkResponse(await fetch(url));
  return resp.json();
}

/**
 * GET /api/sources/{source}/dates?range={...}
 * 取可用日期列表
 * 
 * range:
 *   "remote"    - OPeNDAP 数据集里所有日期 (默认)
 *   "available" - 本地已生成的日期
 *   "both"      - 都返回
 */
export async function listDates(source, range = "remote") {
  const url = buildUrl(`/api/sources/${source}/dates`, { range });
  if (DEBUG) console.log("[api] listDates", url);
  const resp = await checkResponse(await fetch(url));
  return resp.json();
}

/**
 * GET /api/sources/{source}/days/{date}/meta
 * 取某日的 meta.json (帧时间、变量统计、文件清单)
 * 
 * 注意: 如果该日数据本地不存在, 后端会同步生成,响应时间 ~5 秒。
 * 调用方应该显示 loading 状态。
 */
export async function getDayMeta(source, date) {
  const url = buildUrl(`/api/sources/${source}/days/${date}/meta`);
  if (DEBUG) console.log("[api] getDayMeta", url);
  const resp = await checkResponse(await fetch(url));
  return resp.json();
}

/**
 * GET /api/sources/{source}/days/{date}/scalar/{var}
 * 取某日某变量的 Float32 二进制数据
 * 
 * variable: 'temp' / 'salt' / 'zeta'
 * 
 * 返回 ArrayBuffer (24 * 259 * 129 * 4 = ~3MB)
 * 调用方需要用 new Float32Array(arrayBuffer) 解析
 */
export async function getScalarBuffer(source, date, variable) {
  const url = buildUrl(`/api/sources/${source}/days/${date}/scalar/${variable}`);
  if (DEBUG) console.log("[api] getScalarBuffer", url);
  const resp = await checkResponse(await fetch(url));
  return resp.arrayBuffer();
}

/**
 * 构造 u/v PNG 的 URL (不实际下载, 由 decoder.js 用 <img> 加载)
 */
export function getUVPngUrl(source, date, hour) {
  return buildUrl(
    `/api/sources/${source}/days/${date}/uv/${String(hour).padStart(2, "0")}`
  );
}

/**
 * GET /api/health
 * 健康检查
 */
export async function getHealth() {
  const url = buildUrl("/api/health");
  const resp = await checkResponse(await fetch(url));
  return resp.json();
}

// 导出 ApiError 供调用方判断错误类型
export { ApiError };