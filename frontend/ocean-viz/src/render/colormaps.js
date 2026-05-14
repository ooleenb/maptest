/**
 * render/colormaps.js
 * ===================
 * 
 * 多 colormap 库 + 配色映射函数。
 * 
 * 包含的 colormap (来源):
 * - windyTemp: Windy.com / ECMWF-style 温度配色 (蓝→青→黄→红, 用于海面温度) ⭐ 新增
 * - thermal:   cmocean.thermal   适合温度 (深紫→红→黄, 备选)
 * - haline:    cmocean.haline    适合盐度
 * - balance:   cmocean.balance   适合双极性数据 (如 SSH, 有正负)
 * - viridis:   matplotlib        通用, 对色盲友好
 * - RdBu_r:    matplotlib        通用, 蓝-白-红
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
// Colormap 0: windyTemp - Windy.com / ECMWF 温度配色 ⭐ NEW
// 蓝 → 青绿 → 黄 → 橙 → 红
// 模仿 windy.com 的温度色带, 但优化到海面温度典型范围 (~12°C - 33°C)
// 与 windy 的设计原则一致: 0°C 附近过渡到青色, 高温红色, 低温蓝色
// ============================================================
export const windyTemp = makeColormap([
  { t: 0.00, color: [ 35, 100, 188] },  // 蓝   (冷)
  { t: 0.12, color: [ 48, 146, 196] },  // 浅蓝
  { t: 0.25, color: [ 85, 191, 184] },  // 青绿
  { t: 0.40, color: [167, 219, 130] },  // 黄绿
  { t: 0.55, color: [255, 234, 102] },  // 黄
  { t: 0.70, color: [255, 184,  76] },  // 橘黄
  { t: 0.83, color: [236, 114,  60] },  // 橙
  { t: 0.93, color: [211,  56,  61] },  // 红橙
  { t: 1.00, color: [167,  26,  72] },  // 深红 (热)
]);


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
};


// ============================================================
// 每个变量的默认 colormap
// ============================================================
// ROMS 海洋变量:   temp / salt / zeta
// WRF 大气变量:    temp(气温, 复用 windyTemp) / Pair / Qair / rain / cloud
//
// 注: WRF 的 temp 和 ROMS 的 temp 共用 key "temp", 所以都用 windyTemp ——
//     气温和海温都是温度, windyTemp 配色对两者都合适。
//     Pair/Qair/rain/cloud 给了能用的默认值, 用户可在 colormap 选择器里随意更换。
export const DEFAULT_COLORMAP = {
  // --- ROMS / 通用 ---
  temp: "windyTemp",   // ⭐ Windy 风格 (海温 + 气温通用)
  salt: "haline",
  zeta: "balance",
  // --- WRF 大气专属 ---
  Pair:  "RdBu_r",     // 海平面气压 - 蓝白红双极性
  Qair:  "viridis",    // 相对湿度 - 通用感知均匀
  rain:  "viridis",    // 降雨率 - 通用
  cloud: "viridis",    // 云量 - 通用
};


// ============================================================
// 变量的单位
// ============================================================
export const VARIABLE_UNITS = {
  // --- ROMS / 通用 ---
  temp: "°C",
  salt: "",      // 盐度通常无量纲 (PSU)
  zeta: "m",
  // --- WRF 大气专属 ---
  Pair:  "mbar", // 海平面气压
  Qair:  "%",    // 相对湿度
  rain:  "kg/m²/s", // 降雨率
  cloud: "",     // 云量 (0-1 无量纲)
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

// ============================================================
// 智能数值格式化
// ============================================================
// 问题: 固定小数位 (toFixed(1)/toFixed(2)) 对不同量级的变量都不合适.
//   - 气压 1013    -> toFixed(1) = "1013.0"  (多余的 .0)
//   - 气温 25.3    -> toFixed(1) = "25.3"    (刚好)
//   - 降雨 0.001   -> toFixed(1) = "0.0"     (❌ 信息全丢了!)
//   - 降雨 0.00002 -> toFixed(2) = "0.00"    (❌ 同样全丢)
//
// 解法: 根据数值的绝对大小, 动态选择合适的小数位数, 保证总能看到
//   有意义的有效数字. 降雨这种 0.0x ~ 0.000x 量级的值也能正常显示.
//
// 用于: ColorbarLegend 的刻度数字、PointPopup 的采样值.
export function formatValue(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  
  const abs = Math.abs(v);
  
  if (abs === 0) return "0";
  if (abs >= 100)    return v.toFixed(0);   // 1013
  if (abs >= 10)     return v.toFixed(1);   // 25.3
  if (abs >= 1)      return v.toFixed(2);   // 3.60
  if (abs >= 0.01)   return v.toFixed(3);   // 0.021  <- rain 的有雨格子
  if (abs >= 0.0001) return v.toFixed(5);   // 0.00101 <- rain 的 p99
  // 极小值 (例如 1e-6 级别): 用科学计数法, 否则要一长串 0
  return v.toExponential(1);                // 1.2e-7
}