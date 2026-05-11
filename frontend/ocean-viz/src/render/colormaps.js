/**
 * render/colormaps.js
 * ===================
 * 
 * 多 colormap 库 + 配色映射函数。
 * 
 * 包含的 colormap (来源):
 * - thermal:  cmocean.thermal   适合温度
 * - haline:   cmocean.haline    适合盐度
 * - balance:  cmocean.balance   适合双极性数据 (如 SSH, 有正负)
 * - viridis:  matplotlib        通用, 对色盲友好
 * - RdBu_r:   matplotlib        通用, 蓝-白-红
 * 
 * 每个 colormap 是一个函数 (t: 0..1) → [r, g, b]
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

/**
 * 根据 colormap 函数自动生成 CSS gradient 字符串。
 * 用 9 个采样点足够看不出阶梯。
 */
function buildCssGradient(cmapFn) {
  const stops = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const [r, g, b] = cmapFn(t);
    stops.push(`rgb(${r},${g},${b}) ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}


// ============================================================
// Colormap 1: thermal (cmocean) - 温度
// 紫黑 → 红橙 → 黄白
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
// 深紫蓝 → 蓝绿 → 黄绿 → 米黄
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
// Colormap 3: balance (cmocean) - 双极性数据 (适合 SSH)
// 深蓝 → 白 → 深红
// 中点 (0.5) 应该对应数据的 "零点" 或参考值
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
// 紫 → 蓝 → 绿 → 黄  (对色盲友好, 感知均匀)
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
// 中性, 也能用于双极性数据
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
// 注册表: name → {fn, css, label}
// ============================================================
export const COLORMAPS = {
  thermal: {
    name: "thermal",
    label: "Thermal",
    fn: thermal,
    css: buildCssGradient(thermal),
    description: "Black-purple-red-yellow (good for temperature)",
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
};


// ============================================================
// 每个变量的默认 colormap
// ============================================================
export const DEFAULT_COLORMAP = {
  temp: "thermal",
  salt: "haline",
  zeta: "balance",
};


// ============================================================
// 变量的单位
// ============================================================
export const VARIABLE_UNITS = {
  temp: "°C",
  salt: "",     // 盐度通常无量纲 (PSU)
  zeta: "m",
};


// ============================================================
// 高层封装: 把值映射到 RGBA
// ============================================================
export function valueToRGBA(value, min, max, cmap, alpha = 200) {
  if (!Number.isFinite(value)) return [0, 0, 0, 0];
  const t = (value - min) / (max - min || 1);
  const [r, g, b] = cmap(t);
  return [r, g, b, alpha];
}