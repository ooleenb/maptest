/**
 * components/BottomTimebar.jsx
 * ============================
 * 
 * 底部 54px 时间轴 (windy 风格)。
 * 包含: 大播放按钮 + 当前时间显示 + 时间滑块 + 速度控制。
 */

import React from "react";
import { theme } from "../theme.js";


export default function BottomTimebar({
  hourFloat,
  setHourFloat,
  times,             // ISO string array
  maxHour,           // 通常 23
  isPlaying,
  togglePlay,
  playbackSpeed,
  setPlaybackSpeed,
}) {
  const currentTimeLabel = formatTime(times, hourFloat);
  
  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0,
      height: theme.bottomBarHeight,
      background: theme.bg,
      backdropFilter: "blur(12px)",
      borderTop: `1px solid ${theme.border}`,
      display: "flex", alignItems: "center",
      padding: "0 20px", gap: 16,
      zIndex: theme.z.chrome,
      fontFamily: theme.fontFamily,
      color: theme.text,
    }}>
      
      {/* 播放按钮 - 用纯 SVG 避免 lucide quirks */}
      <button
        onClick={togglePlay}
        style={{
          width: 32, height: 32, borderRadius: "50%",
          background: theme.accent,
          border: "none",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          transition: "transform 100ms",
          padding: 0,
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
        title={isPlaying ? "Pause" : "Play 24h animation"}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill={theme.bgSolid}>
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill={theme.bgSolid} style={{ marginLeft: 2 }}>
            <path d="M 6 4 L 6 20 L 20 12 Z"/>
          </svg>
        )}
      </button>
      
      {/* 当前时间 */}
      <div style={{ width: 160, flexShrink: 0 }}>
        <div style={{
          fontSize: 9, color: theme.textDim, letterSpacing: 0.5,
          fontWeight: theme.fwMedium,
        }}>
          CURRENT TIME · AWST
        </div>
        <div style={{
          fontSize: theme.fsValue, fontWeight: theme.fwMedium,
          color: theme.text, marginTop: 2,
          fontVariantNumeric: "tabular-nums",
        }}>
          {currentTimeLabel}
        </div>
      </div>
      
      {/* 时间轴滑块 */}
      <div style={{ flex: 1, position: "relative" }}>
        <input
          type="range"
          min="0" max={maxHour} step="0.05"
          value={hourFloat}
          onChange={(e) => setHourFloat(Number(e.target.value))}
          style={{
            width: "100%",
            margin: 0,
            cursor: "pointer",
            accentColor: theme.accent,
          }}
        />
        
        {/* 刻度 */}
        <div style={{
          position: "absolute", top: 22, left: 0, right: 0,
          display: "flex", justifyContent: "space-between",
          fontSize: 9, color: theme.textDim,
          pointerEvents: "none",
          fontVariantNumeric: "tabular-nums",
        }}>
          <span>00:00</span>
          <span>03</span>
          <span>06</span>
          <span>09</span>
          <span>12</span>
          <span>15</span>
          <span>18</span>
          <span>21</span>
          <span>23:59</span>
        </div>
      </div>
      
      {/* 速度控制 */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 9, color: theme.textDim, letterSpacing: 0.5,
          fontWeight: theme.fwMedium,
        }}>
          SPEED
        </div>
        <select
          value={playbackSpeed}
          onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          style={{
            background: theme.bgHover,
            border: `1px solid ${theme.borderSoft}`,
            borderRadius: theme.radiusS,
            color: theme.text,
            fontSize: 11,
            fontFamily: "inherit",
            padding: "2px 6px",
            marginTop: 2,
            cursor: "pointer",
            fontWeight: theme.fwMedium,
          }}
        >
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="3">3×</option>
          <option value="6">6×</option>
        </select>
      </div>
    </div>
  );
}


function formatTime(times, hourFloat) {
  if (!times || !times.length) return "—";
  
  const iLow = Math.floor(hourFloat);
  const iHigh = Math.min(iLow + 1, times.length - 1);
  const frac = hourFloat - iLow;
  
  const tLow = new Date(times[iLow]);
  const tHigh = new Date(times[iHigh]);
  if (Number.isNaN(tLow.getTime())) return "—";
  
  const tMs = tLow.getTime() + (tHigh.getTime() - tLow.getTime()) * frac;
  const t = new Date(tMs);
  
  return t.toLocaleString("en-AU", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Australia/Perth",
  }).replace(",", " ·");
}