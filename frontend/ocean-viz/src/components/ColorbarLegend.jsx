/**
 * components/ColorbarLegend.jsx
 * =============================
 * 
 * 右下角浮动小图例。深色风格,带范围模式徽章。
 */

import React from "react";
import { theme } from "../theme.js";


const VAR_TITLES = {
  temp: "Temperature",
  salt: "Salinity",
  zeta: "Sea level",
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
      
      <div style={{
        height: 10, borderRadius: 999,
        background: cssGradient,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
      }}/>
      
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 4,
        fontSize: 9,
        color: theme.textMuted,
        fontVariantNumeric: "tabular-nums",
      }}>
        <span>{min.toFixed(1)}</span>
        <span>{q1.toFixed(1)}</span>
        <span>{mid.toFixed(1)}</span>
        <span>{q3.toFixed(1)}</span>
        <span>{max.toFixed(1)}</span>
      </div>
    </div>
  );
}