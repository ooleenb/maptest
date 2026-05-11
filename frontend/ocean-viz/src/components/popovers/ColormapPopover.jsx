/**
 * popovers/ColormapPopover.jsx
 * ============================
 * 
 * 配色 + 颜色范围模式 popover。
 */

import React from "react";
import { COLORMAPS } from "../../render/colormaps.js";
import { theme, labelStyle } from "../../theme.js";
import { PopoverFrame } from "./VariablePopover.jsx";


export default function ColormapPopover({
  colormapKey,
  setColormapKey,
  rangeMode,
  setRangeMode,
}) {
  return (
    <PopoverFrame title="COLORS">
      {/* 配色选择 */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 4, marginBottom: 14,
      }}>
        {Object.entries(COLORMAPS).map(([key, info]) => {
          const isActive = colormapKey === key;
          return (
            <button
              key={key}
              onClick={() => setColormapKey(key)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "6px 8px",
                background: isActive ? theme.bgActive : "transparent",
                border: `1px solid ${isActive ? theme.accent : "transparent"}`,
                borderRadius: theme.radiusM,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 150ms",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = theme.bgHover;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{
                width: 56, height: 12, borderRadius: 2,
                background: info.css,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
                flexShrink: 0,
              }}/>
              <span style={{
                fontSize: theme.fsSmall,
                fontWeight: isActive ? theme.fwMedium : theme.fwNormal,
                color: isActive ? theme.text : theme.textMuted,
              }}>
                {info.label}
              </span>
            </button>
          );
        })}
      </div>
      
      {/* 范围模式 */}
      <div style={{ ...labelStyle, marginBottom: 6, marginTop: 6 }}>
        RANGE MODE
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <RangeModeButton
          active={rangeMode === "global"}
          onClick={() => setRangeMode("global")}
          label="Global"
          hint="p1-p99"
        />
        <RangeModeButton
          active={rangeMode === "hour"}
          onClick={() => setRangeMode("hour")}
          label="Hour"
          hint="adaptive"
        />
      </div>
      
      <div style={{
        marginTop: 10, fontSize: 10, color: theme.textDim,
        lineHeight: 1.4,
      }}>
        Global keeps colors comparable across hours.<br/>
        Hour maximizes contrast within each frame.
      </div>
    </PopoverFrame>
  );
}


function RangeModeButton({ active, onClick, label, hint }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 6px",
        background: active ? theme.bgActive : "transparent",
        border: `1px solid ${active ? theme.accent : theme.borderSoft}`,
        borderRadius: theme.radiusM,
        color: active ? theme.text : theme.textMuted,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "center",
        transition: "all 150ms",
      }}
    >
      <div style={{
        fontSize: theme.fsSmall,
        fontWeight: theme.fwMedium,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 9,
        color: active ? theme.accentSoft : theme.textDim,
        marginTop: 2,
      }}>
        {hint}
      </div>
    </button>
  );
}