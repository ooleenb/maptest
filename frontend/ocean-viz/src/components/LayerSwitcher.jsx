/**
 * components/LayerSwitcher.jsx
 * ============================
 * 
 * 标量变量选择器: 温度 / 盐度 / 海面高度。
 * 用 radio 风格的按钮组,而不是下拉框 (3 个选项,按钮更直观)。
 */

import React from "react";


const VARIABLE_INFO = {
  temp: { label: "Temperature", icon: "🌡", desc: "Surface temperature" },
  salt: { label: "Salinity",    icon: "🧂", desc: "Surface salinity" },
  zeta: { label: "Sea level",   icon: "🌊", desc: "Sea surface height" },
};


export default function LayerSwitcher({ variable, onChange, disabled = false }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, marginBottom: 6,
        color: "#1f2937",
      }}>
        Variable
      </div>
      
      <div style={{ display: "flex", gap: 4 }}>
        {Object.entries(VARIABLE_INFO).map(([key, info]) => {
          const isActive = variable === key;
          return (
            <button
              key={key}
              onClick={() => !disabled && onChange(key)}
              disabled={disabled}
              title={info.desc}
              style={{
                flex: 1,
                padding: "8px 4px",
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                border: `1px solid ${isActive ? "#3b82f6" : "#d1d5db"}`,
                borderRadius: 6,
                background: isActive ? "#3b82f6" : "white",
                color: isActive ? "white" : "#374151",
                cursor: disabled ? "not-allowed" : "pointer",
                fontFamily: "Inter, Arial, sans-serif",
                transition: "all 150ms",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <span style={{ fontSize: 16 }}>{info.icon}</span>
              <span>{info.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}