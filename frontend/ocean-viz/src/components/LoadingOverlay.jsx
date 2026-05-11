/**
 * components/LoadingOverlay.jsx
 * =============================
 * 
 * 全屏加载遮罩 (初次加载 / grid 失败时)。深色风格。
 */

import React from "react";
import { Loader, AlertTriangle } from "lucide-react";
import { theme } from "../theme.js";


export default function LoadingOverlay({ visible, stage, progress, error }) {
  if (!visible && !error) return null;
  
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(2, 6, 23, 0.95)",
      backdropFilter: "blur(8px)",
      zIndex: theme.z.overlay,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: theme.text,
      fontFamily: theme.fontFamily,
    }}>
      <div style={{ width: 420, textAlign: "center" }}>
        {error ? (
          <>
            <AlertTriangle
              size={36} color={theme.danger}
              style={{ marginBottom: 16 }}
            />
            <div style={{
              fontSize: 16, fontWeight: theme.fwMedium, marginBottom: 12,
            }}>
              Failed to load data
            </div>
            <div style={{
              fontSize: 11,
              color: theme.textMuted,
              background: "rgba(127, 29, 29, 0.2)",
              border: `1px solid rgba(239, 68, 68, 0.3)`,
              padding: 12, borderRadius: theme.radiusM,
              fontFamily: theme.fontMono,
              textAlign: "left", whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {error}
            </div>
            <div style={{
              fontSize: 11, color: theme.textDim, marginTop: 16,
            }}>
              Check the browser console for details.
            </div>
          </>
        ) : (
          <>
            <Loader
              size={32} color={theme.accent}
              style={{
                marginBottom: 14,
                animation: "spin 1.5s linear infinite",
              }}
            />
            <div style={{
              fontSize: 18, fontWeight: theme.fwMedium, marginBottom: 6,
            }}>
              Loading ocean data
            </div>
            <div style={{
              fontSize: 12, color: theme.textMuted, marginBottom: 22,
              minHeight: 18,
            }}>
              {stage || "Initializing..."}
            </div>
            
            <div style={{
              height: 4,
              background: theme.bgHover,
              borderRadius: 999,
              overflow: "hidden",
              marginBottom: 6,
            }}>
              <div style={{
                height: "100%",
                width: `${Math.round((progress ?? 0) * 100)}%`,
                background: theme.accent,
                transition: "width 200ms ease-out",
              }}/>
            </div>
            <div style={{
              fontSize: 11, color: theme.textDim,
              fontVariantNumeric: "tabular-nums",
            }}>
              {Math.round((progress ?? 0) * 100)}%
            </div>
          </>
        )}
      </div>
      
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}