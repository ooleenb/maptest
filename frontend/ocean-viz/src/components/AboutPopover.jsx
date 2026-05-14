/**
 * components/AboutPopover.jsx
 * ==========================
 * 
 * "关于" 弹层 —— 点击左上角 logo 打开。
 * 展示项目简介、作者、指导老师、课程、仓库等信息。
 * 
 * 定位: 从 logo 正下方展开 (absolute), 与 SourcePopover / DateSelectorPopover
 *       的交互模式一致 —— 点击 logo 区域外部即关闭 (关闭逻辑在 TopBar 里).
 * 
 * 视觉: 深色毛玻璃, 复用 theme, 与项目其它弹层风格统一。
 */

import React from "react";
import { Waves, ExternalLink } from "lucide-react";
import { theme } from "../theme.js";


// 信息字段 —— 改这里即可更新弹窗内容
const PROJECT = {
  title: "Ocean-Atmosphere Data Visualisation",
  description:
    "Interactive visualisation of ROMS ocean and WRF atmospheric " +
    "model output for Perth and Western Australia.",
  rows: [
    { label: "Author",      value: "Wangyanlin Li (24212962)" },
    { label: "Supervisor",  value: "A/Prof Ivica Janekovic" },
    { label: "Course",      value: "GENG5511 / GENG5512" },
    { label: "Institution", value: "The University of Western Australia" },
  ],
  repoUrl: "https://github.com/ooleenb/ocean-viz",
};


export default function AboutPopover() {
  return (
    <div
      // data 属性: TopBar 的"点击外部关闭"逻辑靠它判断点击是否落在弹层内
      data-popover="about"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",   // logo 按钮正下方, 留 8px 间隙
        // ⭐ 左侧有 72px 宽的 IconSidebar, popover 从 logo 容器
        //   左边缘 (left:0) 展开的话, 左半部分会被侧边栏盖住.
        //   往右偏移, 让 popover 整个落在侧边栏右侧.
        left: 64,
        width: 360,
        background: theme.bg,
        backdropFilter: "blur(16px)",
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radiusL,
        boxShadow: "0 14px 40px rgba(0,0,0,0.5)",
        padding: "18px 20px",
        zIndex: theme.z.popover,
        fontFamily: theme.fontFamily,
        color: theme.text,
        cursor: "default",
      }}
    >
      {/* 标题行: logo icon + 项目名 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 12,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: "50%",
          border: `1.5px solid ${theme.accent}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Waves size={15} color={theme.accent} strokeWidth={2} />
        </div>
        <div style={{
          fontSize: theme.fsValue,
          fontWeight: theme.fwBold,
          lineHeight: 1.25,
        }}>
          {PROJECT.title}
        </div>
      </div>
      
      {/* 一句话描述 */}
      <div style={{
        fontSize: theme.fsBody,
        color: theme.textMuted,
        lineHeight: 1.55,
        marginBottom: 14,
      }}>
        {PROJECT.description}
      </div>
      
      {/* 分隔线 */}
      <div style={{
        height: 1,
        background: theme.border,
        marginBottom: 12,
      }}/>
      
      {/* 信息表: label / value 两列 */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        {PROJECT.rows.map((row) => (
          <div key={row.label} style={{
            display: "flex", alignItems: "baseline", gap: 10,
          }}>
            <div style={{
              fontSize: theme.fsLabel,
              fontWeight: theme.fwMedium,
              letterSpacing: "0.6px",
              color: theme.textDim,
              textTransform: "uppercase",
              width: 82,
              flexShrink: 0,
            }}>
              {row.label}
            </div>
            <div style={{
              fontSize: theme.fsBody,
              color: theme.text,
              fontWeight: theme.fwNormal,
            }}>
              {row.value}
            </div>
          </div>
        ))}
        
        {/* 仓库链接 (单独一行, 可点击) */}
        <div style={{
          display: "flex", alignItems: "baseline", gap: 10,
        }}>
          <div style={{
            fontSize: theme.fsLabel,
            fontWeight: theme.fwMedium,
            letterSpacing: "0.6px",
            color: theme.textDim,
            textTransform: "uppercase",
            width: 82,
            flexShrink: 0,
          }}>
            Repository
          </div>
          <a
            href={PROJECT.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: theme.fsBody,
              color: theme.accent,
              fontWeight: theme.fwNormal,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            github.com/ooleenb/ocean-viz
            <ExternalLink size={11} color={theme.accent} strokeWidth={2} />
          </a>
        </div>
      </div>
    </div>
  );
}