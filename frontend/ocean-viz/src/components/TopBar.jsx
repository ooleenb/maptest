/**
 * components/TopBar.jsx
 * =====================
 * 
 * 顶部 44px 细横栏。
 * 包含: logo + 数据源切换按钮 + 日期选择 + 缓存计数。
 */

import React, { useState, useRef, useEffect } from "react";
import { Waves, ChevronDown, Layers } from "lucide-react";
import { theme } from "../theme.js";
import { getSourceInfo } from "../data/config.js";
import DateSelectorPopover from "./popovers/DateSelectorPopover.jsx";
import SourcePopover from "./popovers/SourcePopover.jsx";


export default function TopBar({
  source,
  onSourceChange,
  switchingSource,
  date,
  remoteDates,
  availableDates,
  onDateChange,
  switchingDate,
}) {
  const [dateOpen, setDateOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const dateBtnRef = useRef(null);
  const sourceBtnRef = useRef(null);
  
  // 点击外部关闭日期 popover
  useEffect(() => {
    if (!dateOpen) return;
    const handler = (e) => {
      if (dateBtnRef.current && !dateBtnRef.current.contains(e.target)) {
        if (!e.target.closest("[data-popover='date']")) {
          setDateOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dateOpen]);
  
  // 点击外部关闭数据源 popover
  useEffect(() => {
    if (!sourceOpen) return;
    const handler = (e) => {
      if (sourceBtnRef.current && !sourceBtnRef.current.contains(e.target)) {
        if (!e.target.closest("[data-popover='source']")) {
          setSourceOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sourceOpen]);
  
  const isCached = (availableDates ?? []).includes(date);
  const cachedCount = (availableDates ?? []).length;
  const totalCount = (remoteDates ?? []).length;
  
  const sourceInfo = getSourceInfo(source);
  
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: theme.topBarHeight,
      background: theme.bg, backdropFilter: "blur(12px)",
      borderBottom: `1px solid ${theme.border}`,
      display: "flex", alignItems: "center",
      paddingLeft: 18, paddingRight: 18, gap: 12,
      zIndex: theme.z.chrome,
      fontFamily: theme.fontFamily,
      color: theme.text,
    }}>
      {/* Logo */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0,
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
          Ocean Data Visualisation
        </div>
      </div>
      
      {/* ⭐ 数据源切换按钮 */}
      <div style={{ position: "relative" }} ref={sourceBtnRef}>
        <button
          onClick={() => !switchingSource && setSourceOpen(o => !o)}
          disabled={switchingSource}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 10px", height: 24,
            background: sourceOpen ? theme.bgActive : theme.bgHover,
            border: `1px solid ${sourceOpen ? theme.accent : theme.borderSoft}`,
            borderRadius: theme.radiusS,
            cursor: switchingSource ? "wait" : "pointer",
            color: theme.text,
            fontFamily: "inherit",
            fontSize: theme.fsSmall,
            opacity: switchingSource ? 0.6 : 1,
            transition: "all 150ms",
          }}
          title="Switch data source"
        >
          <Layers size={12} color={theme.accent} strokeWidth={2} />
          <span style={{ fontWeight: theme.fwMedium }}>
            {sourceInfo.name}
          </span>
          <span style={{ color: theme.textDim, fontSize: 10 }}>
            {sourceInfo.resolution}
          </span>
          <ChevronDown size={12} color={theme.textMuted} />
        </button>
        
        {sourceOpen && (
          <SourcePopover
            selectedSource={source}
            switching={switchingSource}
            onChange={(s) => {
              onSourceChange(s);
              setSourceOpen(false);
            }}
          />
        )}
      </div>
      
      {/* 中间留白 */}
      <div style={{ flex: 1 }} />
      
      {/* 日期选择按钮 */}
      <div style={{ position: "relative" }} ref={dateBtnRef}>
        <button
          onClick={() => setDateOpen(o => !o)}
          disabled={switchingDate || switchingSource}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 10px", height: 24,
            background: dateOpen ? theme.bgActive : theme.bgHover,
            border: `1px solid ${dateOpen ? theme.accent : theme.borderSoft}`,
            borderRadius: theme.radiusS,
            cursor: (switchingDate || switchingSource) ? "wait" : "pointer",
            color: theme.text,
            fontFamily: "inherit",
            fontSize: theme.fsSmall,
            opacity: (switchingDate || switchingSource) ? 0.6 : 1,
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