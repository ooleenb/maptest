/**
 * components/TopBar.jsx
 * =====================
 * 
 * 顶部 44px 细横栏。
 * 包含: logo + 副标题 + 日期选择(展开 popover) + 缓存计数。
 */

import React, { useState, useRef, useEffect } from "react";
import { Waves, Calendar, ChevronDown } from "lucide-react";
import { theme } from "../theme.js";
import DateSelectorPopover from "./popovers/DateSelectorPopover.jsx";


export default function TopBar({
  date,
  remoteDates,
  availableDates,
  onDateChange,
  switchingDate,
}) {
  const [dateOpen, setDateOpen] = useState(false);
  const dateBtnRef = useRef(null);
  
  // 点击外部关闭 popover
  useEffect(() => {
    if (!dateOpen) return;
    const handler = (e) => {
      if (dateBtnRef.current && !dateBtnRef.current.contains(e.target)) {
        // 检查点击是否落在 popover 内
        if (!e.target.closest("[data-popover='date']")) {
          setDateOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dateOpen]);
  
  const isCached = (availableDates ?? []).includes(date);
  const cachedCount = (availableDates ?? []).length;
  const totalCount = (remoteDates ?? []).length;
  
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: theme.topBarHeight,
      background: theme.bg, backdropFilter: "blur(12px)",
      borderBottom: `1px solid ${theme.border}`,
      display: "flex", alignItems: "center",
      paddingLeft: 18, paddingRight: 18, gap: 16,
      zIndex: theme.z.chrome,
      fontFamily: theme.fontFamily,
      color: theme.text,
    }}>
      {/* Logo */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          border: `1.5px solid ${theme.accent}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Waves size={14} color={theme.accent} strokeWidth={2} />
        </div>
        <div style={{
          fontSize: theme.fsSmall,
          color: theme.textMuted,
          fontWeight: theme.fwMedium,
        }}>
          UWA · 500m ROMS
        </div>
      </div>
      
      {/* 中间留白 */}
      <div style={{ flex: 1 }} />
      
      {/* 日期选择按钮 */}
      <div style={{ position: "relative" }} ref={dateBtnRef}>
        <button
          onClick={() => setDateOpen(o => !o)}
          disabled={switchingDate}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 10px", height: 24,
            background: dateOpen ? theme.bgActive : theme.bgHover,
            border: `1px solid ${dateOpen ? theme.accent : theme.borderSoft}`,
            borderRadius: theme.radiusS,
            cursor: switchingDate ? "wait" : "pointer",
            color: theme.text,
            fontFamily: "inherit",
            fontSize: theme.fsSmall,
            opacity: switchingDate ? 0.6 : 1,
            transition: "all 150ms",
          }}
        >
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: isCached ? theme.success : theme.warning,
          }}/>
          <span style={{ fontWeight: theme.fwMedium }}>{date}</span>
          <span style={{ color: theme.textDim, fontSize: 10 }}>
            {isCached ? "cached" : "on-demand"}
          </span>
          <ChevronDown size={12} color={theme.textMuted} />
        </button>
        
        {dateOpen && (
          <DateSelectorPopover
            selectedDate={date}
            remoteDates={remoteDates}
            availableDates={availableDates}
            onChange={(d) => {
              onDateChange(d);
              setDateOpen(false);
            }}
          />
        )}
      </div>
      
      {/* 缓存计数 */}
      <div style={{
        padding: "5px 10px", height: 24,
        background: theme.bgHover,
        border: `1px solid ${theme.borderSoft}`,
        borderRadius: theme.radiusS,
        fontSize: 10,
        color: theme.textMuted,
        display: "flex", alignItems: "center",
        fontVariantNumeric: "tabular-nums",
      }}>
        {cachedCount} / {totalCount}
      </div>
    </div>
  );
}