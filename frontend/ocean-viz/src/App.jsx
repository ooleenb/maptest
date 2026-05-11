import React, { useEffect, useMemo, useRef, useState } from "react";
import MapView from "react-map-gl/maplibre";
import { DeckGL } from "@deck.gl/react";
import {
  PolygonLayer,
  LineLayer,
  ScatterplotLayer,
} from "@deck.gl/layers";
import NPYJS from "npyjs";
import "maplibre-gl/dist/maplibre-gl.css";

// ===============================
// 配置
// ===============================
const DATASET_DIR = "/cwa_20260311";

// ===============================
// 基础颜色工具
// ===============================
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interpolateColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
    Math.round(lerp(c1[3] ?? 255, c2[3] ?? 255, t)),
  ];
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// ===============================
// 温度配色
// ===============================
function getColorForValue(value, min, max, alpha = 185) {
  if (!Number.isFinite(value)) {
    return [0, 0, 0, 0];
  }

  const t = clamp01((value - min) / (max - min || 1));

  const stops = [
    { t: 0.0, color: [33, 102, 172, alpha] },
    { t: 0.15, color: [67, 147, 195, alpha] },
    { t: 0.3, color: [146, 197, 222, alpha] },
    { t: 0.45, color: [209, 229, 240, alpha] },
    { t: 0.58, color: [247, 247, 247, alpha] },
    { t: 0.72, color: [253, 219, 199, alpha] },
    { t: 0.85, color: [244, 165, 130, alpha] },
    { t: 1.0, color: [178, 24, 43, alpha] },
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return interpolateColor(a.color, b.color, localT);
    }
  }

  return stops[stops.length - 1].color;
}

// ===============================
// 粒子配色
// ===============================
function getParticleColor(speed, alpha = 180) {
  const s = Math.max(0, Math.min(speed, 1.5));
  const t = s / 1.5;

  const stops = [
    { t: 0.0, color: [56, 189, 248, alpha] },
    { t: 0.35, color: [96, 165, 250, alpha] },
    { t: 0.6, color: [250, 204, 21, alpha] },
    { t: 0.85, color: [251, 146, 60, alpha] },
    { t: 1.0, color: [239, 68, 68, alpha] },
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      return interpolateColor(a.color, b.color, localT);
    }
  }

  return stops[stops.length - 1].color;
}

// ===============================
// 地图缩放估计
// ===============================
function estimateZoom(minLon, minLat, maxLon, maxLat) {
  const lonSpan = Math.max(0.01, maxLon - minLon);
  const latSpan = Math.max(0.01, maxLat - minLat);
  const span = Math.max(lonSpan, latSpan);

  if (span > 20) return 3;
  if (span > 10) return 4;
  if (span > 5) return 5;
  if (span > 2) return 6;
  if (span > 1) return 7;
  if (span > 0.5) return 8;
  if (span > 0.2) return 9;
  return 10;
}

