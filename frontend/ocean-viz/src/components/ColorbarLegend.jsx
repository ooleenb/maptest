/**
 * components/ColorbarLegend.jsx
 * =============================
 * 
 * 右下角浮动小图例。深色风格,带范围模式徽章。
 */

import React from "react";
import { theme } from "../theme.js";
import { formatValue } from "../render/colormaps.js";


// 变量显示标题. ROMS 海洋变量 + WRF 大气变量都覆盖.
// 找不到的变量回退到大写形式.
const VAR_TITLES = {
  // --- ROMS 海洋 ---
  temp: "Temperature",
  salt: "Salinity",
  zeta: "Sea level",
  // --- WRF 大气 ---
  Pair: "Pressure",
  Qair: "Humidity",
  rain: "Rainfall",
  cloud: "Cloud cover",
};


export default function ColorbarLegend({
  variable, min, max, cssGradient, unit, rangeMode,
}) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  
  const mid = (min + max) / 2;
  const q1 = min + (max - min) * 0.25;
  const q3 = min + (max - min) * 0.75;
  const title = VAR_TITLES[variable] ?? variable.toUpperCase();
  
  const badgeColor = rangeMode === "global" ? theme.accent : theme.warning;
  const badgeBg = rangeMode === "global"
    ? "rgba(56, 189, 248, 0.12)"
    : "rgba(245, 158, 11, 0.12)";
  
  return (
    <div style={{
      position: "absolute", right: 18, bottom: theme.bottomBarHeight + 18,
      width: 240,
      background: theme.bg,
      backdropFilter: "blur(12px)",
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radiusL,
      boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      padding: "10px 14px",
      zIndex: theme.z.chrome,
      fontFamily: theme.fontFamily,
      color: theme.text,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: theme.fsBody,
          fontWeight: theme.fwMedium,
        }}>
          {title} {unit ? `(${unit})` : ""}
        </div>
        <div style={{
          fontSize: 9, fontWeight: theme.fwMedium,
          color: badgeColor,
          background: badgeBg,
          padding: "2px 6px",
          borderRadius: theme.radiusS,
          letterSpacing: 0.3,
        }}>
          {rangeMode === "global" ? "p1-p99" : "hourly"}
        </div>
      </div>
      
      {/* ⭐ colorbar 本身. 双层 background:
          - 顶层 (cssGradient) 可能含 alpha (如 rainWindy / cloudWhite 的低值段)
          - 底层 (浅灰白) 模拟地图底图色, 让透明段显示成"浅色"而不是
            "卡片深色透出来" —— 跟用户在地图上看到的实际效果一致.
          
          CSS multiple backgrounds 语法: 越前面的越在上面. */}
      <div style={{
        height: 10, borderRadius: 999,
        background: `
          ${cssGradient},
          linear-gradient(to right, rgba(245, 248, 250, 0.9), rgba(245, 248, 250, 0.9))
        `,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
      }}/>
      
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 4,
        fontSize: 9,
        color: theme.textMuted,
        fontVariantNumeric: "tabular-nums",
      }}>
        {/* ⭐ 用 formatValue 智能格式化, 而不是写死 toFixed(1).
            否则 rainfall (0.0x ~ 0.000x 量级) 会全部显示成 "0.0". */}
        <span>{formatValue(min)}</span>
        <span>{formatValue(q1)}</span>
        <span>{formatValue(mid)}</span>
        <span>{formatValue(q3)}</span>
        <span>{formatValue(max)}</span>
      </div>
    </div>
  );
}