/**
 * components/ControlPanel.jsx
 * ===========================
 * 
 * 左上的玻璃质感控制面板。
 * 
 * Step 3.2c 加入:
 * - 图层切换器 (温度/盐度/SSH)
 * - 粒子控制 (开关 / 透明度 / 速度 / 数量)
 */

import React from "react";
import DatePicker from "./DatePicker.jsx";
import LayerSwitcher from "./LayerSwitcher.jsx";


export default function ControlPanel({
  // 数据信息
  date,
  times,
  hourIndex,
  setHourIndex,
  variable,
  setVariable,
  colorRange,
  
  // 标量控件
  opacity,
  setOpacity,
  
  // 日期选择
  remoteDates,
  availableDates,
  onDateChange,
  switchingDate,
  
  // 粒子控件
  particlesEnabled,
  setParticlesEnabled,
  particleOpacity,
  setParticleOpacity,
  particleSpeed,
  setParticleSpeed,
  particleCount,
  setParticleCount,
}) {
  const currentTimeLabel = times?.[hourIndex]
    ? formatTimeAWST(times[hourIndex])
    : "—";
  
  return (
    <div style={{
      position: "absolute", top: 18, left: 18, zIndex: 20, width: 340,
      background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)",
      borderRadius: 18, boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
      padding: "16px 18px", fontFamily: "Inter, Arial, sans-serif",
      color: "#1f2937",
      maxHeight: "calc(100vh - 40px)",
      overflowY: "auto",
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
        Perth Ocean Surface
      </div>
      
      {/* 日期选择器 */}
      <DatePicker
        selectedDate={date}
        remoteDates={remoteDates}
        availableDates={availableDates}
        onChange={onDateChange}
        disabled={switchingDate}
      />
      
      {/* 变量切换 */}
      <LayerSwitcher
        variable={variable}
        onChange={setVariable}
        disabled={switchingDate}
      />
      
      {/* 当前数据信息 */}
      <div style={{
        fontSize: 12, lineHeight: 1.7, marginBottom: 10,
        paddingTop: 8, borderTop: "1px solid #e5e7eb",
      }}>
        <div><strong>Time:</strong> {currentTimeLabel}</div>
        <div><strong>Hour:</strong> {hourIndex} / 23</div>
        {colorRange && (
          <div>
            <strong>Range:</strong> {colorRange[0].toFixed(2)} ~ {colorRange[1].toFixed(2)}
          </div>
        )}
      </div>
      
      {/* 时间滑块 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Time slider
        </div>
        <input
          type="range"
          min="0" max="23" step="1"
          value={hourIndex}
          onChange={(e) => setHourIndex(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
      
      {/* 标量场透明度 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Scalar opacity ({Math.round(opacity * 100)}%)
        </div>
        <input
          type="range"
          min="0" max="1" step="0.01"
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
      
      {/* 粒子控件 */}
      <div style={{
        paddingTop: 10, borderTop: "1px solid #e5e7eb",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: particlesEnabled ? 10 : 0,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Current particles
          </div>
          <label style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: 11,
            cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={particlesEnabled}
              onChange={(e) => setParticlesEnabled(e.target.checked)}
            />
            Show
          </label>
        </div>
        
        {particlesEnabled && (
          <>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>
                Opacity ({Math.round(particleOpacity * 100)}%)
              </div>
              <input
                type="range"
                min="0.2" max="1" step="0.01"
                value={particleOpacity}
                onChange={(e) => setParticleOpacity(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>
                Speed ({particleSpeed}×)
              </div>
              <input
                type="range"
                min="400" max="3000" step="50"
                value={particleSpeed}
                onChange={(e) => setParticleSpeed(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            
            <div>
              <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 4 }}>
                Count ({particleCount})
              </div>
              <input
                type="range"
                min="500" max="3000" step="100"
                value={particleCount}
                onChange={(e) => setParticleCount(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          </>
        )}
      </div>
      
      <div style={{
        fontSize: 10, color: "#6b7280", marginTop: 12, lineHeight: 1.5,
        paddingTop: 8, borderTop: "1px solid #e5e7eb",
      }}>
        Step 3.2c: Variable switching + particles.<br/>
        ● = cached locally ・ ○ = on-demand (~5s)
      </div>
    </div>
  );
}


function formatTimeAWST(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Perth",
  }) + " AWST";
}