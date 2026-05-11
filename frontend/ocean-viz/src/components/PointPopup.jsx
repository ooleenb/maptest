/**
 * components/PointPopup.jsx
 * =========================
 * 
 * 点击采样后弹出的小卡片。深色风格,克制的尺寸。
 */

import React from "react";
import { X } from "lucide-react";
import { theme } from "../theme.js";


const TITLES = {
  temp: "SURFACE TEMP",
  salt: "SURFACE SALINITY",
  zeta: "SEA LEVEL",
};


export default function PointPopup({
  point, screenPos, variable, unit, onClose,
}) {
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
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 6, right: 6,
            width: 20, height: 20,
            border: "none", background: "transparent",
            color: theme.textDim,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: theme.radiusS,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.bgHover;
            e.currentTarget.style.color = theme.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = theme.textDim;
          }}
        >
          <X size={12}/>
        </button>
        
        <div style={{
          fontSize: 9,
          fontWeight: theme.fwMedium,
          color: theme.textDim,
          letterSpacing: 0.6,
          marginBottom: 4,
          paddingRight: 16,
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
            {point.value.toFixed(2)} <span style={{
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