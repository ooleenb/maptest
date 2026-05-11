/**
 * render/scalarLayer.js
 * =====================
 * 
 * 把"网格 polygons + 一帧标量场数据"组装成 DeckGL PolygonLayer。
 * 
 * 设计:
 * - 输入: 网格 (oceanCells) + 数据帧 (Float32Array) + 配色范围
 * - 输出: 可直接放进 DeckGL <DeckGL layers={[...]}> 的 Layer 实例
 * - 内部预先把每个 cell 染色 (一次性,不在 DeckGL 每帧重算)
 * 
 * 性能关键:
 * - 用 oceanCells (已过滤的海洋格子,~25000 个) 而不是全网格 33411 个
 * - 数据是 Float32Array 扁平化的,索引访问 O(1)
 * - 染色逻辑在 JS 跑,不在 GPU——这样切换 colormap/范围都是 CPU 操作,响应快
 */

import { PolygonLayer } from "@deck.gl/layers";
import { valueToRGBA } from "./colormaps.js";


/**
 * 把 oceanCells 和当前帧数据合并成"带颜色的 polygon 列表"。
 * 
 * @param {Array} oceanCells          来自 grid.json 的海洋格子
 * @param {Float32Array} frameData    当前帧的标量值 (扁平,长度 nEta*nXi)
 * @param {number} nXi                网格列数 (用于 2D 索引)
 * @param {number} colorMin           配色下限
 * @param {number} colorMax           配色上限
 * @param {function} cmap             colormap 函数
 * @param {number} alpha              0-255
 * @returns {Array<{polygon, color, value, row, col}>}
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
 * 创建 DeckGL PolygonLayer。
 * 
 * @param {object} params
 * @param {string} params.id                Layer ID (用于 DeckGL diff)
 * @param {Array} params.coloredCells       buildColoredCells 的输出
 * @param {number} params.timeIndex         小时索引 (用于 updateTriggers)
 * @returns {PolygonLayer}
 */
export function createScalarLayer({ id, coloredCells, timeIndex }) {
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
    // updateTriggers 告诉 DeckGL: "当 timeIndex 变,重新读 color"
    // 没这个的话,DeckGL 不会知道数据变了 (因为 data 引用可能没变)
    updateTriggers: {
      getFillColor: [timeIndex],
    },
  });
}


/**
 * 在一帧数据里找最接近 (lon, lat) 的格子的值 (点击采样用)。
 * 
 * 注意: 这是 O(N) 的暴力搜索,对 25000 个 cell 大概 1-2ms,够快。
 * 未来如果要点击采样很频繁,可以加 KD-tree。
 */
export function sampleAtPoint(oceanCells, frameData, nXi, lon, lat) {
  let bestDist = Infinity;
  let bestValue = null;
  for (let i = 0; i < oceanCells.length; i++) {
    const cell = oceanCells[i];
    // 用 cell 中心作为近似位置
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
      }
    }
  }
  return bestValue;
}