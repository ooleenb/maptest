/**
 * popovers/DateSelectorPopover.jsx
 * ================================
 * 
 * 日期选择 popover, 从顶栏日期按钮下方弹出。
 * 按月分组, 每个日期前有状态点 (●cached/○on-demand)。
 */

import React from "react";
import { theme, labelStyle } from "../../theme.js";


export default function DateSelectorPopover({
  selectedDate,
  remoteDates,
  availableDates,
  onChange,
}) {
  const availableSet = new Set(availableDates ?? []);
  
  // 按月分组
  const groupedByMonth = {};
  (remoteDates ?? []).forEach((d) => {
    const month = d.substring(0, 7);
    if (!groupedByMonth[month]) groupedByMonth[month] = [];
    groupedByMonth[month].push(d);
  });
  const months = Object.keys(groupedByMonth).sort();
  
  return (
    <div data-popover="date" style={{
      position: "absolute", top: 32, right: 0,
      width: 260,
      maxHeight: 420,
      background: theme.bg,
      backdropFilter: "blur(12px)",
      border: `1px solid ${theme.border}`,
      borderRadius: theme.radiusL,
      boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      padding: "12px 0",
      overflowY: "auto",
      zIndex: theme.z.popover,
      fontFamily: theme.fontFamily,
    }}>
      <div style={{ ...labelStyle, padding: "0 14px 8px" }}>
        SELECT DATE
      </div>
      
      {months.map((month) => (
        <div key={month}>
          <div style={{
            fontSize: 10, fontWeight: theme.fwMedium,
            color: theme.textMuted,
            padding: "8px 14px 4px",
            background: "rgba(30, 41, 59, 0.4)",
            position: "sticky", top: 0,
          }}>
            {formatMonth(month)}
          </div>
          {groupedByMonth[month].map((d) => {
            const isCached = availableSet.has(d);
            const isSelected = d === selectedDate;
            return (
              <button
                key={d}
                onClick={() => onChange(d)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%",
                  padding: "6px 14px",
                  border: "none",
                  background: isSelected ? theme.bgActive : "transparent",
                  color: isSelected ? theme.accent : theme.text,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: theme.fsBody,
                  fontWeight: isSelected ? theme.fwMedium : theme.fwNormal,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "left",
                  transition: "background 100ms",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = theme.bgHover;
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: isCached ? theme.success : theme.warning,
                  flexShrink: 0,
                }}/>
                <span>{d}</span>
                {!isCached && (
                  <span style={{
                    marginLeft: "auto",
                    fontSize: 9,
                    color: theme.textDim,
                  }}>
                    on-demand
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}


function formatMonth(monthStr) {
  const [year, month] = monthStr.split("-");
  const names = ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"];
  return `${names[parseInt(month, 10) - 1]} ${year}`;
}