// ===============================
// Map style
// ===============================
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
    {
      id: "osm-base",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

// ===============================
// 工具
// ===============================
function isInsideBounds(lon, lat, bounds) {
  return (
    lon >= bounds.minLon &&
    lon <= bounds.maxLon &&
    lat >= bounds.minLat &&
    lat <= bounds.maxLat
  );
}

function getFlatIndex(row, col, nCols) {
  return row * nCols + col;
}

function get2DValue(arr, shape, row, col) {
  const width = shape[1];
  return arr[row * width + col];
}

function formatHourLabel(timeString) {
  if (!timeString) return "";
  const d = new Date(timeString);
  if (Number.isNaN(d.getTime())) return timeString;
  return d.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ===============================
// 构造原始 ROMS 网格 cell
// 每个 cell 是一个 polygon + center
// ===============================
function buildRawCells(lonRhoData, lonRhoShape, latRhoData, latRhoShape, maskData) {
  const nRows = lonRhoShape[0];
  const nCols = lonRhoShape[1];
  const cells = [];

  for (let r = 0; r < nRows - 1; r++) {
    for (let c = 0; c < nCols - 1; c++) {
      const lon00 = get2DValue(lonRhoData, lonRhoShape, r, c);
      const lat00 = get2DValue(latRhoData, latRhoShape, r, c);

      const lon01 = get2DValue(lonRhoData, lonRhoShape, r, c + 1);
      const lat01 = get2DValue(latRhoData, latRhoShape, r, c + 1);

      const lon11 = get2DValue(lonRhoData, lonRhoShape, r + 1, c + 1);
      const lat11 = get2DValue(latRhoData, latRhoShape, r + 1, c + 1);

      const lon10 = get2DValue(lonRhoData, lonRhoShape, r + 1, c);
      const lat10 = get2DValue(latRhoData, latRhoShape, r + 1, c);

      if (
        !Number.isFinite(lon00) || !Number.isFinite(lat00) ||
        !Number.isFinite(lon01) || !Number.isFinite(lat01) ||
        !Number.isFinite(lon11) || !Number.isFinite(lat11) ||
        !Number.isFinite(lon10) || !Number.isFinite(lat10)
      ) {
        continue;
      }

      // 用 mask_rho 做额外过滤：四角只要有一个是海，就保留
      const m00 = maskData ? get2DValue(maskData, lonRhoShape, r, c) : 1;
      const m01 = maskData ? get2DValue(maskData, lonRhoShape, r, c + 1) : 1;
      const m11 = maskData ? get2DValue(maskData, lonRhoShape, r + 1, c + 1) : 1;
      const m10 = maskData ? get2DValue(maskData, lonRhoShape, r + 1, c) : 1;

      if (!(m00 > 0 || m01 > 0 || m11 > 0 || m10 > 0)) {
        continue;
      }

      const polygon = [
        [lon00, lat00],
        [lon01, lat01],
        [lon11, lat11],
        [lon10, lat10],
      ];

      const centerLon = (lon00 + lon01 + lon11 + lon10) / 4;
      const centerLat = (lat00 + lat01 + lat11 + lat10) / 4;

      cells.push({
        row: r,
        col: c,
        polygon,
        center: [centerLon, centerLat],
      });
    }
  }

  return cells;
}

// ===============================
// 用原始 temp 给每个 cell 上色
// ===============================
function buildColoredTemperatureCells(rawCells, tempRawData, tempRawShape, tempMin, tempMax, opacity) {
  const alpha = Math.round(255 * opacity * 0.88);
  const result = [];

  for (let i = 0; i < rawCells.length; i++) {
    const cell = rawCells[i];
    const value = get2DValue(tempRawData, tempRawShape, cell.row, cell.col);

    if (!Number.isFinite(value)) continue;

    result.push({
      polygon: cell.polygon,
      center: cell.center,
      value,
      color: getColorForValue(value, tempMin, tempMax, alpha),
    });
  }

  return result;
}

// ===============================
// 点击时从原始网格找最近有效温度
// ===============================
function sampleTemperatureFromRaw(frame, lon, lat) {
  if (!frame?.rawCells || !frame?.tempRawData || !frame?.tempRawShape) return null;

  let bestValue = null;
  let bestDist = Infinity;

  for (let i = 0; i < frame.rawCells.length; i++) {
    const cell = frame.rawCells[i];
    const dx = cell.center[0] - lon;
    const dy = cell.center[1] - lat;
    const dist = dx * dx + dy * dy;

    if (dist < bestDist) {
      const value = get2DValue(frame.tempRawData, frame.tempRawShape, cell.row, cell.col);
      if (Number.isFinite(value)) {
        bestDist = dist;
        bestValue = value;
      }
    }
  }

  return bestValue;
}

// ===============================
// 粒子场采样（保留你原来的规则网格逻辑）
// ===============================
function sampleVectorField(frame, lon, lat) {
  const { bounds, lonStep, latStep, nLon, nLat, uData, vData } = frame;

  if (!isInsideBounds(lon, lat, bounds)) return null;
  if (nLon < 2 || nLat < 2) return null;

  const fx = (lon - bounds.minLon) / lonStep;
  const fy = (lat - bounds.minLat) / latStep;

  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);

  if (x0 < 0 || x0 >= nLon - 1 || y0 < 0 || y0 >= nLat - 1) {
    return null;
  }

  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const tx = fx - x0;
  const ty = fy - y0;

  const i00 = getFlatIndex(y0, x0, nLon);
  const i10 = getFlatIndex(y0, x1, nLon);
  const i01 = getFlatIndex(y1, x0, nLon);
  const i11 = getFlatIndex(y1, x1, nLon);

  const u00 = uData[i00], u10 = uData[i10], u01 = uData[i01], u11 = uData[i11];
  const v00 = vData[i00], v10 = vData[i10], v01 = vData[i01], v11 = vData[i11];

  if (
    Number.isFinite(u00) && Number.isFinite(u10) && Number.isFinite(u01) && Number.isFinite(u11) &&
    Number.isFinite(v00) && Number.isFinite(v10) && Number.isFinite(v01) && Number.isFinite(v11)
  ) {
    const u0 = u00 * (1 - tx) + u10 * tx;
    const u1 = u01 * (1 - tx) + u11 * tx;
    const v0 = v00 * (1 - tx) + v10 * tx;
    const v1 = v01 * (1 - tx) + v11 * tx;

    const u = u0 * (1 - ty) + u1 * ty;
    const v = v0 * (1 - ty) + v1 * ty;

    return { u, v };
  }

  const xn = Math.round(fx);
  const yn = Math.round(fy);

  if (xn < 0 || xn >= nLon || yn < 0 || yn >= nLat) return null;

  const idx = getFlatIndex(yn, xn, nLon);
  const u = uData[idx];
  const v = vData[idx];

  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;

  return { u, v };
}

function createRandomParticle(frame) {
  const { bounds, nLon, nLat, uData, vData, lonStep, latStep } = frame;

  for (let attempt = 0; attempt < 60; attempt++) {
    const row = Math.floor(Math.random() * nLat);
    const col = Math.floor(Math.random() * nLon);
    const idx = getFlatIndex(row, col, nLon);

    const u = uData[idx];
    const v = vData[idx];

    if (Number.isFinite(u) && Number.isFinite(v)) {
      const lon = bounds.minLon + col * lonStep;
      const lat = bounds.minLat + row * latStep;
      return { lon, lat, prevLon: lon, prevLat: lat };
    }
  }

  const lon = bounds.minLon + Math.random() * (bounds.maxLon - bounds.minLon);
  const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);

  return { lon, lat, prevLon: lon, prevLat: lat };
}

