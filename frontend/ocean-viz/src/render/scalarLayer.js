/**
 * render/scalarLayer.js
 * =====================
 * 
 * Step 3.3 改造: 支持时间维度的双线性插值。
 * 
 * 旧版: hourIndex 是整数, 直接用 frame[i]
 * 新版: hourFloat 是浮点, frame = lerp(frame[floor(t)], frame[ceil(t)], frac(t))
 *       这样时间滑块拖动时颜色平滑过渡, 不再"逐小时跳"
 */

import { PolygonLayer } from "@deck.gl/layers";
import { valueToRGBA } from "./colormaps.js";


/**
 * 在时间维度做双线性插值, 返回一个 Float32Array (代表"虚拟的"该时刻数据)。
 * 
 * @param {object} scalar  decoded scalar (来自 decoder.js)
 * @param {number} hourFloat  浮点小时索引, 例如 13.4
 * @returns {Float32Array} 插值后的帧数据
 */
export function interpolateFrame(scalar, hourFloat) {
  const { nFrames, frameSize } = scalar;
  
  // 边界处理
  if (hourFloat <= 0) return scalar.getFrame(0);
  if (hourFloat >= nFrames - 1) return scalar.getFrame(nFrames - 1);
  
  const iLow = Math.floor(hourFloat);
  const iHigh = iLow + 1;
  const frac = hourFloat - iLow;
  
  // 整数时直接返回视图,零拷贝
  if (frac < 1e-6) return scalar.getFrame(iLow);
  
  const frameLow = scalar.getFrame(iLow);
  const frameHigh = scalar.getFrame(iHigh);
  
  // 插值需要新分配数组
  const result = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    const a = frameLow[i];
    const b = frameHigh[i];
    // 任一为 NaN 则结果 NaN (陆地)
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      result[i] = NaN;
    } else {
      result[i] = a * (1 - frac) + b * frac;
    }
  }
  return result;
}


/**
 * 把 oceanCells 和当前帧数据合并成"带颜色的 polygon 列表"。
 */
export function buildColoredCells(
  oceanCells,
  frameData,
  nXi,
  colorMin,
  colorMax,
  cmap,
  alpha
) {
  const result = [];
  for (let i = 0; i < oceanCells.length; i++) {
    const cell = oceanCells[i];
    const value = frameData[cell.row * nXi + cell.col];
    if (!Number.isFinite(value)) continue;
    
    const color = valueToRGBA(value, colorMin, colorMax, cmap, alpha);
    
    result.push({
      polygon: cell.polygon,
      color,
      value,
      row: cell.row,
      col: cell.col,
    });
  }
  return result;
}


/**
 * 计算"当前帧"的 min/max (用于 "Hour" 颜色范围模式)
 */
export function computeFrameMinMax(frameData) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < frameData.length; i++) {
    const v = frameData[i];
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  return { min, max };
}


/**
 * 创建 DeckGL PolygonLayer。
 */
export function createScalarLayer({ id, coloredCells, updateTriggerKey }) {
  return new PolygonLayer({
    id,
    data: coloredCells,
    getPolygon: (d) => d.polygon,
    getFillColor: (d) => d.color,
    stroked: false,
    filled: true,
    pickable: false,
    parameters: {
      depthTest: false,
      blend: true,
    },
    updateTriggers: {
      // 任何颜色相关参数变, 重新读 color
      getFillColor: [updateTriggerKey],
    },
  });
}


/**
 * 点击采样: 在原始网格上找最近 cell 的值。
 * 
 * ⭐ 自适应距离阈值 (修复粗网格点击大量 "No data" 的 bug):
 *   不再用写死的 maxDistanceDeg —— 那个值是给 Perth 500m 网格调的,
 *   放到 2km 网格 (cwa / wrf_d01 / wrf_d02) 上, 点在格子边界附近就会
 *   被误判成 "No data".
 *   
 *   现在的做法: 找到最近的 cell 后, 用【那个 cell 自己的尺寸】作为阈值
 *   基准 —— 如果点到 cell 中心的距离 <= cell 对角线长度 (留足余量),
 *   就认为点落在这个格子里, 采样有效. 不同分辨率的网格自动适配,
 *   无需任何配置.
 *   
 *   仍然能正确返回 null 的情况: 点到了网格范围以外很远的地方
 *   (比如世界另一边), 那时最近 cell 也在很远, 距离远超它的对角线.
 * 
 * @param {Array} oceanCells  网格 cell 列表, 每个有 polygon (4 角点)
 * @param {Float32Array} frameData  当前帧标量数据
 * @param {number} nXi  网格列数
 * @param {number} lon, lat  点击的经纬度
 * @param {number} [fallbackMaxDeg]  兜底阈值: 万一 cell 没有 polygon
 *        信息时用 (正常情况用不到). 默认 0.05.
 */
export function sampleAtPoint(oceanCells, frameData, nXi, lon, lat, fallbackMaxDeg = 0.05) {
  let bestDist = Infinity;
  let bestValue = null;
  let bestCell = null;
  
  for (let i = 0; i < oceanCells.length; i++) {
    const cell = oceanCells[i];
    const cx = (cell.polygon[0][0] + cell.polygon[2][0]) / 2;
    const cy = (cell.polygon[0][1] + cell.polygon[2][1]) / 2;
    const dx = cx - lon;
    const dy = cy - lat;
    const dist = dx * dx + dy * dy;
    
    if (dist < bestDist) {
      const value = frameData[cell.row * nXi + cell.col];
      if (Number.isFinite(value)) {
        bestDist = dist;
        bestValue = value;
        bestCell = cell;
      }
    }
  }
  
  if (bestCell == null) return null;
  
  // ⭐ 用最近 cell 自己的对角线长度作为距离阈值.
  //   polygon[0] 和 polygon[2] 是对角的两个角点.
  //   对角线长度 = 这个格子的"尺寸". 点到中心的距离只要不超过
  //   对角线 (相当于格子半径的 ~2 倍, 余量充足), 就算落在格子内.
  const p0 = bestCell.polygon[0];
  const p2 = bestCell.polygon[2];
  const diagDx = p2[0] - p0[0];
  const diagDy = p2[1] - p0[1];
  const diagLenSq = diagDx * diagDx + diagDy * diagDy;
  
  // 阈值: 优先用 cell 对角线; 万一 polygon 异常 (对角线为 0),
  // 退回到 fallbackMaxDeg.
  const maxDistSq = diagLenSq > 1e-12
    ? diagLenSq
    : fallbackMaxDeg * fallbackMaxDeg;
  
  if (bestDist > maxDistSq) {
    return null;
  }
  
  return bestValue;
}
