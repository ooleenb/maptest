/**
 * popovers/OpacityPopover.jsx
 * ===========================
 * 
 * 标量场透明度 (单一滑块, 简单)。
 */

import React from "react";
import { theme } from "../../theme.js";
import { PopoverFrame } from "./VariablePopover.jsx";


export default function OpacityPopover({ opacity, setOpacity }) {
  return (
    <PopoverFrame title="SCALAR OPACITY">
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 6,
      }}>
        <span style={{
          fontSize: theme.fsSmall,
          color: theme.textMuted,
        }}>
          Layer opacity
        </span>
        <span style={{
          fontSize: theme.fsValue,
          fontWeight: theme.fwMedium,
          color: theme.text,
          fontVariantNumeric: "tabular-nums",
        }}>
          {Math.round(opacity * 100)}%
        </span>
      </div>
      
      <input
        type="range"
        min="0" max="1" step="0.01"
        value={opacity}
        onChange={(e) => setOpacity(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: theme.accent,
          cursor: "pointer",
        }}
      />
      
      <div style={{
        marginTop: 12, fontSize: 10, color: theme.textDim,
        lineHeight: 1.4,
      }}>
        Controls how strongly the colored ocean layer blends with the basemap.
      </div>
    </PopoverFrame>
  );
}