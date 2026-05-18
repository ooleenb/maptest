/**
 * render/colormaps.js
 * ===================
 * 
 * 多 colormap 库 + 配色映射函数。
 * 
 * 包含的 colormap (来源):
 * - windyTemp: Windy.com / ECMWF-style 温度配色 (蓝→青→黄→红, 用于海面温度)
 * - thermal:   cmocean.thermal   适合温度 (深紫→红→黄, 备选)
 * - haline:    cmocean.haline    适合盐度
 * - balance:   cmocean.balance   适合双极性数据 (如 SSH, 有正负)
 * - viridis:   matplotlib        通用, 对色盲友好
 * - RdBu_r:    matplotlib        通用, 蓝-白-红
 * - rainWindy: ⭐ Windy.com 风格降雨配色 (低值透明 → 浅蓝 → 黄 → 红 → 紫)
 * - cloudWhite: ⭐ 云量配色 (低值透明 → 浅灰 → 深灰白)
 * 
 * Colormap 函数签名:
 *   (t: 0..1) → [r, g, b]      // 不透明色 (传统)
 *   (t: 0..1) → [r, g, b, a]   // 含 alpha 透明度 (rainWindy / cloudWhite)
 * 
 * 调用方 (valueToRGBA) 检查返回长度: 4 元就用 colormap 自带 alpha,
 * 3 元就用调用方传入的全局 alpha. 两种 colormap 可以混在一起用.
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
 * 给一个 stops 数组(每个元素 {t, color: [r,g,b] 或 [r,g,b,a]}),
 * 返回一个 colormap 函数. 颜色和 alpha 都做线性插值.
 * 
 * 输入 stops 是 RGB (3 元) -> 输出 [r, g, b]
 * 输入 stops 是 RGBA (4 元) -> 输出 [r, g, b, a]
 */
function makeColormap(stops) {
  // 检测输入是 RGB 还是 RGBA. 假设整张表保持一致.
  const hasAlpha = stops[0].color.length === 4;
  
  return function (t) {
    t = clamp01(t);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (t >= a.t && t <= b.t) {
        const localT = (t - a.t) / (b.t - a.t);
        const r = Math.round(lerp(a.color[0], b.color[0], localT));
        const g = Math.round(lerp(a.color[1], b.color[1], localT));
        const bl = Math.round(lerp(a.color[2], b.color[2], localT));
        if (hasAlpha) {
          const al = Math.round(lerp(a.color[3], b.color[3], localT));
          return [r, g, bl, al];
        }
        return [r, g, bl];
      }
    }
    return stops[stops.length - 1].color;
  };
}

/**
 * 根据 colormap 函数自动生成 CSS gradient 字符串。
 * 用 9 个采样点足够看不出阶梯。
 * 对含 alpha 的 colormap 用 rgba(), 不含的用 rgb().
 */
function buildCssGradient(cmapFn) {
  const stops = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const c = cmapFn(t);
    const pct = Math.round(t * 100);
    if (c.length === 4) {
      // alpha 是 0-255, CSS 要 0-1
      const aCss = (c[3] / 255).toFixed(2);
      stops.push(`rgba(${c[0]},${c[1]},${c[2]},${aCss}) ${pct}%`);
    } else {
      stops.push(`rgb(${c[0]},${c[1]},${c[2]}) ${pct}%`);
    }
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}


// ============================================================
// Colormap 0: windyTemp - Windy.com / ECMWF 温度配色
// 蓝 → 青绿 → 黄 → 橙 → 红
// ============================================================
export const windyTemp = makeColormap([
  { t: 0.00, color: [ 35, 100, 188] },
  { t: 0.12, color: [ 48, 146, 196] },
  { t: 0.25, color: [ 85, 191, 184] },
  { t: 0.40, color: [167, 219, 130] },
  { t: 0.55, color: [255, 234, 102] },
  { t: 0.70, color: [255, 184,  76] },
  { t: 0.83, color: [236, 114,  60] },
  { t: 0.93, color: [211,  56,  61] },
  { t: 1.00, color: [167,  26,  72] },
]);


