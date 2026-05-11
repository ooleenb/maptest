/**
 * components/TopProgressBar.jsx
 * =============================
 * 
 * 一条出现在屏幕顶部的细进度条 (像浏览器加载页面那样)。
 * 用于"切换日期"等不阻塞 UI 的加载场景。
 * 
 * 支持三种状态:
 * - visible=true:  显示进度条
 * - error 非空:    红色短暂闪烁后消失
 * - visible=false: 滑出消失
 */

import React, { useEffect, useState } from "react";

export default function TopProgressBar({
  visible,
  progress = 0,
  stage = "",
  error = null,
  showSlowWarning = false,  // 加载超过 2 秒时显示"按需生成"提示
}) {
  // 错误时短暂显示红条 (3 秒)
  const [showError, setShowError] = useState(false);
  useEffect(() => {
    if (error) {
      setShowError(true);
      const timer = setTimeout(() => setShowError(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);
  
  const show = visible || showError;
  
  return (
    <>
      {/* 进度条本身 */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          zIndex: 9999,
          pointerEvents: "none",
          transform: show ? "translateY(0)" : "translateY(-100%)",
          transition: "transform 250ms ease-out",
        }}
      >
        <div
          style={{
            height: "100%",
            width: showError ? "100%" : `${Math.round(progress * 100)}%`,
            background: showError
              ? "#ef4444"
              : "linear-gradient(90deg, #38bdf8, #818cf8, #c084fc)",
            transition: showError ? "none" : "width 200ms ease-out",
            boxShadow: showError
              ? "0 0 8px #ef4444"
              : "0 0 8px rgba(129, 140, 248, 0.6)",
          }}
        />
      </div>
      
      {/* 中央提示文字 (仅 stage 文字, 不带背景) */}
      {visible && stage && (
        <div
          style={{
            position: "fixed",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9998,
            background: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(6px)",
            color: "white",
            fontSize: 12,
            fontWeight: 500,
            padding: "6px 14px",
            borderRadius: 999,
            fontFamily: "Inter, Arial, sans-serif",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#38bdf8",
              animation: "pulse-dot 1s infinite",
            }}
          />
          <span>{stage}</span>
          <span style={{ color: "#94a3b8" }}>
            {Math.round(progress * 100)}%
          </span>
        </div>
      )}
      
      {/* 慢加载警告 (按需生成) */}
      {visible && showSlowWarning && (
        <div
          style={{
            position: "fixed",
            top: 50,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9998,
            background: "rgba(245, 158, 11, 0.95)",
            color: "white",
            fontSize: 12,
            padding: "6px 14px",
            borderRadius: 999,
            fontFamily: "Inter, Arial, sans-serif",
            pointerEvents: "none",
          }}
        >
          ⏳ Server is preparing this date, ~5s...
        </div>
      )}
      
      {/* 错误信息条 */}
      {showError && error && (
        <div
          style={{
            position: "fixed",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9998,
            background: "rgba(127, 29, 29, 0.95)",
            color: "white",
            fontSize: 12,
            fontWeight: 500,
            padding: "6px 14px",
            borderRadius: 999,
            fontFamily: "Inter, Arial, sans-serif",
            pointerEvents: "none",
            maxWidth: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          ⚠️ {error}
        </div>
      )}
      
      {/* 内嵌 animation keyframes */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}