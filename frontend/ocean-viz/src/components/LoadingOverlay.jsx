/**
 * components/LoadingOverlay.jsx
 * =============================
 * 
 * 全屏加载遮罩组件,在初次加载/切换日期时显示。
 * 包含一个进度条 + 当前阶段文字。
 */

import React from "react";

export default function LoadingOverlay({ visible, stage, progress, error }) {
  if (!visible && !error) return null;
  
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.88)",
        backdropFilter: "blur(6px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div style={{ width: 420, textAlign: "center" }}>
        {error ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
              Failed to load data
            </div>
            <div
              style={{
                fontSize: 13,
                color: "#fca5a5",
                background: "rgba(0,0,0,0.3)",
                padding: 12,
                borderRadius: 8,
                fontFamily: "monospace",
                textAlign: "left",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {error}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 16 }}>
              Check the browser console for details.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
              🌊 Loading Ocean Data
            </div>
            <div
              style={{
                fontSize: 14,
                color: "#94a3b8",
                marginBottom: 24,
                minHeight: 20,
              }}
            >
              {stage || "Initializing..."}
            </div>
            
            {/* 进度条 */}
            <div
              style={{
                height: 8,
                background: "rgba(255,255,255,0.1)",
                borderRadius: 999,
                overflow: "hidden",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.round((progress ?? 0) * 100)}%`,
                  background:
                    "linear-gradient(90deg, #38bdf8, #818cf8, #c084fc)",
                  transition: "width 200ms ease-out",
                  borderRadius: 999,
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {Math.round((progress ?? 0) * 100)}%
            </div>
          </>
        )}
      </div>
    </div>
  );
}