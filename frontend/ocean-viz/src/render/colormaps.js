/**
 * render/colormaps.js
 * ===================
 * 
 * 配色函数库。
 * 
 * 每个 colormap 是一个函数 (t: 0..1) → [r, g, b]。
 * 上层用 alpha 自己处理透明度。
 * 
 * 这一步先只放 1 套配色 (温度用 RdBu_r)。
 * Step 3.3 会加更多: viridis / haline / balance / thermal 等。
 */

// ============================================================
// 工具
// ============================================================
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * 给一个 stops 数组(每个元素 {t, color: [r,g,b]}),
 * 返回一个 colormap 函数。
 */
function makeColormap(stops) {
  return function (t) {
    t = clamp01(t);
    // 二分找区间
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (t >= a.t && t <= b.t) {
        const localT = (t - a.t) / (b.t - a.t);
        return [
          Math.round(lerp(a.color[0], b.color[0], localT)),
          Math.round(lerp(a.color[1], b.color[1], localT)),
          Math.round(lerp(a.color[2], b.color[2], localT)),
        ];
      }
    }
    return stops[stops.length - 1].color;
  };
}

// ============================================================
// 温度配色: RdBu_r (蓝-白-红, 冷-暖)
// 来源: matplotlib RdBu_r
// ============================================================
export const RdBu_r = makeColormap([
  { t: 0.0, color: [33, 102, 172] },
  { t: 0.15, color: [67, 147, 195] },
  { t: 0.3, color: [146, 197, 222] },
  { t: 0.45, color: [209, 229, 240] },
  { t: 0.58, color: [247, 247, 247] },
  { t: 0.72, color: [253, 219, 199] },
  { t: 0.85, color: [244, 165, 130] },
  { t: 1.0, color: [178, 24, 43] },
]);

// 用于 CSS gradient 字符串 (图例用)
export const RdBu_r_CSS =
  "linear-gradient(to right, " +
  "rgb(33,102,172), rgb(67,147,195), rgb(146,197,222), rgb(209,229,240), " +
  "rgb(247,247,247), rgb(253,219,199), rgb(244,165,130), rgb(178,24,43))";


// ============================================================
// 高层封装: 把值映射到颜色 + alpha
// ============================================================
/**
 * 给定一个值和值域,返回 RGBA 颜色 (用于 DeckGL)。
 * 
 * @param {number} value  数据值
 * @param {number} min    值域下限
 * @param {number} max    值域上限
 * @param {function} cmap colormap 函数 (默认 RdBu_r)
 * @param {number} alpha  0-255
 * @returns {[r, g, b, a]}
 */
export function valueToRGBA(value, min, max, cmap = RdBu_r, alpha = 200) {
  if (!Number.isFinite(value)) {
    return [0, 0, 0, 0]; // 透明
  }
  const t = (value - min) / (max - min || 1);
  const [r, g, b] = cmap(t);
  return [r, g, b, alpha];
}


// ============================================================
// 注册表: 变量 → 推荐 colormap
// ============================================================
export const VARIABLE_COLORMAPS = {
  temp: { name: "RdBu_r", fn: RdBu_r, css: RdBu_r_CSS, unit: "°C" },
  salt: { name: "RdBu_r", fn: RdBu_r, css: RdBu_r_CSS, unit: "" },
  zeta: { name: "RdBu_r", fn: RdBu_r, css: RdBu_r_CSS, unit: "m" },
};