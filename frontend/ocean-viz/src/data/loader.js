/**
 * data/loader.js
 * ==============
 * 
 * 高层数据加载器: 组合 api.js + decoder.js, 提供"开箱即用"的数据。
 * 
 * 上层 React 组件只需要调用这里的几个函数, 不用管底层 fetch/解码细节。
 * 
 * 主要函数:
 * - loadGrid(source)            → 网格元数据 (polygons, bounds 等)
 * - loadDay(source, date)       → 一整天的所有数据 (24 帧)
 * - loadHourUV(source, date, h) → 单小时 u/v (按需懒加载)
 */

import * as api from "./api.js";
import { decodeScalarBuffer, decodeUVPng } from "./decoder.js";
import { DEBUG } from "./config.js";


// ============================================================
// loadGrid: 加载某数据源的网格元数据
// ============================================================
/**
 * @param {string} source  数据源名 (perth/cwa/wrf_d01/wrf_d02/...)
 * @returns {Promise<{
 *   sourceName: string,
 *   nEta: number,
 *   nXi: number,
 *   bounds: {minLon, maxLon, minLat, maxLat},
 *   suggestedView: {longitude, latitude, zoom},
 *   oceanCells: Array<{row, col, polygon, depth}>,
 * }>}
 */
export async function loadGrid(source) {
  const t0 = performance.now();
  const json = await api.getGrid(source);
  
  const result = {
    sourceName: json.source_name,
    nEta: json.n_eta,
    nXi: json.n_xi,
    bounds: json.bounds,
    suggestedView: json.suggested_view,
    oceanCells: json.ocean_cells,
  };
  
  if (DEBUG) {
    const dt = performance.now() - t0;
    console.log(
      `[loader] loadGrid(${source}): ${result.oceanCells.length} cells, ` +
      `${dt.toFixed(0)}ms`
    );
  }
  return result;
}


// ============================================================
// loadDay: 加载一天的所有数据
// ============================================================
/**
 * 并发加载: meta + N 个标量场 + 24 个 PNG。
 * 全部 fetch 完后才 resolve, 所以这是个"重"操作。
 * 
 * ⭐ 变量列表是动态的: 从 meta.scalar_variables 读取.
 *    - ROMS (perth/cwa): ["temp", "salt", "zeta"]
 *    - WRF  (wrf_d01/d02): ["temp", "Pair", "Qair", "rain", "cloud"]
 *    这样同一套代码同时支持海洋和大气数据源.
 * 
 * 进度回调可选, 用来更新 loading bar。
 * 
 * @param {string} source
 * @param {string} date  'YYYY-MM-DD'
 * @param {(stage: string, progress: number) => void} onProgress
 * @returns {Promise<DayData>}
 */
