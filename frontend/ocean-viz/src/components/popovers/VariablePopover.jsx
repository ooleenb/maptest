/**
 * popovers/VariablePopover.jsx
 * ============================
 * 
 * 变量切换 popover (温度/盐度/SSH)。
 * 显示当前选中的变量,以及实时数据范围。
 */

import React from "react";
import { Thermometer, Droplet, Waves } from "lucide-react";
import { theme, labelStyle } from "../../theme.js";


const VARIABLE_OPTIONS = [
  {
    key: "temp",
    icon: Thermometer,
    label: "Temperature",
    unit: "°C",
    description: "Sea surface temperature",
  },
  {
    key: "salt",
    icon: Droplet,
    label: "Salinity",
    unit: "PSU",
    description: "Sea surface salinity",
  },
  {
    key: "zeta",
    icon: Waves,
    label: "Sea level",
    unit: "m",
    description: "Sea surface height anomaly",
  },
];


export default function VariablePopover({
  variable,
  setVariable,
  ranges,           // {temp:{p01,p99},salt:{...},zeta:{...}}
  currentValue,     // 可选: 当前小时全图的均值/中位数, 这里不强求
}) {
  return (
    <PopoverFrame title="VARIABLE">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {VARIABLE_OPTIONS.map((opt) => {
          const isActive = variable === opt.key;
          const range = ranges?.[opt.key];
          const Icon = opt.icon;
          return (
            <button
              key={opt.key}
              onClick={() => setVariable(opt.key)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px",
                background: isActive ? theme.bgActive : "transparent",
                border: `1px solid ${isActive ? theme.accent : theme.border}`,
                borderRadius: theme.radiusM,
                cursor: "pointer",
                color: theme.text,
                fontFamily: "inherit",
                textAlign: "left",
                transition: "all 150ms",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = theme.bgHover;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
              }}
            >
              <Icon
                size={18}
                strokeWidth={1.7}
                color={isActive ? theme.accent : theme.textMuted}
              />
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: theme.fsBody,
                  fontWeight: theme.fwMedium,
                  color: isActive ? theme.text : theme.textMuted,
                }}>
                  {opt.label}
                </div>
                <div style={{
                  fontSize: 10,
                  color: isActive ? theme.accentSoft : theme.textDim,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 2,
                }}>
                  {range
                    ? `${range.p01.toFixed(1)} ~ ${range.p99.toFixed(1)} ${opt.unit}`
                    : opt.description
                  }
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </PopoverFrame>
  );
}


// 通用 popover 容器
export function PopoverFrame({ title, children }) {
  return (
    <div style={{
      position: "absolute",
      left: theme.sidebarWidth + 8,
      top: theme.topBarHeight + 12,
      width: 240,
      background: theme.bg,
      backdropFilter: "blur(12px)",
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radiusL,
      boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      padding: "14px",
      zIndex: theme.z.popover,
      fontFamily: theme.fontFamily,
      color: theme.text,
    }}>
      <div style={{ ...labelStyle, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}