// ============================================================
// Colormap 1: thermal (cmocean) - 温度
// ============================================================
export const thermal = makeColormap([
  { t: 0.00, color: [4,   35,  51 ] },
  { t: 0.13, color: [38,  41,  100] },
  { t: 0.25, color: [78,  40,  130] },
  { t: 0.38, color: [126, 47,  126] },
  { t: 0.50, color: [167, 65,  110] },
  { t: 0.63, color: [205, 92,  85 ] },
  { t: 0.75, color: [234, 132, 65 ] },
  { t: 0.88, color: [248, 184, 81 ] },
  { t: 1.00, color: [231, 250, 173] },
]);


// ============================================================
// Colormap 2: haline (cmocean) - 盐度
// ============================================================
export const haline = makeColormap([
  { t: 0.00, color: [42,  24,  108] },
  { t: 0.13, color: [33,  53,  142] },
  { t: 0.25, color: [22,  88,  151] },
  { t: 0.38, color: [27,  119, 146] },
  { t: 0.50, color: [39,  150, 138] },
  { t: 0.63, color: [69,  179, 124] },
  { t: 0.75, color: [128, 203, 99 ] },
  { t: 0.88, color: [199, 220, 95 ] },
  { t: 1.00, color: [253, 238, 153] },
]);


// ============================================================
// Colormap 3: balance (cmocean) - 双极性数据
// ============================================================
export const balance = makeColormap([
  { t: 0.00, color: [24,  28,  67 ] },
  { t: 0.13, color: [40,  77,  131] },
  { t: 0.25, color: [73,  130, 173] },
  { t: 0.38, color: [144, 184, 207] },
  { t: 0.50, color: [243, 240, 234] },
  { t: 0.63, color: [220, 152, 138] },
  { t: 0.75, color: [187, 86,  79 ] },
  { t: 0.88, color: [137, 32,  60 ] },
  { t: 1.00, color: [60,  9,   17 ] },
]);


// ============================================================
// Colormap 4: viridis (matplotlib) - 通用
// ============================================================
export const viridis = makeColormap([
  { t: 0.00, color: [68,  1,   84 ] },
  { t: 0.13, color: [72,  35,  116] },
  { t: 0.25, color: [64,  67,  135] },
  { t: 0.38, color: [52,  94,  141] },
  { t: 0.50, color: [41,  120, 142] },
  { t: 0.63, color: [32,  144, 140] },
  { t: 0.75, color: [34,  167, 132] },
  { t: 0.88, color: [68,  190, 112] },
  { t: 1.00, color: [253, 231, 36 ] },
]);


// ============================================================
// Colormap 5: RdBu_r (matplotlib) - 蓝-白-红
// ============================================================
export const RdBu_r = makeColormap([
  { t: 0.00, color: [33,  102, 172] },
  { t: 0.15, color: [67,  147, 195] },
  { t: 0.30, color: [146, 197, 222] },
  { t: 0.45, color: [209, 229, 240] },
  { t: 0.58, color: [247, 247, 247] },
  { t: 0.72, color: [253, 219, 199] },
  { t: 0.85, color: [244, 165, 130] },
  { t: 1.00, color: [178, 24,  43 ] },
]);


