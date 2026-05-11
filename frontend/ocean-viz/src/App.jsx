/**
 * App.jsx (Step 3.4)
 * ==================
 * 
 * 全新布局: windy.com 风格。
 * - 顶栏 (44px) + 左侧图标栏 (72px) + 底部时间轴 (54px)
 * - 设置通过 popover 弹出, 不挤占常驻空间
 * - 深色主题, 单一强调色
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Map } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";

import { loadGrid, listAvailableDates } from "./data/loader.js";
import { DEFAULT_SOURCE } from "./data/config.js";
import { COLORMAPS, DEFAULT_COLORMAP, VARIABLE_UNITS } from "./render/colormaps.js";
import {
  buildColoredCells, createScalarLayer, sampleAtPoint,
  interpolateFrame, computeFrameMinMax,
} from "./render/scalarLayer.js";
import { ParticleSimulator } from "./render/particles.js";
import { useDayData } from "./hooks/useDayData.js";
import { usePlayback } from "./hooks/usePlayback.js";

// UI 组件
import TopBar from "./components/TopBar.jsx";
import IconSidebar from "./components/IconSidebar.jsx";
import BottomTimebar from "./components/BottomTimebar.jsx";
import LoadingOverlay from "./components/LoadingOverlay.jsx";
import TopProgressBar from "./components/TopProgressBar.jsx";
import PointPopup from "./components/PointPopup.jsx";
import ColorbarLegend from "./components/ColorbarLegend.jsx";
import ParticleLegend from "./components/ParticleLegend.jsx";

// Popovers
import VariablePopover from "./components/popovers/VariablePopover.jsx";
import ColormapPopover from "./components/popovers/ColormapPopover.jsx";
import ParticlesPopover from "./components/popovers/ParticlesPopover.jsx";
import OpacityPopover from "./components/popovers/OpacityPopover.jsx";

import { theme } from "./theme.js";


const INITIAL_DATE = "2026-03-11";
const SLOW_LOAD_THRESHOLD_MS = 2000;
const MAX_HOUR = 23;


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


export default function App() {
  // ---- 数据 ----
  const [grid, setGrid] = useState(null);
  const [gridError, setGridError] = useState(null);
  const [datesIndex, setDatesIndex] = useState(null);
  
  const [date, setDate] = useState(INITIAL_DATE);
  const [variable, setVariable] = useState("temp");
  const [colormapKey, setColormapKey] = useState(DEFAULT_COLORMAP.temp);
  const [rangeMode, setRangeMode] = useState("global");
  const [opacity, setOpacity] = useState(0.75);
  
  // ---- 播放 ----
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const {
    hourFloat, setHourFloat,
    isPlaying, togglePlay, pause,
  } = usePlayback({ initialHour: 0, maxHour: MAX_HOUR, speed: playbackSpeed });
  
  // ---- 粒子 ----
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [particleOpacity, setParticleOpacity] = useState(0.8);
  const [particleSpeed, setParticleSpeed] = useState(3500);
  const [particleCount, setParticleCount] = useState(1400);
  
  // ---- UI 状态 ----
  const [activeSidebar, setActiveSidebar] = useState(null);  // null|'variable'|'colormap'|'particles'|'opacity'
  const [pickedPoint, setPickedPoint] = useState(null);
  const [popupScreenPos, setPopupScreenPos] = useState(null);
  const [showSlowWarning, setShowSlowWarning] = useState(false);
  
  // ---- 粒子动画 ----
  const [particleSegments, setParticleSegments] = useState([]);
  const [particleHeads, setParticleHeads] = useState([]);
  // ⭐ 通过自增 token 触发动画 effect 重跑 (修复"刷新后粒子不显示"的时序 bug)
  const [simulatorReadyToken, setSimulatorReadyToken] = useState(0);
  
  const mapRef = useRef(null);
  const simulatorRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const lastCommitTimeRef = useRef(0);
  
  
  // ============================================================
  // 切变量时自动应用推荐 colormap
  // ============================================================
  useEffect(() => {
    if (DEFAULT_COLORMAP[variable]) {
      setColormapKey(DEFAULT_COLORMAP[variable]);
    }
  }, [variable]);
  
  
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
  
  
  const dayState = useDayData(grid ? DEFAULT_SOURCE : null, date);
  const day = dayState.data;
  
  
  // 慢加载检测
  useEffect(() => {
    if (!dayState.loading) {
      setShowSlowWarning(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowWarning(true), SLOW_LOAD_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [dayState.loading]);
  
  
  // 视图: 网格加载完后自动 fit
  useEffect(() => {
    if (!grid || !mapRef.current) return;
    const map = mapRef.current.getMap?.();
    if (!map) return;
    map.fitBounds(
      [
        [grid.bounds.minLon, grid.bounds.minLat],
        [grid.bounds.maxLon, grid.bounds.maxLat],
      ],
      {
        padding: {
          top: theme.topBarHeight + 20,
          left: theme.sidebarWidth + 20,
          right: 20,
          bottom: theme.bottomBarHeight + 20,
        },
        duration: 1000,
      }
    );
  }, [grid]);
  
  
  // 当前帧染色
  const coloredCells = useMemo(() => {
    if (!grid || !day) return null;
    
    const scalar = day.scalars[variable];
    const frameData = interpolateFrame(scalar, hourFloat);
    
    let colorMin, colorMax;
    if (rangeMode === "global") {
      const range = day.ranges[variable];
      colorMin = range.p01;
      colorMax = range.p99;
    } else {
      const mm = computeFrameMinMax(frameData);
      colorMin = mm.min;
      colorMax = mm.max;
    }
    
    const cmap = COLORMAPS[colormapKey] ?? COLORMAPS[DEFAULT_COLORMAP[variable]];
    const alpha = Math.round(255 * opacity);
    
    return {
      cells: buildColoredCells(
        grid.oceanCells, frameData, grid.nXi,
        colorMin, colorMax, cmap.fn, alpha
      ),
      colorMin, colorMax, cmap, frameData,
    };
  }, [grid, day, hourFloat, opacity, variable, colormapKey, rangeMode]);
  
  
  // 粒子: 初始化 / 切日期时重置
  useEffect(() => {
    if (!grid || !day) {
      simulatorRef.current = null;
      return;
    }
    const hourInt = Math.min(Math.floor(hourFloat), day.uv.length - 1);
    const uvFrame = day.uv[hourInt];
    if (!simulatorRef.current) {
      simulatorRef.current = new ParticleSimulator({
        uvFrame, bounds: grid.bounds, nParticles: particleCount,
      });
    } else {
      simulatorRef.current.reset(uvFrame, grid.bounds);
    }
    // ⭐ 通知动画 useEffect: simulator 已经就绪 (或刚被重置)
    setSimulatorReadyToken(t => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, day]);
  
  
  // 粒子: 跟随整数小时切换 u/v
  useEffect(() => {
    if (!simulatorRef.current || !day) return;
    const hourInt = Math.min(Math.floor(hourFloat), day.uv.length - 1);
    const uvFrame = day.uv[hourInt];
    if (uvFrame) simulatorRef.current.updateUVFrame(uvFrame);
  }, [hourFloat, day]);
  
  useEffect(() => {
    if (!simulatorRef.current) return;
    simulatorRef.current.setParticleCount(particleCount);
  }, [particleCount]);
  
  
  // 粒子动画循环
  useEffect(() => {
    if (!particlesEnabled || !simulatorRef.current) {
      setParticleSegments([]);
      setParticleHeads([]);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = null;
      return;
    }
    const animate = (timestamp) => {
      if (!lastFrameTimeRef.current) lastFrameTimeRef.current = timestamp;
      const dtReal = Math.min((timestamp - lastFrameTimeRef.current) / 1000, 0.05);
      lastFrameTimeRef.current = timestamp;
      const alpha = Math.round(255 * particleOpacity);
      const { segments, heads } = simulatorRef.current.step(dtReal, particleSpeed, alpha);
      if (timestamp - lastCommitTimeRef.current > 16) {  // ~60fps commit (拖尾顺滑)
        setParticleSegments(segments);
        setParticleHeads(heads);
        lastCommitTimeRef.current = timestamp;
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      lastFrameTimeRef.current = null;
    };
  }, [particlesEnabled, particleOpacity, particleSpeed, simulatorReadyToken]);
  
  
  // Layers
  const layers = useMemo(() => {
    const result = [];
    if (coloredCells) {
      const triggerKey = `${date}-${variable}-${colormapKey}-${rangeMode}-${hourFloat.toFixed(2)}-${opacity}`;
      result.push(createScalarLayer({
        id: `scalar-${variable}-${date}`,
        coloredCells: coloredCells.cells,
        updateTriggerKey: triggerKey,
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
  }, [coloredCells, variable, date, hourFloat, opacity, colormapKey, rangeMode,
      particlesEnabled, particleSegments, particleHeads]);
  
  
  // 点击采样
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
  
  // 弹窗位置同步
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
  
  // 切日期/变量时清除弹窗
  useEffect(() => {
    setPickedPoint(null);
    setPopupScreenPos(null);
  }, [date, variable]);
  
  // 切日期时停止播放
  useEffect(() => {
    if (dayState.loading) pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayState.loading]);
  
  
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
      background: theme.bgSolid,
    }}>
      <DeckGL
        initialViewState={initialViewState}
        controller={true}
        layers={layers}
        onClick={handleDeckClick}
      >
        <Map ref={mapRef} mapStyle={mapStyle} reuseMaps />
      </DeckGL>
      
      {/* 顶栏 */}
      {datesIndex && (
        <TopBar
          date={date}
          remoteDates={datesIndex.remote}
          availableDates={datesIndex.available}
          onDateChange={setDate}
          switchingDate={dayState.loading}
        />
      )}
      
      {/* 左侧图标栏 */}
      {day && (
        <IconSidebar
          activeKey={activeSidebar}
          setActiveKey={setActiveSidebar}
        />
      )}
      
      {/* Popovers (按 activeSidebar 切换) */}
      {day && activeSidebar === "variable" && (
        <VariablePopover
          variable={variable}
          setVariable={setVariable}
          ranges={day.ranges}
        />
      )}
      {day && activeSidebar === "colormap" && (
        <ColormapPopover
          colormapKey={colormapKey}
          setColormapKey={setColormapKey}
          rangeMode={rangeMode}
          setRangeMode={setRangeMode}
        />
      )}
      {day && activeSidebar === "particles" && (
        <ParticlesPopover
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
      {day && activeSidebar === "opacity" && (
        <OpacityPopover
          opacity={opacity}
          setOpacity={setOpacity}
        />
      )}
      
      {/* 底部时间轴 */}
      {day && (
        <BottomTimebar
          hourFloat={hourFloat}
          setHourFloat={setHourFloat}
          times={day.times}
          maxHour={MAX_HOUR}
          isPlaying={isPlaying}
          togglePlay={togglePlay}
          playbackSpeed={playbackSpeed}
          setPlaybackSpeed={setPlaybackSpeed}
        />
      )}
      
      {/* 右下角图例 */}
      {coloredCells && (
        <ColorbarLegend
          variable={variable}
          min={coloredCells.colorMin}
          max={coloredCells.colorMax}
          cssGradient={coloredCells.cmap.css}
          unit={VARIABLE_UNITS[variable] ?? ""}
          rangeMode={rangeMode}
        />
      )}
      
      {/* 粒子图例 (仅粒子开启时显示, 叠在温度图例上方) */}
      {particlesEnabled && coloredCells && (
        <ParticleLegend bottomOffset={110} />
      )}
      
      {/* 点击采样小卡片 */}
      {pickedPoint && popupScreenPos && day && (
        <PointPopup
          point={pickedPoint}
          screenPos={popupScreenPos}
          variable={variable}
          unit={VARIABLE_UNITS[variable] ?? ""}
          onClose={() => { setPickedPoint(null); setPopupScreenPos(null); }}
        />
      )}
      
      {/* 全屏遮罩 */}
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
      
      {/* 顶部进度条 (切日期时) */}
      <TopProgressBar
        visible={dayState.loading && !!day}
        progress={dayState.progress}
        stage={dayState.stage}
        error={dayState.error}
        showSlowWarning={showSlowWarning}
      />
    </div>
  );
}