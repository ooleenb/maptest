/**
 * App.jsx (Step 3.4 + CWA integration)
 * ====================================
 * 
 * 全新布局: windy.com 风格 + 数据源切换。
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Map } from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import { LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import "maplibre-gl/dist/maplibre-gl.css";

import { loadGrid, listAvailableDates } from "./data/loader.js";
import { DEFAULT_SOURCE, FALLBACK_DATE } from "./data/config.js";
import { COLORMAPS, DEFAULT_COLORMAP, VARIABLE_UNITS } from "./render/colormaps.js";
import {
  buildColoredCells, createScalarLayer, sampleAtPoint,
  interpolateFrame, computeFrameMinMax,
} from "./render/scalarLayer.js";
import { ParticleSimulator } from "./render/particles.js";
import { useDayData } from "./hooks/useDayData.js";
import { usePlayback } from "./hooks/usePlayback.js";

import TopBar from "./components/TopBar.jsx";
import IconSidebar from "./components/IconSidebar.jsx";
import BottomTimebar from "./components/BottomTimebar.jsx";
import LoadingOverlay from "./components/LoadingOverlay.jsx";
import TopProgressBar from "./components/TopProgressBar.jsx";
import PointPopup from "./components/PointPopup.jsx";
import ColorbarLegend from "./components/ColorbarLegend.jsx";
import ParticleLegend from "./components/ParticleLegend.jsx";

import VariablePopover from "./components/popovers/VariablePopover.jsx";
import ColormapPopover from "./components/popovers/ColormapPopover.jsx";
import ParticlesPopover from "./components/popovers/ParticlesPopover.jsx";
import OpacityPopover from "./components/popovers/OpacityPopover.jsx";

import { theme } from "./theme.js";


const SLOW_LOAD_THRESHOLD_MS = 2000;
const MAX_HOUR = 23;


// ⭐ CARTO Voyager: 比 OSM 更克制的彩色底图
//    - 道路浅灰、绿地淡黄绿、字体小而清晰
//    - 完全免费, 无 API key
//    - 4 个 subdomain (a-d) 用于并行下载, 比单个 OSM 服务器快很多
const mapStyle = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors, © CARTO",
    },
  },
  layers: [
    { id: "basemap", type: "raster", source: "basemap", minzoom: 0, maxzoom: 19 },
  ],
};


export default function App() {
  // ---- ⭐ 数据源 ----
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [switchingSource, setSwitchingSource] = useState(false);
  
  // ---- 数据 ----
  const [grid, setGrid] = useState(null);
  const [gridError, setGridError] = useState(null);
  const [datesIndex, setDatesIndex] = useState(null);
  
  const [date, setDate] = useState(FALLBACK_DATE);
  // ⭐ 标记: 当前 source 是否已经"自动跳到最新一天"过
  //         切源时重置为 false, datesIndex 到位后自动跳一次, 之后保留用户选择
  const autoPickedRef = useRef(false);
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
  // CWA 网格大 (282K cells), 仿真 CPU 负担重, 默认粒子数降到 800
  // (Perth 网格小, 1400 粒子也很流畅)
  const [particlesEnabled, setParticlesEnabled] = useState(true);
  const [particleOpacity, setParticleOpacity] = useState(0.8);
  const [particleSpeed, setParticleSpeed] = useState(3500);
  const [particleCount, setParticleCount] = useState(
    DEFAULT_SOURCE === "cwa" ? 800 : 1400
  );
  
  // ---- UI 状态 ----
  const [activeSidebar, setActiveSidebar] = useState(null);
  const [pickedPoint, setPickedPoint] = useState(null);
  const [popupScreenPos, setPopupScreenPos] = useState(null);
  const [showSlowWarning, setShowSlowWarning] = useState(false);
  
  // ---- 粒子动画 ----
  const [particleSegments, setParticleSegments] = useState([]);
  const [particleHeads, setParticleHeads] = useState([]);
  const [simulatorReadyToken, setSimulatorReadyToken] = useState(0);
  
  const mapRef = useRef(null);
  const simulatorRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const lastCommitTimeRef = useRef(0);
  
  
  // ============================================================
  // ⭐ 数据源切换处理
  // ============================================================
  const handleSourceChange = (newSource) => {
    if (newSource === source) return;
    
    console.log(`[App] Switching source: ${source} -> ${newSource}`);
    
    setSwitchingSource(true);
    
    // 暂停播放, 清除采样
    pause();
    setPickedPoint(null);
    setPopupScreenPos(null);
    
    // ⭐ 粒子彻底重置
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setParticleSegments([]);
    setParticleHeads([]);
    simulatorRef.current = null;
    setSimulatorReadyToken(t => t + 1);
    
    // ⭐ 调整粒子数到新源的合理默认 (CWA 800, Perth 1400)
    setParticleCount(newSource === "cwa" ? 800 : 1400);
    
    // 切日期到 fallback (datesIndex 加载完会自动跳到最新一天)
    setDate(FALLBACK_DATE);
    autoPickedRef.current = false;
    
    // 重置数据
    setGrid(null);
    setGridError(null);
    setDatesIndex(null);
    
    setSource(newSource);
  };
  
  
  // ============================================================
  // 切变量时自动应用推荐 colormap
  // ============================================================
  useEffect(() => {
    if (DEFAULT_COLORMAP[variable]) {
      setColormapKey(DEFAULT_COLORMAP[variable]);
    }
  }, [variable]);
  
  
  // ============================================================
  // 启动 / 切源时: 加载 grid + 日期列表
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const [gridData, dates] = await Promise.all([
          loadGrid(source),
          listAvailableDates(source, "both"),
        ]);
        if (cancelled) return;
        setGrid(gridData);
        setDatesIndex(dates);
        setSwitchingSource(false);
      } catch (err) {
        console.error("Initial load failed:", err);
        if (!cancelled) {
          setGridError(err.message || String(err));
          setSwitchingSource(false);
        }
      }
    }
    loadInitial();
    return () => { cancelled = true; };
  }, [source]);
  
  
  // ⭐ datesIndex 到位时, 自动跳到 remote 列表里的"最新一天"。
  useEffect(() => {
    if (autoPickedRef.current) return;
    if (!datesIndex?.remote?.length) return;
    
    const latest = datesIndex.remote[datesIndex.remote.length - 1];
    console.log(`[App] Auto-picking latest date for ${source}: ${latest}`);
    setDate(latest);
    autoPickedRef.current = true;
  }, [datesIndex, source]);
  
  
  const dayState = useDayData(grid ? source : null, date);
  const day = dayState.data;
  
  
  useEffect(() => {
    if (!dayState.loading) {
      setShowSlowWarning(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowWarning(true), SLOW_LOAD_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [dayState.loading]);
  
  
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
  
  
  // ⭐ CWA 性能优化: 大网格 (282K cells) 不做小时间插值
  const effectiveHour = source === "cwa" ? Math.floor(hourFloat) : hourFloat;
  
  const coloredCells = useMemo(() => {
    if (!grid || !day) return null;
    
    const scalar = day.scalars[variable];
    const dayShape = scalar.shape;
    if (dayShape[1] !== grid.nEta || dayShape[2] !== grid.nXi) {
      console.log(`[App] grid/day shape mismatch: skipping render`);
      return null;
    }
    
    const frameData = interpolateFrame(scalar, effectiveHour);
    
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
  }, [grid, day, effectiveHour, opacity, variable, colormapKey, rangeMode]);
  
  
  // ⭐ 每个数据源用合适的拖尾长度
  const trailLengthForSource = source === "cwa" ? 60 : 40;
  
  useEffect(() => {
    if (!grid || !day) {
      simulatorRef.current = null;
      return;
    }
    const hourInt = Math.min(Math.floor(hourFloat), day.uv.length - 1);
    const uvFrame = day.uv[hourInt];
    if (!simulatorRef.current) {
      simulatorRef.current = new ParticleSimulator({
        uvFrame,
        bounds: grid.bounds,
        oceanCells: grid.oceanCells,
        nParticles: particleCount,
        trailLength: trailLengthForSource,
      });
    } else {
      simulatorRef.current.reset(uvFrame, grid.bounds, grid.oceanCells);
      simulatorRef.current.setTrailLength(trailLengthForSource);
    }
    setSimulatorReadyToken(t => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, day]);
  
  
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
      const sim = simulatorRef.current;
      if (!sim) {
        animationFrameRef.current = null;
        return;
      }
      if (!lastFrameTimeRef.current) lastFrameTimeRef.current = timestamp;
      const dtReal = Math.min((timestamp - lastFrameTimeRef.current) / 1000, 0.05);
      lastFrameTimeRef.current = timestamp;
      const alpha = Math.round(255 * particleOpacity);
      const { segments, heads } = sim.step(dtReal, particleSpeed, alpha);
      if (timestamp - lastCommitTimeRef.current > 16) {
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
  
  
  const layers = useMemo(() => {
    const result = [];
    if (coloredCells) {
      const triggerKey = `${source}-${date}-${variable}-${colormapKey}-${rangeMode}-${hourFloat.toFixed(2)}-${opacity}`;
      result.push(createScalarLayer({
        id: `scalar-${variable}-${source}-${date}`,
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
  }, [coloredCells, variable, source, date, hourFloat, opacity, colormapKey, rangeMode,
      particlesEnabled, particleSegments, particleHeads]);
  
  
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
  
  useEffect(() => {
    setPickedPoint(null);
    setPopupScreenPos(null);
  }, [date, variable, source]);
  
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
      
      <TopBar
        source={source}
        onSourceChange={handleSourceChange}
        switchingSource={switchingSource}
        date={date}
        remoteDates={datesIndex?.remote}
        availableDates={datesIndex?.available}
        onDateChange={setDate}
        switchingDate={dayState.loading}
      />
      
      {day && (
        <IconSidebar
          activeKey={activeSidebar}
          setActiveKey={setActiveSidebar}
        />
      )}
      
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
      
      {particlesEnabled && coloredCells && (
        <ParticleLegend bottomOffset={110} />
      )}
      
      {pickedPoint && popupScreenPos && day && (
        <PointPopup
          point={pickedPoint}
          screenPos={popupScreenPos}
          variable={variable}
          unit={VARIABLE_UNITS[variable] ?? ""}
          onClose={() => { setPickedPoint(null); setPopupScreenPos(null); }}
        />
      )}
      
      <LoadingOverlay
        visible={showFullScreenOverlay && !gridError}
        stage={
          gridError ? "Grid load failed" :
          !grid ? (switchingSource ? `Loading ${source} grid...` : "Loading grid metadata...") :
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
    </div>
  );
}