export async function loadDay(source, date, onProgress = null) {
  const t0 = performance.now();
  const report = (stage, progress) => {
    if (onProgress) onProgress(stage, progress);
    if (DEBUG) console.log(`[loader] ${stage}: ${Math.round(progress * 100)}%`);
  };
  
  // ----- 1. 取 meta.json -----
  // 这一步可能慢 (~5 秒) 如果该日数据需要按需生成
  report("fetching meta", 0);
  const meta = await api.getDayMeta(source, date);
  report("fetching meta", 0.05);
  
  // ----- 2. 确定要加载哪些标量变量 (⭐ 动态, 不再写死) -----
  // 优先用后端 meta.json 的 scalar_variables 字段 (阶段 4 加的);
  // 兜底: 老格式 meta 没这个字段时, 从 meta.variables 的 key 推断;
  // 再兜底: 都没有就用 ROMS 默认.
  let scalarVars = meta.scalar_variables;
  if (!Array.isArray(scalarVars) || scalarVars.length === 0) {
    if (meta.variables && typeof meta.variables === "object") {
      scalarVars = Object.keys(meta.variables);
    } else {
      scalarVars = ["temp", "salt", "zeta"];
    }
    if (DEBUG) {
      console.warn(
        `[loader] meta.scalar_variables missing, inferred: ${scalarVars}`
      );
    }
  }
  
  const nHours = meta.n_frames;
  
  // 进度计数器
  let completed = 0;
  const total = scalarVars.length + nHours;
  const tick = () => {
    completed++;
    report("loading data", 0.05 + 0.9 * (completed / total));
  };
  
  // 启动所有 scalar fetch
  const scalarPromises = scalarVars.map(async (varName) => {
    const buf = await api.getScalarBuffer(source, date, varName);
    const shape = meta.variables[varName].shape;
    const decoded = decodeScalarBuffer(buf, shape);
    tick();
    return [varName, decoded];
  });
  
  const uvRange = meta.uv.norm_range;
  const uvPromises = [];
  for (let h = 0; h < nHours; h++) {
    const url = api.getUVPngUrl(source, date, h);
    uvPromises.push(
      decodeUVPng(url, uvRange).then((decoded) => {
        tick();
        return decoded;
      })
    );
  }
  
  const scalarResults = await Promise.all(scalarPromises);
  const uvResults = await Promise.all(uvPromises);
  
  // ----- 3. 组装结果 -----
  const scalars = Object.fromEntries(scalarResults);
  
  // ⭐ ranges 也动态构建: 遍历 scalarVars, 不再写死 temp/salt/zeta
  const ranges = {};
  for (const varName of scalarVars) {
    const v = meta.variables[varName];
    if (v) {
      ranges[varName] = {
        min: v.global_min,
        max: v.global_max,
        p01: v.p01,
        p99: v.p99,
      };
    }
  }
  
  report("done", 1);
  
  const result = {
    source,
    date,
    meta,
    nFrames: nHours,
    nEta: meta.grid_shape[0],
    nXi: meta.grid_shape[1],
    times: meta.times,  // ISO 8601 字符串数组
    
    // ⭐ 这一天实际包含哪些标量变量 (前端 UI 可以直接用这个列表)
    scalarVariables: scalarVars,
    
    // ⭐ 数据源类型 ('ocean' | 'atmosphere' | null), 来自后端 meta.json.
    //    旧数据的 meta 可能没有 source_kind 字段 -> 这里给 null
    //    (而不是瞎猜成 "ocean"). App.jsx 的 resolveSourceKind 会
    //    结合 source 名字最终判断.
    sourceKind: meta.source_kind ?? null,
    
    // 标量场
    // 用法: dayData.scalars.temp.getFrame(13) → 第 13 小时的 Float32Array
    scalars,
    
    // 矢量场 (按小时索引的数组)
    // 用法: dayData.uv[13].u  → 第 13 小时的 u Float32Array
    uv: uvResults,
    
    // 配色范围 (动态构建; 上层可以自己决定用 global_min/max 还是 p01/p99)
    ranges,
  };
  
  if (DEBUG) {
    const dt = performance.now() - t0;
    console.log(
      `[loader] loadDay(${source}, ${date}) complete in ${dt.toFixed(0)}ms, ` +
      `variables: [${scalarVars.join(", ")}]`
    );
  }
  return result;
}


// ============================================================
// loadHourUV: 单独加载一帧 u/v (用于只切小时不切日期时的优化)
// ============================================================
/**
 * 单独加载某一小时的 u/v PNG。
 * 主要用于 loadDay 已加载后, 单帧动画切换的场景。
 */
export async function loadHourUV(source, date, hour, uvRange = 2.5) {
  const url = api.getUVPngUrl(source, date, hour);
  return decodeUVPng(url, uvRange);
}


// ============================================================
// 工具: 列出可用日期
// ============================================================
export async function listAvailableDates(source, range = "both") {
  return api.listDates(source, range);
}


// 导出 ApiError 方便上层捕获错误
export { ApiError } from "./api.js";