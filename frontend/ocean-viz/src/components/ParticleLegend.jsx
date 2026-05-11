/**
 * components/ParticleLegend.jsx
 * =============================
 * 
 * 粒子流速图例。
 * 显示粒子颜色 → 流速 (m/s) 的映射。
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


export default function ParticleLegend({ bottomOffset = 110 }) {
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
          Current speed (m/s)
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
        <span>0</span>
        <span>0.25</span>
        <span>0.5</span>
        <span>0.75</span>
        <span>1.0+</span>
      </div>
    </div>
  );
}