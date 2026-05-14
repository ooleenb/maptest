/**
 * components/ParticleLegend.jsx
 * =============================
 * 
 * 粒子速度图例。
 * 显示粒子颜色 → 速度 (m/s) 的映射。
 * 
 * ⭐ 根据数据源类型自适应:
 *   - 海洋流场 (ocean):      "Current speed", 刻度 0 ~ 1.0+ m/s
 *   - 大气风场 (atmosphere): "Wind speed",    刻度 0 ~ 12+ m/s
 *   颜色 stops 本身不变 (蓝→黄→红), 变的是标签和刻度数字。
 * 
 * 只在粒子开启时显示, 位置紧贴温度图例上方。
 */

import React from "react";
import { theme } from "../theme.js";


// 与 particles.js 里 speedToRGB 函数的 stops 保持一致
// 用 CSS gradient 字符串呈现
const SPEED_GRADIENT_CSS =
  "linear-gradient(to right, " +
  "rgb(56,189,248) 0%, " +
  "rgb(96,165,250) 35%, " +
  "rgb(250,204,21) 60%, " +
  "rgb(251,146,60) 85%, " +
  "rgb(239,68,68) 100%)";


// 根据 kind 返回图例的标题 + 5 个刻度标签
// 刻度对应 speedToRGB 的归一化: 海洋 maxSpeed=1.0, 大气 maxSpeed=12.0
// 5 个标签对应 t = 0, 0.25, 0.5, 0.75, 1.0
function getLegendConfig(kind) {
  if (kind === "atmosphere") {
    // 大气风场: maxSpeed = 12 m/s
    return {
      title: "Wind speed (m/s)",
      ticks: ["0", "3", "6", "9", "12+"],
    };
  }
  // 海洋流场 (默认): maxSpeed = 1.0 m/s
  return {
    title: "Current speed (m/s)",
    ticks: ["0", "0.25", "0.5", "0.75", "1.0+"],
  };
}


export default function ParticleLegend({ bottomOffset = 110, kind = "ocean" }) {
  const { title, ticks } = getLegendConfig(kind);
  
  return (
    <div style={{
      position: "absolute",
      right: 18,
      bottom: theme.bottomBarHeight + bottomOffset,
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
          {title}
        </div>
        <div style={{
          fontSize: 9, fontWeight: theme.fwMedium,
          color: theme.accent,
          background: "rgba(56, 189, 248, 0.12)",
          padding: "2px 6px",
          borderRadius: theme.radiusS,
          letterSpacing: 0.3,
        }}>
          particles
        </div>
      </div>
      
      <div style={{
        height: 10,
        borderRadius: 999,
        background: SPEED_GRADIENT_CSS,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
      }}/>
      
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 4,
        fontSize: 9,
        color: theme.textMuted,
        fontVariantNumeric: "tabular-nums",
      }}>
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}