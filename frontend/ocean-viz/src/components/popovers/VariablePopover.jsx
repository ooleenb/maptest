/**
 * popovers/VariablePopover.jsx
 * ============================
 * 
 * 变量切换 popover。
 * 
 * ⭐ 变量列表是动态的: 根据当前数据源 (source) 显示不同的变量。
 *    - ROMS 海洋源 (perth/cwa): 温度 / 盐度 / 海面高度
 *    - WRF  大气源 (wrf_d01/d02): 气温 / 气压 / 湿度 / 降雨 / 云量
 *    具体哪个源有哪些变量, 由 config.js 的 SOURCES[].variables 决定。
 */

import React from "react";
import {
  Thermometer, Droplet, Waves,
  Gauge, CloudRain, Cloud,
} from "lucide-react";
import { theme, labelStyle } from "../../theme.js";
import { getSourceVariables } from "../../data/config.js";


// ============================================================
// 变量元信息表 (所有可能出现的变量)
// ============================================================
// key 必须和后端 meta.json 的 scalar_variables / config.js 的 variables 一致。
// 这是个"全集", VariablePopover 会根据当前 source 从里面挑出需要的。
const VARIABLE_META = {
  // --- ROMS 海洋变量 ---
  temp: {
    icon: Thermometer,
    label: "Temperature",
    unit: "°C",
    description: "Sea surface temperature",
  },
  salt: {
    icon: Droplet,
    label: "Salinity",
    unit: "PSU",
    description: "Sea surface salinity",
  },
  zeta: {
    icon: Waves,
    label: "Sea level",
    unit: "m",
    description: "Sea surface height anomaly",
  },
  // --- WRF 大气变量 ---
  // 注意: WRF 的 temp 也用上面那个 "temp" 条目 (气温, label 会显示
  //       "Temperature" / "Sea surface temperature" —— 见下方 WRF 覆盖).
  Pair: {
    icon: Gauge,
    label: "Pressure",
    unit: "mbar",
    description: "Sea level pressure",
  },
  Qair: {
    icon: Droplet,
    label: "Humidity",
    unit: "%",
    description: "Relative humidity",
  },
  rain: {
    icon: CloudRain,
    label: "Rainfall",
    unit: "kg/m²/s",
    description: "Rainfall rate",
  },
  cloud: {
    icon: Cloud,
    label: "Cloud cover",
    unit: "",
    description: "Cloud fraction (0-1)",
  },
};


// WRF 大气源里 "temp" 其实是 2m 气温, 不是海温。
// 当 source 是大气源时, 用这个覆盖 temp 的文案。
const WRF_TEMP_META = {
  icon: Thermometer,
  label: "Air temperature",
  unit: "°C",
  description: "2 m air temperature",
};


// 根据 source 取该源的变量选项列表 (含元信息)
function getVariableOptions(source) {
  const varKeys = getSourceVariables(source);
  const isAtmosphere = source && source.startsWith("wrf");
  
  return varKeys.map((key) => {
    let meta = VARIABLE_META[key];
    // 大气源的 temp 用气温文案
    if (isAtmosphere && key === "temp") {
      meta = WRF_TEMP_META;
    }
    // 兜底: 万一遇到没登记的变量, 给个默认
    if (!meta) {
      meta = {
        icon: Waves,
        label: key,
        unit: "",
        description: key,
      };
    }
    return { key, ...meta };
  });
}


export default function VariablePopover({
  source,           // ⭐ 新增: 当前数据源, 决定显示哪些变量
  variable,
  setVariable,
  ranges,           // {temp:{p01,p99}, ...} - 动态, 跟着 source 变
}) {
  const options = getVariableOptions(source);
  
  return (
    <PopoverFrame title="VARIABLE">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {options.map((opt) => {
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