/**
 * components/PointPopup.jsx
 * =========================
 * 
 * 点击采样后弹出的小卡片。深色风格,克制的尺寸。
 */

import React, { useState } from "react";
import { X } from "lucide-react";
import { theme } from "../theme.js";
import { formatValue } from "../render/colormaps.js";


// 采样卡片标题. ROMS 海洋变量 + WRF 大气变量都覆盖.
const TITLES = {
  // --- ROMS 海洋 ---
  temp: "SURFACE TEMP",
  salt: "SURFACE SALINITY",
  zeta: "SEA LEVEL",
  // --- WRF 大气 ---
  // 注: 大气源的 temp 是气温. key 共用 "temp", 但海洋源/大气源
  //     不会同时出现, 所以这里给一个通用的写法 —— 见下方 resolveTitle.
  Pair: "PRESSURE",
  Qair: "HUMIDITY",
  rain: "RAINFALL",
  cloud: "CLOUD COVER",
};


export default function PointPopup({
  point, screenPos, variable, unit, onClose,
}) {
  // ⭐ 用 React state 控制 hover, 而不是直接操作 DOM 样式
  //    (避免 lucide 的 currentColor 继承在某些渲染路径下失效)
  const [closeHover, setCloseHover] = useState(false);
  
  return (
    <div style={{
      position: "absolute",
      left: screenPos.x, top: screenPos.y - 14,
      transform: "translate(-50%, -100%)",
      zIndex: theme.z.popup,
      pointerEvents: "auto",
      fontFamily: theme.fontFamily,
    }}>
      <div style={{
        minWidth: 140,
        background: theme.bg,
        backdropFilter: "blur(12px)",
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radiusL,
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
        padding: "10px 14px",
        position: "relative",
        color: theme.text,
      }}>
        {/* ⭐ 关闭按钮: 明确 X 颜色 + 微妙背景, 不依赖 currentColor 继承 */}
        <button
          onClick={onClose}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
          style={{
            position: "absolute", top: 6, right: 6,
            width: 22, height: 22,
            border: "none",
            background: closeHover ? theme.bgHover : "rgba(255,255,255,0.06)",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: "50%",
            transition: "background 120ms",
            padding: 0,
          }}
          aria-label="Close"
        >
          {/* ⭐ 直接给 X 传 color prop, 不依赖 button 的 color CSS 继承 */}
          <X
            size={14}
            strokeWidth={2.2}
            color={closeHover ? theme.text : theme.textMuted}
          />
        </button>
        
        <div style={{
          fontSize: 9,
          fontWeight: theme.fwMedium,
          color: theme.textDim,
          letterSpacing: 0.6,
          marginBottom: 4,
          paddingRight: 24,
        }}>
          {TITLES[variable] ?? variable.toUpperCase()}
        </div>
        
        {point.value == null ? (
          <div style={{
            fontSize: theme.fsBody,
            color: theme.textMuted,
          }}>
            No data
          </div>
        ) : (
          <div style={{
            fontSize: theme.fsHero,
            fontWeight: theme.fwMedium,
            lineHeight: 1.1,
            fontVariantNumeric: "tabular-nums",
          }}>
            {/* ⭐ 用 formatValue 智能格式化, 而不是写死 toFixed(2).
                否则 rainfall (0.00x 量级) 会显示成 "0.00". */}
            {formatValue(point.value)} <span style={{
              fontSize: theme.fsBody,
              color: theme.textMuted,
              fontWeight: theme.fwNormal,
            }}>{unit}</span>
          </div>
        )}
        
        <div style={{
          fontSize: 9, color: theme.textDim, marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}>
          {point.lat.toFixed(3)}, {point.lon.toFixed(3)}
        </div>
        
        {/* 小三角 */}
        <div style={{
          position: "absolute", left: "50%", bottom: -6,
          transform: "translateX(-50%) rotate(45deg)",
          width: 10, height: 10,
          background: theme.bg,
          borderRight: `1px solid ${theme.border}`,
          borderBottom: `1px solid ${theme.border}`,
        }}/>
      </div>
    </div>
  );
}