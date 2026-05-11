/**
 * App.jsx (Step 3.2c)
 * ===================
 * 
 * 主组件 - 加入变量切换 + 粒子动画。
 * 
 * 新增能力 (相对 3.2b):
 * - 变量切换 (温度 / 盐度 / SSH)
 * - 粒子动画回归 (用新数据层的 u/v PNG)
 * - 粒子可调: 开关、透明度、速度、数量
 * 
 * 留给后续:
 * - Step 3.3: 多 colormap + 时间维度插值
 * - 阶段 4: GPU 粒子 (大幅提升粒子数和性能)
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Map } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";

import { loadGrid, listAvailableDates } from "./data/loader.js";
import { DEFAULT_SOURCE } from "./data/config.js";
import { VARIABLE_COLORMAPS } from "./render/colormaps.js";
import {
  buildColoredCells,
  createScalarLayer,
  sampleAtPoint,
} from "./render/scalarLayer.js";
import { ParticleSimulator } from "./render/particles.js";
import { useDayData } from "./hooks/useDayData.js";
import LoadingOverlay from "./components/LoadingOverlay.jsx";
import TopProgressBar from "./components/TopProgressBar.jsx";
import ControlPanel from "./components/ControlPanel.jsx";


// ============================================================
// 配置
// ============================================================
const INITIAL_DATE = "2026-03-11";
const SLOW_LOAD_THRESHOLD_MS = 2000;


// ============================================================
// 底图样式
// ============================================================
const mapStyle = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "osm-base", type: "raster", source: "osm", minzoom: 0, maxzoom: 19 },
  ],
};


// ============================================================
// 主组件
// ============================================================
export default function App() {
  // ---- 顶层状态 ----
  const [grid, setGrid] = useState(null);
  const [gridError, setGridError] = useState(null);
  const [datesIndex, setDatesIndex] = useState(null);
  
  const [date, setDate] = useState(INITIAL_DATE);
  const [variable, setVariable] = useState("temp");  // 当前显示的变量
  const [hourIndex, setHourIndex] = useState(0);
  const [opacity, setOpacity] = useState(0.75);
  
  // 粒子状态
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [particleOpacity, setParticleOpacity] = useState(0.8);
  const [particleSpeed, setParticleSpeed] = useState(1600);
  const [particleCount, setParticleCount] = useState(1400);
  
  const [pickedPoint, setPickedPoint] = useState(null);
  const [popupScreenPos, setPopupScreenPos] = useState(null);
  const [showSlowWarning, setShowSlowWarning] = useState(false);
  
  // 粒子动画输出 (会高频更新)
  const [particleSegments, setParticleSegments] = useState([]);
  const [particleHeads, setParticleHeads] = useState([]);
  
  const mapRef = useRef(null);
  const simulatorRef = useRef(null);            // ParticleSimulator 实例
  const animationFrameRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const lastCommitTimeRef = useRef(0);
  
  
  // ============================================================
  // 启动: 加载 grid + 日期列表
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    
    async function loadInitial() {
      try {
        const [gridData, dates] = await Promise.all([
          loadGrid(DEFAULT_SOURCE),
          listAvailableDates(DEFAULT_SOURCE, "both"),
        ]);
        if (cancelled) return;
        setGrid(gridData);
        setDatesIndex(dates);
      } catch (err) {
        console.error("Initial load failed:", err);
        if (!cancelled) setGridError(err.message || String(err));
      }
    }
    
    loadInitial();
    return () => { cancelled = true; };
  }, []);
  
  
  // ============================================================
  // 每日数据
  // ============================================================
  const dayState = useDayData(grid ? DEFAULT_SOURCE : null, date);
  const day = dayState.data;
  
  
  // ============================================================
  // 慢加载检测
  // ============================================================
  useEffect(() => {
    if (!dayState.loading) {
      setShowSlowWarning(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowWarning(true), SLOW_LOAD_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [dayState.loading]);
  
  
  // ============================================================
  // 视图: 网格加载完后自动 fit
  // ============================================================
  useEffect(() => {
    if (!grid || !mapRef.current) return;
    const map = mapRef.current.getMap?.();
    if (!map) return;
    
    map.fitBounds(
      [
        [grid.bounds.minLon, grid.bounds.minLat],
        [grid.bounds.maxLon, grid.bounds.maxLat],
      ],
      { padding: 60, duration: 1000 }
    );
  }, [grid]);
  
  
  // ============================================================
  // 当前帧的标量场染色 polygon
  // ============================================================
  const coloredCells = useMemo(() => {
    if (!grid || !day) return null;
    
    const frameData = day.scalars[variable].getFrame(hourIndex);
    const range = day.ranges[variable];
    const colorMin = range.p01;
    const colorMax = range.p99;
    const cmap = VARIABLE_COLORMAPS[variable];
    const alpha = Math.round(255 * opacity);
    
    return {
      cells: buildColoredCells(
        grid.oceanCells, frameData, grid.nXi,
        colorMin, colorMax, cmap.fn, alpha
      ),
      colorMin, colorMax, cmap, frameData,
    };
  }, [grid, day, hourIndex, opacity, variable]);
  
  
  // ============================================================
  // 粒子模拟器: 初始化 / 切日期时重置
  // ============================================================
  useEffect(() => {
    if (!grid || !day) {
      simulatorRef.current = null;
      return;
    }
    
    const uvFrame = day.uv[hourIndex] ?? day.uv[0];
    
    if (!simulatorRef.current) {
      // 首次初始化
      simulatorRef.current = new ParticleSimulator({
        uvFrame,
        bounds: grid.bounds,
        nParticles: particleCount,
      });
    } else {
      // 切日期时重置粒子位置
      simulatorRef.current.reset(uvFrame, grid.bounds);
    }
  }, [grid, day]);  // 注意: 只在 grid/day 变化时重置, hourIndex 变化时不重置
  
  
  // ============================================================
  // 粒子模拟器: 跟随 hourIndex 更新 u/v 帧 (不重置位置)
  // ============================================================
  useEffect(() => {
    if (!simulatorRef.current || !day) return;
    const uvFrame = day.uv[hourIndex];
    if (uvFrame) simulatorRef.current.updateUVFrame(uvFrame);
  }, [hourIndex, day]);
  
  
  // ============================================================
  // 粒子数量变化
  // ============================================================
  useEffect(() => {
    if (!simulatorRef.current) return;
    simulatorRef.current.setParticleCount(particleCount);
  }, [particleCount]);
  
  
  // ============================================================
  // 粒子动画循环
  // ============================================================
  useEffect(() => {
    if (!particlesEnabled || !simulatorRef.current) {
      setParticleSegments([]);
      setParticleHeads([]);
      // 清理已经在跑的动画
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = null;
      return;
    }
    
    const animate = (timestamp) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }
      const dtReal = Math.min((timestamp - lastFrameTimeRef.current) / 1000, 0.05);
      lastFrameTimeRef.current = timestamp;
      
      const alpha = Math.round(255 * particleOpacity);
      const { segments, heads } = simulatorRef.current.step(dtReal, particleSpeed, alpha);
      
      // 限频提交到 React (避免每帧 setState 太密集)
      if (timestamp - lastCommitTimeRef.current > 33) {  // ~30 fps
        setParticleSegments(segments);
        setParticleHeads(heads);
        lastCommitTimeRef.current = timestamp;
      }
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = null;
    };
  }, [particlesEnabled, particleOpacity, particleSpeed]);
  
  
  // ============================================================
  // DeckGL Layers
  // ============================================================
  const layers = useMemo(() => {
    const result = [];
    
    if (coloredCells) {
      result.push(createScalarLayer({
        id: `scalar-${variable}-${date}`,
        coloredCells: coloredCells.cells,
        timeIndex: hourIndex,
      }));
    }
    
    if (particlesEnabled && particleSegments.length > 0) {
      result.push(new LineLayer({
        id: "particle-lines",
        data: particleSegments,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getColor: (d) => d.color,
        getWidth: (d) => d.width,
        widthUnits: "pixels",
        pickable: false,
        parameters: { depthTest: false },
      }));
    }
    
    if (particlesEnabled && particleHeads.length > 0) {
      result.push(new ScatterplotLayer({
        id: "particle-heads",
        data: particleHeads,
        getPosition: (d) => d.position,
        getFillColor: (d) => d.color,
        getRadius: (d) => d.radius,
        radiusUnits: "pixels",
        stroked: false,
        pickable: false,
        parameters: { depthTest: false },
      }));
    }
    
    return result;
  }, [coloredCells, variable, date, hourIndex,
      particlesEnabled, particleSegments, particleHeads]);
  
  
  // ============================================================
  // 点击采样 (用当前变量的数据)
  // ============================================================
  const handleDeckClick = (info) => {
    if (!info?.coordinate || !grid || !coloredCells) return;
    const [lon, lat] = info.coordinate;
    const value = sampleAtPoint(
      grid.oceanCells, coloredCells.frameData, grid.nXi, lon, lat
    );
    
    const map = mapRef.current?.getMap?.();
    if (map) {
      const projected = map.project([lon, lat]);
      setPopupScreenPos({ x: projected.x, y: projected.y });
    }
    setPickedPoint({ lon, lat, value });
  };
  
  
  // ============================================================
  // 弹窗位置同步
  // ============================================================
  useEffect(() => {
    if (!pickedPoint || !mapRef.current) return;
    const map = mapRef.current.getMap?.();
    if (!map) return;
    
    const update = () => {
      const p = map.project([pickedPoint.lon, pickedPoint.lat]);
      setPopupScreenPos({ x: p.x, y: p.y });
    };
    map.on("move", update);
    map.on("zoom", update);
    map.on("resize", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
      map.off("resize", update);
    };
  }, [pickedPoint]);
  
  
  // ============================================================
  // 切日期/切变量时清除旧的采样弹窗
  // ============================================================
  useEffect(() => {
    setPickedPoint(null);
    setPopupScreenPos(null);
  }, [date, variable]);
  
  
  // ============================================================
  // hourIndex 越界保护
  // ============================================================
  useEffect(() => {
    if (day && hourIndex >= day.nFrames) {
      setHourIndex(0);
    }
  }, [day, hourIndex]);
  
  
  // ============================================================
  // 渲染
  // ============================================================
  const initialViewState = grid?.suggestedView ?? {
    longitude: 115.56, latitude: -32.07, zoom: 7,
  };
  
  const showFullScreenOverlay = (!day && !gridError && !dayState.error) || gridError;
  
  return (
    <div style={{
      width: "100vw", height: "100vh",
      position: "relative", overflow: "hidden",
    }}>
      <DeckGL
        initialViewState={initialViewState}
        controller={true}
        layers={layers}
        onClick={handleDeckClick}
      >
        <Map ref={mapRef} mapStyle={mapStyle} reuseMaps />
      </DeckGL>
      
      <LoadingOverlay
        visible={showFullScreenOverlay && !gridError}
        stage={
          gridError ? "Grid load failed" :
          !grid ? "Loading grid metadata..." :
          dayState.stage || "Starting..."
        }
        progress={!grid ? 0.1 : dayState.progress}
        error={gridError}
      />
      
      <TopProgressBar
        visible={dayState.loading && !!day}
        progress={dayState.progress}
        stage={dayState.stage}
        error={dayState.error}
        showSlowWarning={showSlowWarning}
      />
      
      {pickedPoint && popupScreenPos && day && (
        <PointPopup
          point={pickedPoint}
          screenPos={popupScreenPos}
          variable={variable}
          unit={VARIABLE_COLORMAPS[variable].unit}
          onClose={() => { setPickedPoint(null); setPopupScreenPos(null); }}
        />
      )}
      
      {day && datesIndex && (
        <ControlPanel
          date={date}
          times={day.times}
          hourIndex={hourIndex}
          setHourIndex={setHourIndex}
          variable={variable}
          setVariable={setVariable}
          colorRange={coloredCells ? [coloredCells.colorMin, coloredCells.colorMax] : null}
          opacity={opacity}
          setOpacity={setOpacity}
          remoteDates={datesIndex.remote}
          availableDates={datesIndex.available}
          onDateChange={setDate}
          switchingDate={dayState.loading}
          particlesEnabled={particlesEnabled}
          setParticlesEnabled={setParticlesEnabled}
          particleOpacity={particleOpacity}
          setParticleOpacity={setParticleOpacity}
          particleSpeed={particleSpeed}
          setParticleSpeed={setParticleSpeed}
          particleCount={particleCount}
          setParticleCount={setParticleCount}
        />
      )}
      
      {coloredCells && (
        <ColorbarLegend
          variable={variable}
          min={coloredCells.colorMin}
          max={coloredCells.colorMax}
          cssGradient={coloredCells.cmap.css}
          unit={coloredCells.cmap.unit}
        />
      )}
    </div>
  );
}


// ============================================================
// 子组件: 点击采样弹窗
// ============================================================
function PointPopup({ point, screenPos, variable, unit, onClose }) {
  const title = {
    temp: "Surface Temperature",
    salt: "Surface Salinity",
    zeta: "Sea Level Height",
  }[variable] || variable.toUpperCase();
  
  return (
    <div style={{
      position: "absolute",
      left: screenPos.x, top: screenPos.y - 18,
      transform: "translate(-50%, -100%)",
      zIndex: 9999, pointerEvents: "auto",
    }}>
      <div style={{
        minWidth: 180,
        background: "rgba(255,255,255,0.97)", color: "#111827",
        borderRadius: 12, boxShadow: "0 12px 26px rgba(0,0,0,0.22)",
        padding: "10px 12px", fontFamily: "Inter, Arial, sans-serif",
        position: "relative",
      }}>
        <button onClick={onClose} style={{
          position: "absolute", top: 6, right: 8,
          border: "none", background: "transparent", color: "#6b7280",
          fontSize: 16, cursor: "pointer", lineHeight: 1,
        }}>×</button>
        
        <div style={{
          fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#374151",
          textTransform: "uppercase", letterSpacing: "0.04em", paddingRight: 16,
        }}>
          {title}
        </div>
        
        {point.value == null ? (
          <div style={{ fontSize: 14, color: "#6b7280" }}>No valid ocean data</div>
        ) : (
          <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.05 }}>
            {point.value.toFixed(2)} {unit}
          </div>
        )}
        
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
          {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
        </div>
        
        <div style={{
          position: "absolute", left: "50%", bottom: -8,
          transform: "translateX(-50%)", width: 0, height: 0,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          borderTop: "8px solid rgba(255,255,255,0.97)",
        }}/>
      </div>
    </div>
  );
}


// ============================================================
// 子组件: 图例
// ============================================================
function ColorbarLegend({ variable, min, max, cssGradient, unit }) {
  const mid = (min + max) / 2;
  const q1 = min + (max - min) * 0.25;
  const q3 = min + (max - min) * 0.75;
  
  const titleMap = {
    temp: "Temperature",
    salt: "Salinity",
    zeta: "Sea Level",
  };
  const title = titleMap[variable] || variable.toUpperCase();
  
  return (
    <div style={{
      position: "absolute", right: 18, bottom: 18, zIndex: 20, width: 280,
      background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)",
      borderRadius: 18, boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
      padding: "14px 16px", fontFamily: "Inter, Arial, sans-serif",
      color: "#1f2937",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
        {title} {unit ? `(${unit})` : ""}
      </div>
      <div style={{
        height: 14, borderRadius: 999, background: cssGradient,
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
      }}/>
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 6, fontSize: 11, color: "#374151",
      }}>
        <span>{min.toFixed(1)}</span>
        <span>{q1.toFixed(1)}</span>
        <span>{mid.toFixed(1)}</span>
        <span>{q3.toFixed(1)}</span>
        <span>{max.toFixed(1)}</span>
      </div>
    </div>
  );
}