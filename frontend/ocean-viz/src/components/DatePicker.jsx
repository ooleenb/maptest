/**
 * components/DatePicker.jsx
 * =========================
 * 
 * 日期选择器组件。
 * 
 * 特性:
 * - 下拉式 (HTML <select>, 简单可靠, 兼容性好)
 * - 按月分组 (optgroup)
 * - 每个日期前面带状态图标:
 *     ●  已在本地预生成 (快)
 *     ○  仅远程可用 (会触发按需生成, 慢 ~5s)
 * - 旁边有"前一天"和"后一天"快捷按钮
 * - 当前日期高亮
 */

import React from "react";

export default function DatePicker({
  selectedDate,
  remoteDates,      // 所有可用日期 (135 天)
  availableDates,   // 本地已生成的日期
  onChange,
  disabled = false,
}) {
  // 把本地已生成的日期变成 Set, 方便 O(1) 查询
  const availableSet = new Set(availableDates ?? []);
  
  // 按月分组: { "2026-01": [...日期], "2026-02": [...], ... }
  const groupedByMonth = {};
  (remoteDates ?? []).forEach((d) => {
    const month = d.substring(0, 7);  // "YYYY-MM"
    if (!groupedByMonth[month]) groupedByMonth[month] = [];
    groupedByMonth[month].push(d);
  });
  
  // 月份排序
  const months = Object.keys(groupedByMonth).sort();
  
  // 查找当前日期在 remoteDates 中的索引 (用于上下导航)
  const currentIndex = remoteDates?.indexOf(selectedDate) ?? -1;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex >= 0 && currentIndex < (remoteDates?.length ?? 0) - 1;
  
  const goPrev = () => {
    if (canGoPrev) onChange(remoteDates[currentIndex - 1]);
  };
  const goNext = () => {
    if (canGoNext) onChange(remoteDates[currentIndex + 1]);
  };
  
  
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, marginBottom: 6,
        display: "flex", justifyContent: "space-between",
      }}>
        <span>Date</span>
        <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 10 }}>
          {availableSet.has(selectedDate) ? "● cached" : "○ on-demand"}
        </span>
      </div>
      
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={goPrev}
          disabled={!canGoPrev || disabled}
          style={btnStyle(canGoPrev && !disabled)}
          title="Previous day"
        >
          ◀
        </button>
        
        <select
          value={selectedDate}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: 13,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            background: disabled ? "#f3f4f6" : "white",
            color: "#111827",
            cursor: disabled ? "not-allowed" : "pointer",
            fontFamily: "Inter, Arial, sans-serif",
          }}
        >
          {months.map((month) => (
            <optgroup key={month} label={formatMonthLabel(month)}>
              {groupedByMonth[month].map((d) => {
                const isAvailable = availableSet.has(d);
                const dot = isAvailable ? "●" : "○";
                return (
                  <option key={d} value={d}>
                    {dot}  {d}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
        
        <button
          onClick={goNext}
          disabled={!canGoNext || disabled}
          style={btnStyle(canGoNext && !disabled)}
          title="Next day"
        >
          ▶
        </button>
      </div>
      
      <div style={{
        fontSize: 10, color: "#6b7280", marginTop: 4,
      }}>
        {availableSet.size} / {remoteDates?.length ?? 0} days cached locally
      </div>
    </div>
  );
}


// 月份标签 "2026-01" → "January 2026"
function formatMonthLabel(monthStr) {
  const [year, month] = monthStr.split("-");
  const monthName = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ][parseInt(month, 10) - 1];
  return `${monthName} ${year}`;
}


function btnStyle(enabled) {
  return {
    width: 28,
    padding: "6px 0",
    fontSize: 12,
    border: "1px solid #d1d5db",
    borderRadius: 6,
    background: enabled ? "white" : "#f3f4f6",
    color: enabled ? "#111827" : "#9ca3af",
    cursor: enabled ? "pointer" : "not-allowed",
    fontFamily: "Inter, Arial, sans-serif",
  };
}