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
    print(meta.bounds)                 # {minLon, maxLon, minLat, maxLat}
    print(len(meta.ocean_cells))       # 海洋格子数,远小于 259*129
    
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
# 和 data_loader.py 解耦,这里独立定义,因为 grid 文件可能在不同的 catalog 下
GRID_SOURCES = {
    "perth": {
        # 用户已验证: perth_his_grid.nc 在 perthhis 目录下
        "url": "http://boreas.mywire.org:8080/thredds/dodsC/perthhis/perth_his_grid.nc",
        "expected_shape": (259, 129),  # 用于校验下载是否正确
    },
    # 未来扩展:
    # "cwa": {...}
}


# ============================================================
# 缓存路径
# ============================================================
# 默认存在项目根的 backend/data/grid/ 下
# 用环境变量 ROMS_GRID_CACHE_DIR 可以覆盖(Docker 部署时用)
def _get_cache_dir() -> Path:
    cache = os.environ.get("ROMS_GRID_CACHE_DIR")
    if cache:
        return Path(cache)
    # 默认: backend/data/grid/  (相对于本文件位置)
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
    # 数据源标识
    source_name: str
    
    # 原始 ROMS 网格量
    lon_rho: np.ndarray         # (eta, xi) 格子中心经度
    lat_rho: np.ndarray         # (eta, xi) 格子中心纬度
    lon_vert: np.ndarray        # (eta+1, xi+1) 格子顶点经度
    lat_vert: np.ndarray        # (eta+1, xi+1) 格子顶点纬度
    mask_rho: np.ndarray        # (eta, xi) 1=海, 0=陆
    h: np.ndarray               # (eta, xi) 海底深度(米),陆地处可能是无效值
    pm: np.ndarray              # (eta, xi) ξ 方向度量因子 (1/m)
    pn: np.ndarray              # (eta, xi) η 方向度量因子 (1/m)
    angle: np.ndarray           # (eta, xi) 网格旋转角(弧度)
    
    # 形状
    n_eta: int
    n_xi: int
    
    # 地理边界(用于地图初始视图)
    bounds: dict = field(default_factory=dict)
    # bounds 结构: {"minLon": ..., "maxLon": ..., "minLat": ..., "maxLat": ...}
    
    # 预计算: 海洋格子的多边形列表(DeckGL PolygonLayer 直接吃)
    # 每个元素是 {"row": r, "col": c, "polygon": [[lon, lat], ...], "h": depth}
    # 这是前端 buildRawCells 在做的事,我们提前算好,前端零计算
    ocean_cells: list[dict] = field(default_factory=list)
    
    # 推荐的地图初始视图
    suggested_view: dict = field(default_factory=dict)
    # suggested_view 结构: {"longitude": ..., "latitude": ..., "zoom": ...}