// ============================================================
// Colormap 6: rainWindy ⭐ NEW - Windy.com 降雨配色 (含透明度)
//
// 设计:
//   - 低值完全透明 (没雨, 不挡海温色场或底图)
//   - 微雨开始渐显, 浅蓝
//   - 中段经过蓝绿 → 黄 → 红 → 紫 (从中雨到暴雨), 越下越不透明
//
// 使用前提: rain 单位已换算成 mm/h (后端 var_map.scales 已乘 3600),
//   colorMin=0, colorMax 由数据决定 (App.jsx 对 rain 用 0~global_max).
//
// 透明度区间 (假设典型 colorMax ≈ 5-10 mm/h):
//   t < 0.02 (≈ 没雨):       完全透明
//   t = 0.02-0.20 (微雨):    渐显 (0 → ~180 alpha)
//   t > 0.20 (中雨以上):    几乎不透明 (220-255 alpha)
//
// 颜色参考 Windy.com 雨配色:
//   浅蓝 -> 蓝绿 -> 黄 -> 橙 -> 红 -> 紫
// ============================================================
export const rainWindy = makeColormap([
  { t: 0.00, color: [120, 180, 220,   0] },
  { t: 0.02, color: [120, 180, 220,   0] },
  { t: 0.08, color: [110, 170, 220,  80] },
  { t: 0.20, color: [ 90, 170, 200, 180] },
  { t: 0.35, color: [100, 200, 130, 220] },
  { t: 0.50, color: [220, 220,  70, 235] },
  { t: 0.65, color: [240, 170,  60, 240] },
  { t: 0.80, color: [230,  90,  70, 245] },
  { t: 0.92, color: [190,  50, 110, 250] },
  { t: 1.00, color: [140,  40, 130, 255] },
]);


// ============================================================
// Colormap 7: cloudWhite ⭐ NEW - 云量配色 (含透明度)
//
// 设计:
//   - 低值完全透明 (晴空, 不挡底下)
//   - 中值浅白渐显 (淡云)
//   - 高值深灰白 (厚云, 像 GFS Total Cloud Cover 图)
//
// 使用前提: cloud 单位已换算成 % (后端乘 100), colorMin=0, colorMax=100
//   (用 p1-p99 也可以, cloud 没有 rain 那种"99% 是零"的稀疏问题)
//
// 透明度区间:
//   t < 0.10 (< 10% 云量):    完全透明 (晴)
//   t = 0.10-0.35 (少云):      渐显 (0 → ~120 alpha)
//   t > 0.55 (多云以上):       不透明 (180-245 alpha)
// ============================================================
export const cloudWhite = makeColormap([
  { t: 0.00, color: [255, 255, 255,   0] },
  { t: 0.10, color: [255, 255, 255,   0] },
  { t: 0.20, color: [245, 248, 250,  50] },
  { t: 0.35, color: [230, 235, 240, 120] },
  { t: 0.55, color: [205, 215, 225, 180] },
  { t: 0.75, color: [175, 185, 195, 220] },
  { t: 1.00, color: [130, 140, 150, 245] },
]);


// ============================================================
// 注册表: name → {fn, css, label}
// 顺序决定了 UI 里的展示顺序
// ============================================================
export const COLORMAPS = {
  windyTemp: {
    name: "windyTemp",
    label: "Windy Temp",
    fn: windyTemp,
    css: buildCssGradient(windyTemp),
    description: "Blue-cyan-yellow-red (Windy.com style, for SST)",
  },
  thermal: {
    name: "thermal",
    label: "Thermal",
    fn: thermal,
    css: buildCssGradient(thermal),
    description: "Black-purple-red-yellow (cmocean, for temperature)",
  },
  haline: {
    name: "haline",
    label: "Haline",
    fn: haline,
    css: buildCssGradient(haline),
    description: "Blue-green-yellow (designed for salinity)",
  },
  balance: {
    name: "balance",
    label: "Balance",
    fn: balance,
    css: buildCssGradient(balance),
    description: "Blue-white-red (for diverging data like SSH)",
  },
  viridis: {
    name: "viridis",
    label: "Viridis",
    fn: viridis,
    css: buildCssGradient(viridis),
    description: "Purple-blue-green-yellow (perceptually uniform)",
  },
  RdBu_r: {
    name: "RdBu_r",
    label: "RdBu reversed",
    fn: RdBu_r,
    css: buildCssGradient(RdBu_r),
    description: "Blue-white-red (classic diverging)",
  },
  // ⭐ 含透明度的特殊用途 colormap
  rainWindy: {
    name: "rainWindy",
    label: "Rain (Windy)",
    fn: rainWindy,
    css: buildCssGradient(rainWindy),
    description: "Transparent → blue → yellow → red → purple (for rainfall)",
  },
  cloudWhite: {
    name: "cloudWhite",
    label: "Cloud",
    fn: cloudWhite,
    css: buildCssGradient(cloudWhite),
    description: "Transparent → light → dark grey (for cloud cover)",
  },
};


