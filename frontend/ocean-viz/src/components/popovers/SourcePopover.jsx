/**
 * components/popovers/SourcePopover.jsx
 * =====================================
 * 
 * 数据源切换 popover, 从顶栏 "Source" 按钮下方弹出。
 * 
 * ⭐ 分组显示 (B 方案):
 *    数据源按 group 分成 "Ocean (ROMS)" 和 "Atmosphere (WRF)" 两组,
 *    每组有标题, 组内列出各数据源。当前选中的有边框高亮。
 */

import React from "react";
import { theme, labelStyle } from "../../theme.js";
import { SOURCES, SOURCE_GROUPS } from "../../data/config.js";


export default function SourcePopover({
  selectedSource,
  onChange,
  switching,
}) {
  return (
    <div data-popover="source" style={{
      position: "absolute", top: 32, left: 0,
      width: 280,
      background: theme.bg,
      backdropFilter: "blur(12px)",
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radiusL,
      boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      padding: "12px 14px",
      zIndex: theme.z.popover,
      fontFamily: theme.fontFamily,
      color: theme.text,
    }}>
      <div style={{ ...labelStyle, marginBottom: 10 }}>
        Data sources
      </div>
      
      {/* 按 SOURCE_GROUPS 顺序渲染每个分组 */}
      {SOURCE_GROUPS.map((group, groupIdx) => {
        const groupSources = SOURCES.filter((s) => s.group === group.key);
        if (groupSources.length === 0) return null;
        
        return (
          <div key={group.key} style={{
            marginBottom: groupIdx < SOURCE_GROUPS.length - 1 ? 12 : 4,
          }}>
            {/* 分组标题 */}
            <div style={{
              fontSize: 10,
              fontWeight: theme.fwMedium,
              color: theme.textDim,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
              paddingLeft: 2,
            }}>
              {group.label}
            </div>
            
            {/* 组内的数据源按钮 */}
            {groupSources.map((src) => {
              const isSelected = src.key === selectedSource;
              return (
                <button
                  key={src.key}
                  onClick={() => !switching && onChange(src.key)}
                  disabled={switching}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    marginBottom: 6,
                    background: isSelected ? theme.bgActive : theme.bgHover,
                    border: `1px solid ${isSelected ? theme.accent : theme.borderSoft}`,
                    borderRadius: theme.radiusS,
                    cursor: switching ? "wait" : "pointer",
                    color: theme.text,
                    fontFamily: "inherit",
                    transition: "all 150ms",
                    opacity: switching ? 0.6 : 1,
                  }}
                >
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    marginBottom: 4,
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: isSelected ? theme.accent : theme.borderSoft,
                      flexShrink: 0,
                    }}/>
                    <span style={{
                      fontSize: theme.fsBody,
                      fontWeight: theme.fwMedium,
                    }}>
                      {src.name}
                    </span>
                    <span style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: theme.textMuted,
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {src.resolution}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: theme.textMuted,
                    lineHeight: 1.4,
                    paddingLeft: 14,
                  }}>
                    {src.subtitle}
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
      
      <div style={{
        marginTop: 4,
        fontSize: 10,
        color: theme.textDim,
        lineHeight: 1.5,
      }}>
        Switching sources reloads the grid (may take 10-30 seconds for first load).
      </div>
    </div>
  );
}