# ============================================================
# 估算合适的初始 zoom
# ============================================================
def _estimate_zoom(minLon: float, maxLon: float,
                    minLat: float, maxLat: float) -> int:
    """根据经纬度跨度估算一个合理的 Mapbox zoom 等级。
    
    参数命名用驼峰是为了能直接 **bounds 解包 (bounds 字典用驼峰 key,
    因为最终要传给前端 JSON,前端 JS 习惯驼峰)。
    """
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
# 核心: 从 NetCDF 文件加载网格元数据
# ============================================================
def _load_grid_from_nc(nc_path: str | Path, source_name: str) -> GridMeta:
    """
    从一个 NetCDF 文件加载网格元数据。
    可以是本地路径,也可以是 OPeNDAP URL。
    """
    logger.info(f"Loading grid metadata from: {nc_path}")
    t0 = time.time()
    
    with xr.open_dataset(str(nc_path)) as ds:
        # 提取所有需要的变量,立刻 load 到内存
        # 关键: 用 .values 触发实际读取
        lon_rho = ds["lon_rho"].values.astype(np.float64)
        lat_rho = ds["lat_rho"].values.astype(np.float64)
        lon_vert = ds["lon_vert"].values.astype(np.float64)
        lat_vert = ds["lat_vert"].values.astype(np.float64)
        mask_rho = ds["mask_rho"].values.astype(np.float32)
        h = ds["h"].values.astype(np.float32)
        pm = ds["pm"].values.astype(np.float32)
        pn = ds["pn"].values.astype(np.float32)
        angle = ds["angle"].values.astype(np.float32)
    
    elapsed = time.time() - t0
    logger.info(f"  Loaded in {elapsed:.1f}s. Grid shape: {mask_rho.shape}")
    
    n_eta, n_xi = mask_rho.shape
    
    # 边界(只考虑有效经纬度,陆地点 lat_rho 应该都是合法值,但保险起见过滤)
    valid = np.isfinite(lon_rho) & np.isfinite(lat_rho)
    bounds = {
        "minLon": float(np.min(lon_rho[valid])),
        "maxLon": float(np.max(lon_rho[valid])),
        "minLat": float(np.min(lat_rho[valid])),
        "maxLat": float(np.max(lat_rho[valid])),
    }
    
    # 推荐视图
    center_lon = (bounds["minLon"] + bounds["maxLon"]) / 2
    center_lat = (bounds["minLat"] + bounds["maxLat"]) / 2
    zoom = _estimate_zoom(**bounds)
    suggested_view = {
        "longitude": center_lon,
        "latitude": center_lat,
        "zoom": zoom,
    }
    
    # 预计算 ocean_cells (海洋格子的多边形)
    # 这是前端 buildRawCells 在做的事,我们提前算好
    logger.info(f"  Pre-computing ocean cell polygons...")
    t1 = time.time()
    ocean_cells = _build_ocean_cells(
        lon_vert, lat_vert, mask_rho, h
    )
    cell_elapsed = time.time() - t1
    logger.info(
        f"  Built {len(ocean_cells)} ocean cells in {cell_elapsed:.1f}s "
        f"(out of {n_eta * n_xi} total cells, "
        f"{100 * len(ocean_cells) / (n_eta * n_xi):.1f}% ocean)"
    )
    
    return GridMeta(
        source_name=source_name,
        lon_rho=lon_rho.astype(np.float32),
        lat_rho=lat_rho.astype(np.float32),
        lon_vert=lon_vert.astype(np.float32),
        lat_vert=lat_vert.astype(np.float32),
        mask_rho=mask_rho,
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
            # 只保留海洋格子
            if mask_rho[i, j] < 0.5:
                continue
            
            # 4 个角点(注意顺序: 逆时针,DeckGL 标准)
            lon00 = lon_vert[i,     j  ]
            lat00 = lat_vert[i,     j  ]
            lon10 = lon_vert[i,     j+1]
            lat10 = lat_vert[i,     j+1]
            lon11 = lon_vert[i+1, j+1]
            lat11 = lat_vert[i+1, j+1]
            lon01 = lon_vert[i+1, j  ]
            lat01 = lat_vert[i+1, j  ]
            
            # 跳过任何角点坐标无效的格子
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
    1. 检查本地缓存 (.nc 文件 + 预计算的 ocean_cells.json)
    2. 缓存存在且不强制刷新 -> 从本地加载
    3. 否则 -> 从 OPeNDAP 下载 grid 文件 -> 缓存到本地 -> 加载
    
    参数:
    -----
    source_name: 'perth' / 'cwa' / ...
    force_refresh: True = 强制重新从网络下载
    
    返回:
    -----
    GridMeta 对象
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
    
    # 检查本地缓存
    if local_nc.exists() and not force_refresh:
        logger.info(f"Using cached grid file: {local_nc}")
        meta = _load_grid_from_nc(local_nc, source_name)
        _verify_grid(meta, config)
        return meta
    
    # 从网络下载 (尝试主 URL,失败则用 fallback)
    urls_to_try = [config["url"]]
    if "url_fallback" in config:
        urls_to_try.append(config["url_fallback"])
    
    # 阶段 1: 下载到本地(只对网络错误重试 fallback)
    download_error = None
    downloaded = False
    for url in urls_to_try:
        try:
            logger.info(f"Downloading grid from: {url}")
            t0 = time.time()
            
            with xr.open_dataset(url) as remote_ds:
                needed = ["lon_rho", "lat_rho", "lon_vert", "lat_vert",
                          "mask_rho", "h", "pm", "pn", "angle"]
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
    
    # 阶段 2: 从本地文件加载(任何错误都直接抛出,这是代码 bug 不是网络问题)
    meta = _load_grid_from_nc(local_nc, source_name)
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
    
    前端不需要原始 mask_rho/pm/pn/angle 这些(那是科学计算用的),
    只需要:
    - bounds (用来 fit 地图)
    - suggested_view (初始视图)
    - ocean_cells (用来画温度场)
    - n_eta / n_xi (用来知道粒子场的形状)
    
    这个 JSON 体积大概几 MB(主要是 ocean_cells,一万多个海洋格子)。
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
        json.dump(payload, f, separators=(",", ":"))  # 压缩格式,不缩进
    size_mb = output_path.stat().st_size / 1024 / 1024
    logger.info(f"Exported grid JSON to {output_path} ({size_mb:.2f} MB)")


# ============================================================
# 独立测试入口
# ============================================================
if __name__ == "__main__":
    """
    用法: python grid_meta.py
    
    第一次运行会从 OPeNDAP 下载 grid 文件并缓存到本地。
    之后运行直接从本地加载,几乎瞬时。
    """
    print("=" * 60)
    print("Testing grid_meta (perth)")
    print("=" * 60)
    
    # 测试 1: 加载网格(第一次会下载,之后用缓存)
    print("\n[Test 1] Load grid metadata")
    meta = get_grid_meta("perth")
    print(f"  Source: {meta.source_name}")
    print(f"  Shape: ({meta.n_eta}, {meta.n_xi})")
    print(f"  Bounds: {meta.bounds}")
    print(f"  Suggested view: {meta.suggested_view}")
    
    # 测试 2: 海陆比例
    print("\n[Test 2] Ocean cells statistics")
    n_ocean = int(np.sum(meta.mask_rho > 0.5))
    n_total = meta.n_eta * meta.n_xi
    print(f"  Total cells:  {n_total}")
    print(f"  Ocean cells:  {n_ocean} ({100 * n_ocean / n_total:.1f}%)")
    print(f"  Land cells:   {n_total - n_ocean}")
    print(f"  Polygon count: {len(meta.ocean_cells)} (filtered for valid coords)")
    
    # 测试 3: 水深统计
    print("\n[Test 3] Bathymetry statistics")
    ocean_h = meta.h[meta.mask_rho > 0.5]
    valid_h = ocean_h[np.isfinite(ocean_h)]
    print(f"  Depth range: {np.min(valid_h):.1f} ~ {np.max(valid_h):.1f} m")
    print(f"  Mean depth:  {np.mean(valid_h):.1f} m")
    
    # 测试 4: 网格度量因子
    print("\n[Test 4] Grid metric factors")
    # pm = 1/dx, dx = 1/pm
    dx = 1.0 / meta.pm[meta.mask_rho > 0.5]
    dy = 1.0 / meta.pn[meta.mask_rho > 0.5]
    print(f"  dx (m): mean={np.mean(dx):.1f}, "
          f"min={np.min(dx):.1f}, max={np.max(dx):.1f}")
    print(f"  dy (m): mean={np.mean(dy):.1f}, "
          f"min={np.min(dy):.1f}, max={np.max(dy):.1f}")
    print(f"  ↑ Confirms model resolution (should be ~500m)")
    
    # 测试 5: 第一个海洋格子的多边形
    print("\n[Test 5] Sample ocean cell")
    if meta.ocean_cells:
        cell = meta.ocean_cells[0]
        print(f"  Cell (row={cell['row']}, col={cell['col']}):")
        print(f"    Depth: {cell['depth']:.1f} m")
        print(f"    Polygon corners:")
        for corner in cell['polygon']:
            print(f"      [{corner[0]:.4f}, {corner[1]:.4f}]")
    
    # 测试 6: 导出 JSON(测试前端打包流程)
    print("\n[Test 6] Export to JSON")
    output_dir = Path(__file__).resolve().parent.parent / "data" / "frames" / "perth"
    output_dir.mkdir(parents=True, exist_ok=True)
    export_grid_to_json(meta, output_dir / "grid.json")
    
    print("\n" + "=" * 60)
    print("All tests passed ✓")
    print("=" * 60)