// ============================================================
// 每个变量的默认 colormap
// ============================================================
// ROMS 海洋变量:   temp / salt / zeta
// WRF 大气变量:    temp(气温, 复用 windyTemp) / Pair / Qair / rain / cloud
export const DEFAULT_COLORMAP = {
  // --- ROMS / 通用 ---
  temp: "windyTemp",
  salt: "haline",
  zeta: "balance",
  // --- WRF 大气专属 ---
  Pair:  "RdBu_r",
  Qair:  "viridis",
  rain:  "rainWindy",     // ⭐ 改: 专门的带透明 rain colormap
  cloud: "cloudWhite",    // ⭐ 改: 专门的带透明 cloud colormap
};


// ============================================================
// 变量的单位
// ============================================================
export const VARIABLE_UNITS = {
  // --- ROMS / 通用 ---
  temp: "°C",
  salt: "",
  zeta: "m",
  // --- WRF 大气专属 ---
  Pair:  "mbar",
  Qair:  "%",
  rain:  "mm/h",   // ⭐ 改: 后端已经乘 3600, 现在是 mm/h
  cloud: "%",      // ⭐ 改: 后端已经乘 100, 现在是百分比
};


// ============================================================
// 高层封装: 把值映射到 RGBA
// ============================================================
// alpha 参数语义:
//   - 如果 cmap 返回 [r,g,b,a] (自带 alpha): 用 cmap 的 a × (alpha/255)
//     作为最终 alpha. 这样 opacity 滑块对 rain/cloud 仍起作用 ——
//     拉低 opacity 时, 已经半透明的雨也整体变更淡.
//   - 如果 cmap 返回 [r,g,b] (无 alpha): 直接用 alpha 当最终 alpha
//     (老逻辑, 不变).
export function valueToRGBA(value, min, max, cmap, alpha = 200) {
  if (!Number.isFinite(value)) return [0, 0, 0, 0];
  const t = (value - min) / (max - min || 1);
  const c = cmap(t);
  if (c.length === 4) {
    // cmap 自带 alpha. cmap_a × (alpha/255) = 最终 alpha.
    const effectiveAlpha = Math.round(c[3] * (alpha / 255));
    return [c[0], c[1], c[2], effectiveAlpha];
  }
  return [c[0], c[1], c[2], alpha];
}

// ============================================================
// 智能数值格式化
// ============================================================
// 问题: 固定小数位 (toFixed(1)/toFixed(2)) 对不同量级的变量都不合适.
//   - 气压 1013    -> toFixed(1) = "1013.0"
//   - 气温 25.3    -> toFixed(1) = "25.3"
//   - 雨   3.6     -> toFixed(2) = "3.60"  (现在 mm/h, 不再是 kg/m²/s 那么小)
//
// 现在 rain 是 mm/h, 典型 0.1 ~ 30 量级, 比 kg/m²/s 好处理.
// 但保留宽容的格式化, 适配各种量级.
export function formatValue(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  
  const abs = Math.abs(v);
  
  if (abs === 0) return "0";
  if (abs >= 100)    return v.toFixed(0);
  if (abs >= 10)     return v.toFixed(1);
  if (abs >= 1)      return v.toFixed(2);
  if (abs >= 0.01)   return v.toFixed(3);
  if (abs >= 0.0001) return v.toFixed(5);
  return v.toExponential(1);
}