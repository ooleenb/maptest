/**
 * components/TopProgressBar.jsx
 * =============================
 * 
 * 顶部细进度条 (切日期时的非阻塞加载提示)。深色风格。
 */

import React, { useEffect, useState } from "react";
import { Clock, AlertCircle } from "lucide-react";
import { theme } from "../theme.js";


export default function TopProgressBar({
  visible, progress = 0, stage = "", error = null,
  showSlowWarning = false,
}) {
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
      {/* 顶部细条 (在 TopBar 上方) */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0,
        height: 2,
        zIndex: theme.z.overlay,
        pointerEvents: "none",
        transform: show ? "translateY(0)" : "translateY(-100%)",
        transition: "transform 250ms ease-out",
      }}>
        <div style={{
          height: "100%",
          width: showError ? "100%" : `${Math.round(progress * 100)}%`,
          background: showError ? theme.danger : theme.accent,
          transition: showError ? "none" : "width 200ms ease-out",
          boxShadow: showError
            ? `0 0 6px ${theme.danger}`
            : `0 0 6px ${theme.accent}`,
        }}/>
      </div>
      
      {/* 中央提示胶囊 */}
      {visible && stage && (
        <div style={{
          position: "fixed",
          top: theme.topBarHeight + 14,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: theme.z.overlay,
          background: theme.bg,
          backdropFilter: "blur(12px)",
          border: `1px solid ${theme.border}`,
          color: theme.text,
          fontSize: 11,
          fontWeight: theme.fwMedium,
          padding: "5px 12px",
          borderRadius: 999,
          fontFamily: theme.fontFamily,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{
            display: "inline-block",
            width: 6, height: 6, borderRadius: "50%",
            background: theme.accent,
            animation: "pulse-dot 1s infinite",
          }}/>
          <span>{stage}</span>
          <span style={{
            color: theme.textDim,
            fontVariantNumeric: "tabular-nums",
          }}>
            {Math.round(progress * 100)}%
          </span>
        </div>
      )}
      
      {/* 慢加载警告 */}
      {visible && showSlowWarning && (
        <div style={{
          position: "fixed",
          top: theme.topBarHeight + 50,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: theme.z.overlay,
          background: "rgba(245, 158, 11, 0.95)",
          color: "white",
          fontSize: 11,
          fontWeight: theme.fwMedium,
          padding: "5px 12px",
          borderRadius: 999,
          fontFamily: theme.fontFamily,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          <Clock size={11}/>
          <span>Preparing this date, ~5s...</span>
        </div>
      )}
      
      {/* 错误信息条 */}
      {showError && error && (
        <div style={{
          position: "fixed",
          top: theme.topBarHeight + 14,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: theme.z.overlay,
          background: "rgba(127, 29, 29, 0.95)",
          color: "white",
          fontSize: 11,
          fontWeight: theme.fwMedium,
          padding: "5px 12px",
          borderRadius: 999,
          fontFamily: theme.fontFamily,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: 6,
          maxWidth: 600,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          <AlertCircle size={11}/>
          <span>{error}</span>
        </div>
      )}
      
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}