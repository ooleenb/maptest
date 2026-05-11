/**
 * popovers/ParticlesPopover.jsx
 * =============================
 * 
 * 粒子动画设置 popover。
 * 开关 / 透明度 / 速度 / 数量。
 */

import React from "react";
import { theme, labelStyle } from "../../theme.js";
import { PopoverFrame } from "./VariablePopover.jsx";


export default function ParticlesPopover({
  particlesEnabled, setParticlesEnabled,
  particleOpacity,  setParticleOpacity,
  particleSpeed,    setParticleSpeed,
  particleCount,    setParticleCount,
}) {
  return (
    <PopoverFrame title="CURRENT PARTICLES">
      {/* 开关 */}
      <Toggle
        label="Show particles"
        checked={particlesEnabled}
        onChange={setParticlesEnabled}
      />
      
      {particlesEnabled && (
        <>
          <Divider />
          
          <Slider
            label="Opacity"
            valueText={`${Math.round(particleOpacity * 100)}%`}
            min={0.2} max={1} step={0.01}
            value={particleOpacity}
            onChange={setParticleOpacity}
          />
          
          <Slider
            label="Speed"
            valueText={`${particleSpeed}×`}
            min={500} max={6000} step={100}
            value={particleSpeed}
            onChange={setParticleSpeed}
          />
          
          <Slider
            label="Count"
            valueText={particleCount}
            min={500} max={3000} step={100}
            value={particleCount}
            onChange={setParticleCount}
          />
        </>
      )}
      
      <div style={{
        marginTop: 12, fontSize: 10, color: theme.textDim,
        lineHeight: 1.4,
      }}>
        CPU particles. GPU upgrade coming in stage 4.
      </div>
    </PopoverFrame>
  );
}


function Toggle({ label, checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%",
        padding: "8px 10px",
        background: theme.bgHover,
        border: `1px solid ${theme.borderSoft}`,
        borderRadius: theme.radiusM,
        cursor: "pointer",
        fontFamily: "inherit",
        color: theme.text,
      }}
    >
      <span style={{
        fontSize: theme.fsBody, fontWeight: theme.fwMedium,
      }}>
        {label}
      </span>
      <div style={{
        width: 30, height: 16, borderRadius: 999,
        background: checked ? theme.accent : "#475569",
        position: "relative",
        transition: "background 150ms",
      }}>
        <div style={{
          position: "absolute", top: 2,
          left: checked ? 16 : 2,
          width: 12, height: 12, borderRadius: "50%",
          background: "white",
          transition: "left 150ms",
        }}/>
      </div>
    </button>
  );
}


function Slider({ label, valueText, min, max, step, value, onChange }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 4,
      }}>
        <span style={{
          fontSize: theme.fsSmall,
          color: theme.textMuted,
          fontWeight: theme.fwMedium,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: theme.fsSmall,
          color: theme.text,
          fontVariantNumeric: "tabular-nums",
        }}>
          {valueText}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: theme.accent,
          cursor: "pointer",
        }}
      />
    </div>
  );
}


function Divider() {
  return (
    <div style={{
      height: 1, background: theme.border,
      margin: "12px 0 0",
    }}/>
  );
}