function createParticles(frame, count) {
  return Array.from({ length: count }, () => createRandomParticle(frame));
}

function resetParticle(particle, frame) {
  const p = createRandomParticle(frame);
  particle.lon = p.lon;
  particle.lat = p.lat;
  particle.prevLon = p.prevLon;
  particle.prevLat = p.prevLat;
}

// ===============================
// 主组件
// ===============================
export default function App() {
  const mapRef = useRef(null);
  const particlesRef = useRef([]);
  const animationFrameRef = useRef(null);
  const lastFrameTimeRef = useRef(null);
  const lastCommitTimeRef = useRef(0);
  const hourCacheRef = useRef(new globalThis.Map());

  const [meta, setMeta] = useState(null);
  const [baseGrid, setBaseGrid] = useState(null);
  const [hourIndex, setHourIndex] = useState(0);

  const [frame, setFrame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingHour, setLoadingHour] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [opacity, setOpacity] = useState(0.68);

  const [pickedPoint, setPickedPoint] = useState(null);
  const [popupScreenPos, setPopupScreenPos] = useState(null);

  const [showParticles, setShowParticles] = useState(true);
  const [particleOpacity, setParticleOpacity] = useState(0.8);
  const [particleSpeedFactor, setParticleSpeedFactor] = useState(1600);
  const [particleCount] = useState(1400);

  const [particleSegments, setParticleSegments] = useState([]);
  const [particleHeads, setParticleHeads] = useState([]);

  // 先加载静态基础：规则网格 + 原始网格
  useEffect(() => {
    async function loadBase() {
      try {
        setLoading(true);
        setErrorMsg("");

        const npy = new NPYJS();

        const [metaResp, latArr, lonArr, lonRhoArr, latRhoArr, maskArr] = await Promise.all([
          fetch(`${DATASET_DIR}/meta.json`),
          npy.load(`${DATASET_DIR}/lat.npy`),
          npy.load(`${DATASET_DIR}/lon.npy`),
          npy.load(`${DATASET_DIR}/lon_rho.npy`),
          npy.load(`${DATASET_DIR}/lat_rho.npy`),
          npy.load(`${DATASET_DIR}/mask_rho.npy`),
        ]);

        if (!metaResp.ok) {
          throw new Error(`Failed to load meta.json: ${metaResp.status}`);
        }

        const metaJson = await metaResp.json();

        const lat = Array.from(latArr.data);
        const lon = Array.from(lonArr.data);

        const minLat = Math.min(...lat);
        const maxLat = Math.max(...lat);
        const minLon = Math.min(...lon);
        const maxLon = Math.max(...lon);

        const zoom = estimateZoom(minLon, minLat, maxLon, maxLat);

        const rawCells = buildRawCells(
          lonRhoArr.data,
          lonRhoArr.shape,
          latRhoArr.data,
          latRhoArr.shape,
          maskArr.data
        );

        setMeta(metaJson);
        setBaseGrid({
          // 规则网格：粒子用
          lat,
          lon,
          nLat: lat.length,
          nLon: lon.length,
          latStep: lat.length > 1 ? lat[1] - lat[0] : 0.001,
          lonStep: lon.length > 1 ? lon[1] - lon[0] : 0.001,
          bounds: {
            minLon,
            minLat,
            maxLon,
            maxLat,
          },

          // 原始 ROMS 网格：温度层用
          lonRhoData: lonRhoArr.data,
          lonRhoShape: lonRhoArr.shape,
          latRhoData: latRhoArr.data,
          latRhoShape: latRhoArr.shape,
          maskRhoData: maskArr.data,
          rawCells,

          initialViewState: {
            longitude: (minLon + maxLon) / 2,
            latitude: (minLat + maxLat) / 2,
            zoom,
            pitch: 0,
            bearing: 0,
          },
        });
      } catch (err) {
        console.error(err);
        setErrorMsg(err.message || "Failed to load base grid.");
      } finally {
        setLoading(false);
      }
    }

    loadBase();
  }, []);

  // 按小时加载：temp_raw + regridded u/v
  useEffect(() => {
    if (!baseGrid || !meta) return;

    async function loadHourFrame() {
      try {
        setLoadingHour(true);
        setErrorMsg("");

        if (hourCacheRef.current.has(hourIndex)) {
          const cached = hourCacheRef.current.get(hourIndex);
          setFrame({
            ...baseGrid,
            ...cached,
            timeIndex: hourIndex,
            timeString: meta.times?.[hourIndex] || "",
          });
          return;
        }

        const npy = new NPYJS();

        const [tempRawArr, uArr, vArr] = await Promise.all([
          npy.load(`${DATASET_DIR}/temp_raw_${String(hourIndex).padStart(2, "0")}.npy`),
          npy.load(`${DATASET_DIR}/u_${String(hourIndex).padStart(2, "0")}.npy`),
          npy.load(`${DATASET_DIR}/v_${String(hourIndex).padStart(2, "0")}.npy`),
        ]);

        const tempRawData = tempRawArr.data;
        const tempRawShape = tempRawArr.shape;
        const uData = uArr.data;
        const vData = vArr.data;

        let tempMin = Infinity;
        let tempMax = -Infinity;

        for (let i = 0; i < tempRawData.length; i++) {
          const v = tempRawData[i];
          if (Number.isFinite(v)) {
            if (v < tempMin) tempMin = v;
            if (v > tempMax) tempMax = v;
          }
        }

        if (!Number.isFinite(tempMin) || !Number.isFinite(tempMax)) {
          throw new Error("Temperature array contains no valid numeric values.");
        }

        const coloredTemperatureCells = buildColoredTemperatureCells(
          baseGrid.rawCells,
          tempRawData,
          tempRawShape,
          tempMin,
          tempMax,
          opacity
        );

        const hourData = {
          tempRawData,
          tempRawShape,
          tempMin,
          tempMax,
          coloredTemperatureCells,
          uData,
          vData,
        };

        hourCacheRef.current.set(hourIndex, hourData);

        setFrame({
          ...baseGrid,
          ...hourData,
          timeIndex: hourIndex,
          timeString: meta.times?.[hourIndex] || "",
        });

        setPickedPoint(null);
        setPopupScreenPos(null);
      } catch (err) {
        console.error(err);
        setErrorMsg(err.message || "Failed to load hourly frame.");
      } finally {
        setLoadingHour(false);
      }
    }

    loadHourFrame();
  }, [baseGrid, meta, hourIndex]);

  // opacity 改变时，重算当前小时颜色，不重新读文件
  useEffect(() => {
    if (!frame || !baseGrid) return;

    const recolored = buildColoredTemperatureCells(
      baseGrid.rawCells,
      frame.tempRawData,
      frame.tempRawShape,
      frame.tempMin,
      frame.tempMax,
      opacity
    );

    setFrame((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        coloredTemperatureCells: recolored,
      };
    });
  }, [opacity]);

  // 初次加载后 fit 到范围
  useEffect(() => {
    if (!baseGrid || !mapRef.current) return;

    const map = mapRef.current.getMap?.();
    if (!map) return;

    map.fitBounds(
      [
        [baseGrid.bounds.minLon, baseGrid.bounds.minLat],
        [baseGrid.bounds.maxLon, baseGrid.bounds.maxLat],
      ],
      {
        padding: 60,
        duration: 1000,
      }
    );
  }, [baseGrid]);

  // 初始化粒子
  useEffect(() => {
    if (!frame) return;
    particlesRef.current = createParticles(frame, particleCount);
  }, [frame, particleCount]);

  // 动画循环
  useEffect(() => {
    if (!frame || !showParticles) {
      setParticleSegments([]);
      setParticleHeads([]);
      return;
    }

    const animate = (timestamp) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }

      const dtReal = Math.min((timestamp - lastFrameTimeRef.current) / 1000, 0.05);
      lastFrameTimeRef.current = timestamp;

      const particles = particlesRef.current;
      if (!particles || particles.length === 0) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const simSeconds = dtReal * particleSpeedFactor;
      const alpha = Math.round(255 * particleOpacity);

      const nextSegments = [];
      const nextHeads = [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        const sampled = sampleVectorField(frame, p.lon, p.lat);
        if (!sampled) {
          resetParticle(p, frame);
          continue;
        }

        const { u, v } = sampled;
        const speed = Math.sqrt(u * u + v * v);

        if (!Number.isFinite(speed) || speed < 0.005) {
          resetParticle(p, frame);
          continue;
        }

        const oldLon = p.lon;
        const oldLat = p.lat;

        const cosLat = Math.max(Math.cos((oldLat * Math.PI) / 180), 0.2);

        const dLat = (v * simSeconds) / 111320;
        const dLon = (u * simSeconds) / (111320 * cosLat);

        const newLon = oldLon + dLon;
        const newLat = oldLat + dLat;

        if (!isInsideBounds(newLon, newLat, frame.bounds)) {
          resetParticle(p, frame);
          continue;
        }

        const sampledNext = sampleVectorField(frame, newLon, newLat);
        if (!sampledNext) {
          resetParticle(p, frame);
          continue;
        }

        p.prevLon = oldLon;
        p.prevLat = oldLat;
        p.lon = newLon;
        p.lat = newLat;

        const color = getParticleColor(speed, alpha);
        const width = Math.min(2.2, 0.8 + speed * 0.9);

        nextSegments.push({
          sourcePosition: [oldLon, oldLat],
          targetPosition: [newLon, newLat],
          color,
          width,
        });

        nextHeads.push({
          position: [newLon, newLat],
          color,
          radius: Math.min(2.8, 1.0 + speed * 1.2),
        });
      }

      if (timestamp - lastCommitTimeRef.current > 33) {
        setParticleSegments(nextSegments);
        setParticleHeads(nextHeads);
        lastCommitTimeRef.current = timestamp;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = null;
      lastFrameTimeRef.current = null;
    };
  }, [frame, showParticles, particleOpacity, particleSpeedFactor]);

  const handleDeckClick = (info) => {
    if (!frame || !info?.coordinate || !mapRef.current) return;

    const [lng, lat] = info.coordinate;
    const temp = sampleTemperatureFromRaw(frame, lng, lat);

    const mapInstance = mapRef.current.getMap?.();
    if (mapInstance) {
      const projected = mapInstance.project([lng, lat]);
      setPopupScreenPos({ x: projected.x, y: projected.y });
    }

    setPickedPoint({
      longitude: lng,
      latitude: lat,
      temperature: Number.isFinite(temp) ? temp : null,
    });
  };

  // 地图移动时同步更新浮层位置
  useEffect(() => {
    if (!pickedPoint || !mapRef.current) return;

    const mapInstance = mapRef.current.getMap?.();
    if (!mapInstance) return;

    const updatePopupPosition = () => {
      const projected = mapInstance.project([pickedPoint.longitude, pickedPoint.latitude]);
      setPopupScreenPos({ x: projected.x, y: projected.y });
    };

    updatePopupPosition();
    mapInstance.on("move", updatePopupPosition);
    mapInstance.on("zoom", updatePopupPosition);
    mapInstance.on("resize", updatePopupPosition);

    return () => {
      mapInstance.off("move", updatePopupPosition);
      mapInstance.off("zoom", updatePopupPosition);
      mapInstance.off("resize", updatePopupPosition);
    };
  }, [pickedPoint]);

  const layers = useMemo(() => {
    const result = [];

    if (frame?.coloredTemperatureCells?.length) {
      result.push(
        new PolygonLayer({
          id: "temperature-polygons",
          data: frame.coloredTemperatureCells,
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => d.color,
          stroked: false,
          filled: true,
          wireframe: false,
          pickable: false,
          parameters: {
            depthTest: false,
            blend: true,
          },
          updateTriggers: {
            getFillColor: [opacity, frame.tempMin, frame.tempMax, frame.timeIndex],
          },
        })
      );
    }

    if (showParticles && particleSegments.length > 0) {
      result.push(
        new LineLayer({
          id: "current-particle-lines",
          data: particleSegments,
          getSourcePosition: (d) => d.sourcePosition,
          getTargetPosition: (d) => d.targetPosition,
          getColor: (d) => d.color,
          getWidth: (d) => d.width,
          widthUnits: "pixels",
          pickable: false,
          parameters: { depthTest: false },
        })
      );
    }

    if (showParticles && particleHeads.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: "current-particle-heads",
          data: particleHeads,
          getPosition: (d) => d.position,
          getFillColor: (d) => d.color,
          getRadius: (d) => d.radius,
          radiusUnits: "pixels",
          stroked: false,
          pickable: false,
          parameters: { depthTest: false },
        })
      );
    }

    return result;
  }, [frame, opacity, showParticles, particleSegments, particleHeads]);

  const initialViewState =
    baseGrid?.initialViewState || {
      longitude: 115.86,
      latitude: -31.95,
      zoom: 6,
      pitch: 0,
      bearing: 0,
    };

  const currentTimeLabel =
    meta?.times && meta.times[hourIndex]
      ? formatHourLabel(meta.times[hourIndex])
      : `Hour ${hourIndex}`;

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      <DeckGL
        initialViewState={initialViewState}
        controller={true}
        layers={layers}
        onClick={handleDeckClick}
      >
        <MapView ref={mapRef} mapStyle={mapStyle} reuseMaps />
      </DeckGL>

      {/* 自定义最高层温度弹窗 */}
      {pickedPoint && popupScreenPos && (
        <div
          style={{
            position: "absolute",
            left: popupScreenPos.x,
            top: popupScreenPos.y - 18,
            transform: "translate(-50%, -100%)",
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              minWidth: 180,
              background: "rgba(255,255,255,0.97)",
              color: "#111827",
              borderRadius: 12,
              boxShadow: "0 12px 26px rgba(0,0,0,0.22)",
              padding: "10px 12px",
              fontFamily: "Inter, Arial, sans-serif",
              position: "relative",
            }}
          >
            <button
              onClick={() => {
                setPickedPoint(null);
                setPopupScreenPos(null);
              }}
              style={{
                position: "absolute",
                top: 6,
                right: 8,
                border: "none",
                background: "transparent",
                color: "#6b7280",
                fontSize: 16,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ×
            </button>

            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 6,
                color: "#374151",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                paddingRight: 16,
              }}
            >
              Surface Temperature
            </div>

            {pickedPoint.temperature == null ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#6b7280" }}>
                  No valid ocean data
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  {pickedPoint.latitude.toFixed(4)}, {pickedPoint.longitude.toFixed(4)}
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    lineHeight: 1.05,
                    color: "#111827",
                  }}
                >
                  {pickedPoint.temperature.toFixed(2)} °C
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  {pickedPoint.latitude.toFixed(4)}, {pickedPoint.longitude.toFixed(4)}
                </div>
              </>
            )}

            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: -8,
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                borderTop: "8px solid rgba(255,255,255,0.97)",
              }}
            />
          </div>
        </div>
      )}

      {/* 左上信息面板 */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          zIndex: 20,
          width: 340,
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(8px)",
          borderRadius: 18,
          boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
          padding: "16px 18px",
          fontFamily: "Inter, Arial, sans-serif",
          color: "#1f2937",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          Perth Ocean Surface
        </div>

        {loading && (
          <div style={{ fontSize: 14, color: "#4b5563" }}>
            Loading base grid...
          </div>
        )}

        {!loading && loadingHour && (
          <div style={{ fontSize: 14, color: "#4b5563" }}>
            Loading hour {hourIndex}...
          </div>
        )}

        {!loading && errorMsg && (
          <div style={{ fontSize: 14, color: "#b91c1c" }}>
            Error: {errorMsg}
          </div>
        )}

        {!loading && frame && (
          <>
            <div style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 10 }}>
              <div>
                <strong>Current time:</strong> {currentTimeLabel}
              </div>
              <div>
                <strong>Hour index:</strong> {hourIndex} / {(meta?.time_count ?? 1) - 1}
              </div>
              <div>
                <strong>Temperature:</strong> {frame.tempMin.toFixed(2)} °C to {frame.tempMax.toFixed(2)} °C
              </div>
              <div>
                <strong>Raw grid:</strong> {frame.tempRawShape[0]} × {frame.tempRawShape[1]}
              </div>
              <div>
                <strong>Particles:</strong> {showParticles ? `${particleCount} active` : "off"}
              </div>
              {pickedPoint && (
                <div>
                  <strong>Picked point:</strong>{" "}
                  {pickedPoint.temperature == null
                    ? "No valid ocean data"
                    : `${pickedPoint.temperature.toFixed(2)} °C`}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Time slider
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(0, (meta?.time_count ?? 1) - 1)}
                step="1"
                value={hourIndex}
                onChange={(e) => setHourIndex(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                {currentTimeLabel}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Heatmap opacity
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                {Math.round(opacity * 100)}%
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Current particles</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={showParticles}
                    onChange={(e) => setShowParticles(e.target.checked)}
                  />
                  Show
                </label>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "#4b5563", marginBottom: 4 }}>
                  Particle opacity
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.01"
                  value={particleOpacity}
                  onChange={(e) => setParticleOpacity(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "#4b5563", marginBottom: 4 }}>
                  Particle speed
                </div>
                <input
                  type="range"
                  min="400"
                  max="3000"
                  step="50"
                  value={particleSpeedFactor}
                  onChange={(e) => setParticleSpeedFactor(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  Visual speed factor: {particleSpeedFactor}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 12, lineHeight: 1.5 }}>
              Hourly ROMS surface temperature is rendered directly from the original curvilinear
              grid. Particles still use the regridded u/v field for animation stability.
            </div>
          </>
        )}
      </div>

      {/* 右下温度图例 */}
      {frame && (
        <div
          style={{
            position: "absolute",
            right: 18,
            bottom: 18,
            zIndex: 20,
            width: 260,
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(8px)",
            borderRadius: 18,
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            padding: "14px 16px",
            fontFamily: "Inter, Arial, sans-serif",
            color: "#1f2937",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            Temperature Legend
          </div>

          <div
            style={{
              height: 16,
              borderRadius: 999,
              background:
                "linear-gradient(to right, rgb(33,102,172), rgb(67,147,195), rgb(146,197,222), rgb(209,229,240), rgb(247,247,247), rgb(253,219,199), rgb(244,165,130), rgb(178,24,43))",
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
              fontSize: 12,
              color: "#4b5563",
            }}
          >
            <span>{frame.tempMin.toFixed(2)} °C</span>
            <span>{frame.tempMax.toFixed(2)} °C</span>
          </div>
        </div>
      )}
    </div>
  );
}