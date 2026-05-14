"""
grid_meta.py
============

ROMS 网格元数据加载与缓存。

为什么独立成一个模块:
--------------------
- 网格几何信息(经纬度、海陆掩膜、水深、度量因子)不随时间变化
- 没必要每次取数据时都重复下载
- 第一次跑时从 OPeNDAP 拉一次,存到本地,以后所有调用都用本地缓存
- 这样把"慢的网络操作"和"快的本地计算"清晰分开

提供的能力:
----------
- get_grid_meta(source_name): 返回某数据源的网格元数据(自动缓存)
- 内置 mask_rho / h / lon_rho / lat_rho / lon_vert / lat_vert / pm / pn / angle
- 预计算好的"cell polygons"列表,前端 DeckGL 直接用
- 推荐的地图初始视图(中心点 + zoom)

使用示例:
---------
    from grid_meta import get_grid_meta
    
    meta = get_grid_meta("perth")
    print(meta.mask_rho.shape)         # (259, 129)
    
    meta_cwa = get_grid_meta("cwa")
    print(meta_cwa.mask_rho.shape)     # (640, 480)

依赖:
-----
    pip install xarray netCDF4 numpy
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import xarray as xr


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(handler)


# ============================================================
# 配置: 数据源对应的 grid 文件
# ============================================================
GRID_SOURCES = {
    "perth": {
        "kind": "roms",
        "url": "http://boreas.mywire.org:8080/thredds/dodsC/perthhis/perth_his_grid.nc",
        "expected_shape": (259, 129),
    },
    "cwa": {
        "kind": "roms",
        # ⚠️ URL 命名 misleading:
        # cwa_qck_2026.ncml 这个 "ncml" 实际是 grid 文件(无 ocean_time, 只有静态网格)
        # 真正的数据聚合在 cwa_qck_202601.ncml (见 data_loader.py 配置)
        "url": "http://boreas.mywire.org:8080/thredds/dodsC/cwaqck/cwa_qck_2026.ncml",
        "expected_shape": (640, 480),
    },
    # WRF 大气模型: d01 (WA 范围) + d02 (Perth 范围), 两个独立网格源.
    # WRF 数据集没有独立 grid 文件, 从某天的 .nc 文件提取静态 grid 字段
    # (LON/LAT/LANDMASK 是静态的, 哪一天的文件都一样, 用 2026-05-21 肯定有数据).
    "wrf_d01": {
        "kind": "wrf",
        "url": "http://boreas.mywire.org:8080/thredds/dodsC/WRF2026/wrf_roms_d01_20260521.nc",
        "expected_shape": (165, 99),
        # ⭐ WRF 是大气模型: 全域有效, 不只是海洋.
        #    all_cells_as_ocean=True 让陆地格子也建多边形,
        #    这样气温/风在陆地上也能可视化 (windy 风格).
        "all_cells_as_ocean": True,
    },
    "wrf_d02": {
        "kind": "wrf",
        "url": "http://boreas.mywire.org:8080/thredds/dodsC/WRF2026/wrf_roms_d02_20260521.nc",
        "expected_shape": (165, 90),
        "all_cells_as_ocean": True,
    },
}


# ============================================================
# 缓存路径
# ============================================================
def _get_cache_dir() -> Path:
    cache = os.environ.get("ROMS_GRID_CACHE_DIR")
    if cache:
        return Path(cache)
    return Path(__file__).resolve().parent.parent / "data" / "grid"


# ============================================================
# 网格元数据结构
# ============================================================
@dataclass
class GridMeta:
    """
    一个数据源的完整网格元数据。
    
    所有数组都是 numpy ndarray,float32 节省空间。
    包含原始 ROMS 网格量 + 预计算的可视化辅助结构。
    """
    source_name: str
    
    lon_rho: np.ndarray
    lat_rho: np.ndarray
    lon_vert: np.ndarray
    lat_vert: np.ndarray
    mask_rho: np.ndarray
    h: np.ndarray
    pm: np.ndarray
    pn: np.ndarray
    angle: np.ndarray
    
    n_eta: int
    n_xi: int
    
    bounds: dict = field(default_factory=dict)
    ocean_cells: list[dict] = field(default_factory=list)
    suggested_view: dict = field(default_factory=dict)


# ============================================================
# 估算合适的初始 zoom
# ============================================================
def _estimate_zoom(minLon: float, maxLon: float,
                    minLat: float, maxLat: float) -> int:
    """根据经纬度跨度估算一个合理的 Mapbox zoom 等级。"""
    span = max(maxLon - minLon, maxLat - minLat)
    if span > 20:   return 3
    if span > 10:   return 4
    if span > 5:    return 5
    if span > 2:    return 6
    if span > 1:    return 7
    if span > 0.5:  return 8
    if span > 0.2:  return 9
    return 10


# ============================================================
# 核心: 从 NetCDF 文件加载网格元数据 (分派 ROMS / WRF)
# ============================================================
def _load_grid_from_nc(nc_path: str | Path, source_name: str,
                       kind: str = "roms",
                       all_cells_as_ocean: bool = False) -> GridMeta:
    """
    从一个 NetCDF 文件加载网格元数据。
    
    kind="roms":  Perth/CWA, 用 lon_rho/lat_rho/lon_vert/lat_vert/mask_rho 等
    kind="wrf":   WRF, 用 LON/LAT/LANDMASK, 角点从中心点推
    
    all_cells_as_ocean=True 时, 把 mask 全设为 1, oceanCells 包含所有格子.
    (用于大气数据可视化, 陆地也画.)
    """
    if kind == "roms":
        return _load_grid_roms(nc_path, source_name, all_cells_as_ocean)
    elif kind == "wrf":
        return _load_grid_wrf(nc_path, source_name, all_cells_as_ocean)
    else:
        raise ValueError(f"Unknown grid kind: {kind!r}")


def _load_grid_roms(nc_path, source_name, all_cells_as_ocean=False) -> GridMeta:
    """
    从 ROMS grid 文件加载.
    必需变量: lon_rho, lat_rho, lon_vert, lat_vert, mask_rho, h
    可选变量: pm, pn, angle (Perth 有, CWA 没有)
    """
    logger.info(f"Loading ROMS grid from: {nc_path}")
    t0 = time.time()
    
    with xr.open_dataset(str(nc_path)) as ds:
        lon_rho = ds["lon_rho"].values.astype(np.float64)
        lat_rho = ds["lat_rho"].values.astype(np.float64)
        lon_vert = ds["lon_vert"].values.astype(np.float64)
        lat_vert = ds["lat_vert"].values.astype(np.float64)
        mask_rho = ds["mask_rho"].values.astype(np.float32)
        h = ds["h"].values.astype(np.float32)
        
        if "pm" in ds.variables:
            pm = ds["pm"].values.astype(np.float32)
        else:
            logger.info(f"  Note: 'pm' not in grid file, using placeholder")
            pm = np.ones_like(mask_rho)
        
        if "pn" in ds.variables:
            pn = ds["pn"].values.astype(np.float32)
        else:
            logger.info(f"  Note: 'pn' not in grid file, using placeholder")
            pn = np.ones_like(mask_rho)
        
        if "angle" in ds.variables:
            angle = ds["angle"].values.astype(np.float32)
        else:
            logger.info(f"  Note: 'angle' not in grid file, using zeros")
            angle = np.zeros_like(mask_rho)
    
    elapsed = time.time() - t0
    logger.info(f"  Loaded in {elapsed:.1f}s. Grid shape: {mask_rho.shape}")
    
    # 如果要"全画" (大气数据可视化), 把 mask 全置 1
    if all_cells_as_ocean:
        logger.info(f"  all_cells_as_ocean=True: treating all cells as visible")
        mask_for_cells = np.ones_like(mask_rho)
    else:
        mask_for_cells = mask_rho
    
    return _finalize_grid_meta(
        source_name, lon_rho, lat_rho, lon_vert, lat_vert,
        mask_rho, mask_for_cells, h, pm, pn, angle,
    )


def _load_grid_wrf(nc_path, source_name, all_cells_as_ocean=False) -> GridMeta:
    """
    从 WRF 输出文件加载 grid.
    
    WRF 有:
      LON (dim1, dim2)        - 经度 2D
      LAT (dim1, dim2)        - 纬度 2D
      LANDMASK (dim1, dim2)   - 1=陆地, 0=水 (注意和 ROMS 反的)
    
    WRF 没有:
      vert (角点)             - 我们从 cell 中心推算
      h (深度)                - 大气不需要, 全置 0
      pm/pn (度量因子)         - 不需要, 占位
      angle (网格旋转角)        - 不需要, 占位 0
    """
    logger.info(f"Loading WRF grid from: {nc_path}")
    t0 = time.time()
    
    with xr.open_dataset(str(nc_path)) as ds:
        lon_rho = ds["LON"].values.astype(np.float64)
        lat_rho = ds["LAT"].values.astype(np.float64)
        landmask = ds["LANDMASK"].values.astype(np.float32)
    
    # ⭐ WRF LANDMASK: 1=陆地, 0=水
    # 转成 ROMS 约定的 mask_rho: 1=海洋, 0=陆地
    mask_rho = 1.0 - landmask
    
    n_eta, n_xi = lon_rho.shape
    
    # 从 cell 中心推算角点 (lon_vert, lat_vert)
    # 这是个标准的"网格细化"操作: 取相邻 4 个 cell 中心的平均作为它们共享的角点
    logger.info(f"  Computing cell corners from centers...")
    lon_vert = _infer_vertices(lon_rho)
    lat_vert = _infer_vertices(lat_rho)
    
    # 占位字段
    h = np.zeros_like(mask_rho)  # 大气没有"水深", 全 0
    pm = np.ones_like(mask_rho)
    pn = np.ones_like(mask_rho)
    angle = np.zeros_like(mask_rho)
    
    elapsed = time.time() - t0
    logger.info(f"  Loaded in {elapsed:.1f}s. Grid shape: {mask_rho.shape}")
    
    # ⭐ WRF 默认 all_cells_as_ocean=True: 大气数据全域有效
    if all_cells_as_ocean:
        logger.info(f"  all_cells_as_ocean=True: rendering all cells (incl. land)")
        mask_for_cells = np.ones_like(mask_rho)
    else:
        mask_for_cells = mask_rho
    
    return _finalize_grid_meta(
        source_name, lon_rho, lat_rho, lon_vert, lat_vert,
        mask_rho, mask_for_cells, h, pm, pn, angle,
    )


def _infer_vertices(centers: np.ndarray) -> np.ndarray:
    """
    从 cell 中心数组 (n_eta, n_xi) 推算角点数组 (n_eta+1, n_xi+1).
    
    每个内部角点 = 周围 4 个中心的平均.
    边缘角点 = 用外推 (中心 + 偏移).
    
    这是 WRF 没提供角点时的标准 fallback.
    """
    n_eta, n_xi = centers.shape
    vert = np.zeros((n_eta + 1, n_xi + 1), dtype=np.float64)
    
    # 内部角点: 4 个中心的平均
    vert[1:-1, 1:-1] = 0.25 * (
        centers[:-1, :-1] + centers[:-1, 1:] +
        centers[1:, :-1]  + centers[1:, 1:]
    )
    
    # 4 条边 (用外推)
    # 上边: extrapolate from row 0
    vert[0, 1:-1] = 2 * centers[0, :-1] - vert[1, 1:-1] + (centers[0, 1:] - centers[0, :-1]) * 0.5
    vert[0, 1:-1] = 0.5 * (centers[0, :-1] + centers[0, 1:])  # 简化: 两端中心的中点
    # 下边
    vert[-1, 1:-1] = 0.5 * (centers[-1, :-1] + centers[-1, 1:])
    # 左边
    vert[1:-1, 0] = 0.5 * (centers[:-1, 0] + centers[1:, 0])
    # 右边
    vert[1:-1, -1] = 0.5 * (centers[:-1, -1] + centers[1:, -1])
    
    # 4 个角
    # 用最近的中心向外延伸半个 cell
    dlon_corner = (centers[0, 1] - centers[0, 0]) * 0.5
    dlat_corner = (centers[1, 0] - centers[0, 0]) * 0.5
    vert[0, 0]   = centers[0, 0]   - dlon_corner - dlat_corner
    vert[0, -1]  = centers[0, -1]  + dlon_corner - dlat_corner
    vert[-1, 0]  = centers[-1, 0]  - dlon_corner + dlat_corner
    vert[-1, -1] = centers[-1, -1] + dlon_corner + dlat_corner
    
    return vert


def _finalize_grid_meta(source_name, lon_rho, lat_rho, lon_vert, lat_vert,
                        mask_rho, mask_for_cells, h, pm, pn, angle) -> GridMeta:
    """ROMS 和 WRF 路径的公共最后阶段: 算 bounds, suggested_view, ocean_cells."""
    n_eta, n_xi = mask_rho.shape
    
    valid = np.isfinite(lon_rho) & np.isfinite(lat_rho)
    bounds = {
        "minLon": float(np.min(lon_rho[valid])),
        "maxLon": float(np.max(lon_rho[valid])),
        "minLat": float(np.min(lat_rho[valid])),
        "maxLat": float(np.max(lat_rho[valid])),
    }
    
    center_lon = (bounds["minLon"] + bounds["maxLon"]) / 2
    center_lat = (bounds["minLat"] + bounds["maxLat"]) / 2
    zoom = _estimate_zoom(**bounds)
    suggested_view = {
        "longitude": center_lon,
        "latitude": center_lat,
        "zoom": zoom,
    }
    
    logger.info(f"  Pre-computing cell polygons...")
    t1 = time.time()
    ocean_cells = _build_ocean_cells(
        lon_vert, lat_vert, mask_for_cells, h
    )
    cell_elapsed = time.time() - t1
    label = "all" if np.all(mask_for_cells > 0.5) else "ocean"
    logger.info(
        f"  Built {len(ocean_cells)} {label} cells in {cell_elapsed:.1f}s "
        f"(out of {n_eta * n_xi} total, "
        f"{100 * len(ocean_cells) / (n_eta * n_xi):.1f}%)"
    )
    
    return GridMeta(
        source_name=source_name,
        lon_rho=lon_rho.astype(np.float32),
        lat_rho=lat_rho.astype(np.float32),
        lon_vert=lon_vert.astype(np.float32),
        lat_vert=lat_vert.astype(np.float32),
        mask_rho=mask_rho,  # 保留真实 mask (mask_for_cells 是渲染用的)
        h=h,
        pm=pm,
        pn=pn,
        angle=angle,
        n_eta=n_eta,
        n_xi=n_xi,
        bounds=bounds,
        ocean_cells=ocean_cells,
        suggested_view=suggested_view,
    )


# ============================================================
# 预计算: 把海洋格子转成多边形列表
# ============================================================
def _build_ocean_cells(
    lon_vert: np.ndarray,
    lat_vert: np.ndarray,
    mask_rho: np.ndarray,
    h: np.ndarray,
) -> list[dict]:
    """
    遍历所有 (eta, xi) 格子,把"海洋格子"转成多边形描述。
    
    每个 rho 格子 (i, j) 对应 4 个 vert 角点:
      lon_vert[i,   j  ]  (左下)
      lon_vert[i,   j+1]  (右下)
      lon_vert[i+1, j+1]  (右上)
      lon_vert[i+1, j  ]  (左上)
    
    返回的字典结构和前端 DeckGL PolygonLayer 期望的格式对齐。
    """
    n_eta, n_xi = mask_rho.shape
    cells = []
    
    for i in range(n_eta):
        for j in range(n_xi):
            if mask_rho[i, j] < 0.5:
                continue
            
            lon00 = lon_vert[i,     j  ]
            lat00 = lat_vert[i,     j  ]
            lon10 = lon_vert[i,     j+1]
            lat10 = lat_vert[i,     j+1]
            lon11 = lon_vert[i+1, j+1]
            lat11 = lat_vert[i+1, j+1]
            lon01 = lon_vert[i+1, j  ]
            lat01 = lat_vert[i+1, j  ]
            
            if not (np.isfinite(lon00) and np.isfinite(lon10) and
                    np.isfinite(lon11) and np.isfinite(lon01)):
                continue
            
            cells.append({
                "row": int(i),
                "col": int(j),
                "polygon": [
                    [float(lon00), float(lat00)],
                    [float(lon10), float(lat10)],
                    [float(lon11), float(lat11)],
                    [float(lon01), float(lat01)],
                ],
                "depth": float(h[i, j]) if np.isfinite(h[i, j]) else None,
            })
    
    return cells


# ============================================================
# 缓存层: 加载或下载并缓存
# ============================================================
def get_grid_meta(
    source_name: str = "perth",
    force_refresh: bool = False,
) -> GridMeta:
    """
    获取某数据源的网格元数据。
    
    流程:
    -----
    1. 检查本地缓存
    2. 缓存存在且不强制刷新 -> 从本地加载
    3. 否则 -> 从 OPeNDAP 下载 -> 缓存到本地 -> 加载
    """
    if source_name not in GRID_SOURCES:
        available = ", ".join(GRID_SOURCES.keys())
        raise ValueError(
            f"Unknown grid source: {source_name!r}. Available: {available}"
        )
    
    config = GRID_SOURCES[source_name]
    cache_dir = _get_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    local_nc = cache_dir / f"{source_name}_grid.nc"
    
    # 从配置读类型
    kind = config.get("kind", "roms")
    all_cells_as_ocean = config.get("all_cells_as_ocean", False)
    
    if local_nc.exists() and not force_refresh:
        logger.info(f"Using cached grid file: {local_nc}")
        meta = _load_grid_from_nc(local_nc, source_name, kind, all_cells_as_ocean)
        _verify_grid(meta, config)
        return meta
    
    urls_to_try = [config["url"]]
    if "url_fallback" in config:
        urls_to_try.append(config["url_fallback"])
    
    # 根据 kind 选要下载的变量
    if kind == "wrf":
        # WRF: 只需 LON/LAT/LANDMASK (角点和占位字段在加载时算)
        needed = ["LON", "LAT", "LANDMASK"]
    else:
        # ROMS: 完整 grid 字段
        needed = ["lon_rho", "lat_rho", "lon_vert", "lat_vert",
                  "mask_rho", "h", "pm", "pn", "angle"]
    
    download_error = None
    downloaded = False
    for url in urls_to_try:
        try:
            logger.info(f"Downloading grid from: {url}")
            t0 = time.time()
            
            with xr.open_dataset(url) as remote_ds:
                available = [v for v in needed if v in remote_ds.variables]
                missing = set(needed) - set(available)
                if missing:
                    logger.warning(f"  Variables not in source: {missing}")
                
                subset = remote_ds[available]
                subset.load()
                subset.to_netcdf(local_nc)
            
            elapsed = time.time() - t0
            logger.info(f"  Downloaded and cached in {elapsed:.1f}s")
            downloaded = True
            break
        
        except Exception as e:
            download_error = e
            logger.warning(f"  Download failed: {e}")
            if local_nc.exists():
                local_nc.unlink()
    
    if not downloaded:
        raise RuntimeError(
            f"Failed to download grid from all URLs. Last error: {download_error}"
        )
    
    meta = _load_grid_from_nc(local_nc, source_name, kind, all_cells_as_ocean)
    _verify_grid(meta, config)
    return meta


def _verify_grid(meta: GridMeta, config: dict) -> None:
    """简单校验下载的网格是否正确。"""
    expected = config.get("expected_shape")
    actual = (meta.n_eta, meta.n_xi)
    if expected and actual != expected:
        logger.warning(
            f"Grid shape mismatch! Expected {expected}, got {actual}. "
            f"Data may be from a different model run."
        )


# ============================================================
# 导出: 给前端用的 JSON 描述
# ============================================================
def export_grid_to_json(meta: GridMeta, output_path: str | Path) -> None:
    """
    把网格元数据中"前端需要的部分"导出成 JSON。
    """
    payload = {
        "source_name": meta.source_name,
        "n_eta": meta.n_eta,
        "n_xi": meta.n_xi,
        "bounds": meta.bounds,
        "suggested_view": meta.suggested_view,
        "ocean_cells": meta.ocean_cells,
    }
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    size_mb = output_path.stat().st_size / 1024 / 1024
    logger.info(f"Exported grid JSON to {output_path} ({size_mb:.2f} MB)")


# ============================================================
# 独立测试入口
# ============================================================
if __name__ == "__main__":
    """
    用法:
        python grid_meta.py              # 测试 perth (默认)
        python grid_meta.py cwa          # 测试 cwa
    
    第一次运行会从 OPeNDAP 下载 grid 文件并缓存到本地。
    之后运行直接从本地加载,几乎瞬时。
    """
    import sys
    source = sys.argv[1] if len(sys.argv) > 1 else "perth"
    
    print("=" * 60)
    print(f"Testing grid_meta ({source})")
    print("=" * 60)
    
    print("\n[Test 1] Load grid metadata")
    meta = get_grid_meta(source)
    print(f"  Source: {meta.source_name}")
    print(f"  Shape: ({meta.n_eta}, {meta.n_xi})")
    print(f"  Bounds: {meta.bounds}")
    print(f"  Suggested view: {meta.suggested_view}")
    
    print("\n[Test 2] Ocean cells statistics")
    n_ocean = int(np.sum(meta.mask_rho > 0.5))
    n_total = meta.n_eta * meta.n_xi
    print(f"  Total cells:  {n_total}")
    print(f"  Ocean cells:  {n_ocean} ({100 * n_ocean / n_total:.1f}%)")
    print(f"  Land cells:   {n_total - n_ocean}")
    print(f"  Polygon count: {len(meta.ocean_cells)} (filtered for valid coords)")
    
    print("\n[Test 3] Bathymetry statistics")
    ocean_h = meta.h[meta.mask_rho > 0.5]
    valid_h = ocean_h[np.isfinite(ocean_h)]
    print(f"  Depth range: {np.min(valid_h):.1f} ~ {np.max(valid_h):.1f} m")
    print(f"  Mean depth:  {np.mean(valid_h):.1f} m")
    
    print("\n[Test 4] Grid metric factors")
    if np.allclose(meta.pm, 1.0):
        print(f"  pm/pn not in grid file (using placeholder)")
        print(f"  Skipping resolution check")
    else:
        dx = 1.0 / meta.pm[meta.mask_rho > 0.5]
        dy = 1.0 / meta.pn[meta.mask_rho > 0.5]
        print(f"  dx (m): mean={np.mean(dx):.1f}, "
              f"min={np.min(dx):.1f}, max={np.max(dx):.1f}")
        print(f"  dy (m): mean={np.mean(dy):.1f}, "
              f"min={np.min(dy):.1f}, max={np.max(dy):.1f}")
        expected_res = {"perth": 500, "cwa": 2000}.get(source, "?")
        print(f"  ↑ Expected ~{expected_res}m resolution")
    
    print("\n[Test 5] Sample ocean cell")
    if meta.ocean_cells:
        cell = meta.ocean_cells[0]
        print(f"  Cell (row={cell['row']}, col={cell['col']}):")
        depth = cell.get('depth')
        if depth is not None:
            print(f"    Depth: {depth:.1f} m")
        print(f"    Polygon corners:")
        for corner in cell['polygon']:
            print(f"      [{corner[0]:.4f}, {corner[1]:.4f}]")
    
    print("\n[Test 6] Export to JSON")
    output_dir = Path(__file__).resolve().parent.parent / "data" / "frames" / source
    output_dir.mkdir(parents=True, exist_ok=True)
    export_grid_to_json(meta, output_dir / "grid.json")
    
    print("\n" + "=" * 60)
    print("All tests passed ✓")
    print("=" * 60)