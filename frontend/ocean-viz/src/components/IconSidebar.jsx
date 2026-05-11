/**
 * components/IconSidebar.jsx
 * ==========================
 * 
 * 左侧 72px 细图标栏。
 * 包含 4 个图标按钮: Variable / Colors / Particles / Opacity
 * 点击展开对应的 popover (popover 内容由父组件传入)。
 */

import React from "react";
import { Thermometer, Palette, Wind, Layers, Info } from "lucide-react";
import { theme } from "../theme.js";


export const SIDEBAR_BUTTONS = [
  { key: "variable",  icon: Thermometer, label: "Variable"  },
  { key: "colormap",  icon: Palette,     label: "Colors"    },
  { key: "particles", icon: Wind,        label: "Particles" },
  { key: "opacity",   icon: Layers,      label: "Opacity"   },
];


export default function IconSidebar({
  activeKey,        // 当前打开的 popover key (null = 全关)
  setActiveKey,     // 切换函数
}) {
  return (
    <div style={{
      position: "absolute",
      top: theme.topBarHeight,
      left: 0,
      bottom: theme.bottomBarHeight,
      width: theme.sidebarWidth,
      background: theme.bg,
      backdropFilter: "blur(12px)",
      borderRight: `1px solid ${theme.border}`,
      zIndex: theme.z.chrome,
      paddingTop: 12,
      display: "flex",
      flexDirection: "column",
      gap: 4,
      fontFamily: theme.fontFamily,
    }}>
      {SIDEBAR_BUTTONS.map((btn) => (
        <SidebarButton
          key={btn.key}
          icon={btn.icon}
          label={btn.label}
          active={activeKey === btn.key}
          onClick={() => setActiveKey(activeKey === btn.key ? null : btn.key)}
        />
      ))}
    </div>
  );
}


function SidebarButton({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        width: 60,
        height: 60,
        margin: "0 6px",
        background: active ? theme.bgHover : "transparent",
        border: "none",
        borderRadius: theme.radiusM,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        color: active ? theme.accent : theme.textMuted,
        fontFamily: "inherit",
        transition: "all 150ms",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(30, 41, 59, 0.5)";
          e.currentTarget.style.color = theme.text;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = theme.textMuted;
        }
      }}
    >
      {/* 激活时左侧蓝色竖条 */}
      {active && (
        <div style={{
          position: "absolute",
          left: -6,
          top: 14,
          width: 3,
          height: 32,
          background: theme.accent,
          borderRadius: "0 2px 2px 0",
        }}/>
      )}
      <Icon size={20} strokeWidth={1.7} />
      <span style={{
        fontSize: 9,
        fontWeight: theme.fwMedium,
        letterSpacing: 0.2,
      }}>
        {label}
      </span>
    </button>
  );
}