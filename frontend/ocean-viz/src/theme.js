/**
 * theme.js
 * ========
 * 
 * 共享主题常量。所有组件用这里的值, 保证视觉一致。
 */

export const theme = {
  // ===== 颜色 =====
  bg:          "rgba(15, 23, 42, 0.92)",  // 主面板背景
  bgSolid:     "#0f172a",                 // 实色背景
  bgHover:     "#1e293b",                 // hover/激活背景
  bgActive:    "#1e3a5f",                 // 选中态背景
  
  border:      "#1e293b",
  borderSoft:  "#334155",
  
  text:        "#f1f5f9",                 // 主文字
  textMuted:   "#94a3b8",                 // 次要文字
  textDim:     "#64748b",                 // 提示/标签
  
  accent:      "#38bdf8",                 // 唯一强调色 (天蓝)
  accentSoft:  "#7dd3fc",                 // 强调色浅色版本
  accentBg:    "rgba(56, 189, 248, 0.1)",
  
  success:     "#10b981",
  warning:     "#f59e0b",
  danger:      "#ef4444",
  
  // ===== 字号 =====
  fsLabel:     "10px",     // 大写小标签 (LABEL)
  fsSmall:     "11px",     // 次要文字
  fsBody:      "12px",     // 正文
  fsValue:     "13px",     // 强调值
  fsLarge:     "16px",     // 大值
  fsHero:      "20px",     // 主要数值
  
  // ===== 字重 =====
  fwNormal:    400,
  fwMedium:    500,
  fwBold:      600,
  
  // ===== 字体 =====
  fontFamily:  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontMono:    '"SF Mono", "Monaco", "Cascadia Code", monospace',
  
  // ===== 尺寸 =====
  topBarHeight:    44,
  sidebarWidth:    72,
  bottomBarHeight: 54,
  
  // ===== 圆角 =====
  radiusS:     "4px",
  radiusM:     "6px",
  radiusL:     "8px",
  
  // ===== 间距 =====
  z: {
    map:      1,
    chrome:   10,    // 顶栏/侧边栏/底栏
    popover:  20,    // 弹出 popover
    overlay:  100,   // 加载遮罩等
    popup:    200,   // 点击采样弹窗
  },
};

// 大写标签的统一样式
export const labelStyle = {
  fontSize: theme.fsLabel,
  fontWeight: theme.fwMedium,
  letterSpacing: "0.8px",
  color: theme.textDim,
  textTransform: "uppercase",
};