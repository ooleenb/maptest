"""
prep_day.py
===========

核心预处理脚本: 给定一个日期,生成前端需要的完整数据包。

输出目录结构:
    backend/data/frames/<source>/<date>/
        meta.json           ← 帧时间戳、变量统计、版本信息
        temp.bin            ← 24 帧温度场 (Float32 二进制)
        salt.bin            ← 24 帧盐度场
        zeta.bin            ← 24 帧海面高度
        uv_00.png ~ uv_23.png  ← 24 帧 u/v 编码图

数据格式设计:
- 标量场 (temp/salt/zeta) → 裸 Float32 二进制
  * 浏览器原生支持 (一行 fetch + arrayBuffer + new Float32Array)
  * 24 帧打包成 1 个文件,减少网络请求
  * 陆地点存 NaN (前端绘图时跳过)
- u/v 流场 → PNG (R=u, G=v, B=mask)
  * GPU 友好: 浏览器解码到纹理是硬件加速
  * 归一化范围在 meta.json 里,前端解码时还原
- meta.json: 所有元信息

依赖:
    pip install xarray netCDF4 dask numpy pillow

用法:
    python prep_day.py 2026-03-11
    python prep_day.py 2026-03-11 --source perth
    python prep_day.py 2026-03-11 --output-dir /path/to/output
"""

from __future__ import annotations

import argparse
import json
import logging
import struct
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

# 导入我们前两步写好的模块
from data_loader import ROMSDataSource, FrameData
from grid_meta import get_grid_meta, GridMeta


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(handler)


# ============================================================
# 输出格式版本
# ============================================================
# 当数据格式发生破坏性变化时,bump 这个版本号。
# 前端可以读 meta.json 的 format_version 检查兼容性。
FORMAT_VERSION = "1.0"


# ============================================================
# u/v PNG 编码范围
# ============================================================
# 把 u/v (m/s) 归一化到 0-255 的 byte 值。
# 范围要覆盖实际数据的 99% 以上,同时留点 headroom。
# Perth 域典型流速范围 ±1 m/s,极端值 ±2 m/s,这里设到 ±2.5 m/s 留余地。
UV_NORM_RANGE = 2.5  # u/v 的归一化半范围(单位 m/s)


# ============================================================
# 默认输出目录
# ============================================================
def _default_output_dir() -> Path:
    """默认输出到 backend/data/frames/"""
    return Path(__file__).resolve().parent.parent / "data" / "frames"


# ============================================================
# 标量场打包
# ============================================================
def _pack_scalar_field(
    frames: list[FrameData],
    var_name: str,
    output_path: Path,
) -> dict:
    """
    把 24 帧的某个标量场 (temp/salt/zeta) 打包成单个 Float32 二进制文件。
    
    数据布局:
        frame_0_row_0_col_0, frame_0_row_0_col_1, ..., frame_0_row_258_col_128,
        frame_1_row_0_col_0, ...,
        ...
        frame_23_...
    
    陆地/无效点保持 NaN (前端绘图时跳过)。
    
    参数:
    -----
    frames: FrameData 列表
    var_name: 'temp' / 'salt' / 'zeta'
    output_path: 输出文件路径
    
    返回:
    -----
    包含此变量元信息的字典(用于 meta.json)
    """
    # 用 getattr 动态访问 frame.temp / frame.salt / frame.zeta
    arrays = [getattr(f, var_name) for f in frames]
    
    # 把 24 个 (259, 129) 数组堆成 (24, 259, 129) 大数组
    stacked = np.stack(arrays, axis=0).astype(np.float32)
    
    # 写入文件 (.tobytes() 是 little-endian, 和 JS Float32Array 一致)
    output_path.write_bytes(stacked.tobytes())
    
    # 计算统计信息
    # 注意: 每帧分别算 min/max(用于前端"每帧自适应配色"),
    # 同时算全天 min/max(用于"固定配色")
    frame_min = []
    frame_max = []
    for arr in arrays:
        valid = arr[np.isfinite(arr)]
        if len(valid) > 0:
            frame_min.append(float(np.min(valid)))
            frame_max.append(float(np.max(valid)))
        else:
            frame_min.append(None)
            frame_max.append(None)
    
    # 全天的 min/max,过滤 None
    valid_mins = [v for v in frame_min if v is not None]
    valid_maxs = [v for v in frame_max if v is not None]
    
    info = {
        "byte_offset": 0,  # 单文件,每个变量一个文件,所以偏移是 0
        "byte_length": output_path.stat().st_size,
        "dtype": "float32",
        "shape": list(stacked.shape),       # [24, 259, 129]
        "n_frames": len(frames),
        "frame_min": frame_min,
        "frame_max": frame_max,
        "global_min": min(valid_mins) if valid_mins else None,
        "global_max": max(valid_maxs) if valid_maxs else None,
        # 1% / 99% 分位数,用于"鲁棒"配色范围(避免少数极端值拉偏色阶)
        "p01": float(np.nanpercentile(stacked, 1)),
        "p99": float(np.nanpercentile(stacked, 99)),
    }
    
    logger.info(
        f"  {var_name}.bin: {info['byte_length'] / 1024:.0f} KB, "
        f"range {info['global_min']:.2f} ~ {info['global_max']:.2f}"
    )
    
    return info


# ============================================================
# u/v PNG 编码
# ============================================================
def _encode_uv_to_png(
    u: np.ndarray,
    v: np.ndarray,
    mask: np.ndarray,
    output_path: Path,
    uv_range: float = UV_NORM_RANGE,
) -> None:
    """
    把一帧 u/v 编码成 PNG。
    
    编码规则:
        R = (u + uv_range) / (2 * uv_range) * 255    # u 归一化到 0-255
        G = (v + uv_range) / (2 * uv_range) * 255    # v 归一化到 0-255
        B = mask * 255                                # 1=有效, 0=无效
        A = 不用(可以省去,但 RGBA 在 PNG 中更标准)
    
    前端解码:
        u = R / 255 * 2 * uv_range - uv_range
        v = G / 255 * 2 * uv_range - uv_range
        valid = B > 127
    """
    # 创建归一化数组,边界 clip 防止越界
    u_norm = np.clip((u + uv_range) / (2 * uv_range), 0, 1)
    v_norm = np.clip((v + uv_range) / (2 * uv_range), 0, 1)
    
    # NaN 替换为 0 (因为 mask 通道会标记无效)
    u_norm = np.where(np.isfinite(u_norm), u_norm, 0)
    v_norm = np.where(np.isfinite(v_norm), v_norm, 0)
    
    # 同时检查 u/v 是否都有效
    valid_uv = np.isfinite(u) & np.isfinite(v)
    
    # 海洋掩膜 AND u/v 有效性
    final_mask = (mask > 0.5) & valid_uv
    
    # 拼成 RGBA 数组 (uint8)
    h, w = u.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = (u_norm * 255).astype(np.uint8)   # R
    rgba[..., 1] = (v_norm * 255).astype(np.uint8)   # G
    rgba[..., 2] = (final_mask * 255).astype(np.uint8)  # B
    rgba[..., 3] = 255                                # A 全不透明
    
    # 用 Pillow 写 PNG
    # 注意: numpy 数组是 (eta, xi) 即 (row, col),
    # 图像是 (height, width),所以这里直接对应。
    # 但 PIL 默认 (width, height) 顺序,fromarray 用的是 numpy 的 (height, width)
    img = Image.fromarray(rgba, mode="RGBA")
    img.save(output_path, "PNG", optimize=True)


def _pack_uv_frames(
    frames: list[FrameData],
    mask_rho: np.ndarray,
    output_dir: Path,
) -> dict:
    """
    把 24 帧 u/v 全部编码成 PNG,返回元信息。
    """
    files = []
    total_bytes = 0
    
    for i, frame in enumerate(frames):
        output_path = output_dir / f"uv_{i:02d}.png"
        _encode_uv_to_png(frame.u, frame.v, mask_rho, output_path)
        files.append(output_path.name)
        total_bytes += output_path.stat().st_size
    
    # 计算实际 u/v 范围,用于确认归一化没截断
    u_all = np.stack([f.u for f in frames])
    v_all = np.stack([f.v for f in frames])
    u_valid = u_all[np.isfinite(u_all)]
    v_valid = v_all[np.isfinite(v_all)]
    
    actual_u_range = (float(np.min(u_valid)), float(np.max(u_valid)))
    actual_v_range = (float(np.min(v_valid)), float(np.max(v_valid)))
    
    # 检查是否被归一化截断
    truncated = (
        actual_u_range[0] < -UV_NORM_RANGE or
        actual_u_range[1] > UV_NORM_RANGE or
        actual_v_range[0] < -UV_NORM_RANGE or
        actual_v_range[1] > UV_NORM_RANGE
    )
    if truncated:
        logger.warning(
            f"  u/v values exceed PNG encoding range ±{UV_NORM_RANGE}! "
            f"u: {actual_u_range}, v: {actual_v_range}. "
            f"Increase UV_NORM_RANGE in prep_day.py."
        )
    
    info = {
        "files": files,
        "n_frames": len(frames),
        "encoding": "RGBA8 (R=u, G=v, B=mask, A=unused)",
        "norm_range": UV_NORM_RANGE,
        "decode_formula": {
            "u": "R / 255 * 2 * norm_range - norm_range",
            "v": "G / 255 * 2 * norm_range - norm_range",
            "valid": "B > 127",
        },
        "actual_u_range": list(actual_u_range),
        "actual_v_range": list(actual_v_range),
        "total_bytes": total_bytes,
    }
    
    logger.info(
        f"  uv_*.png: {total_bytes / 1024:.0f} KB total "
        f"({total_bytes / 24 / 1024:.1f} KB/frame), "
        f"u={actual_u_range[0]:.2f}~{actual_u_range[1]:.2f}, "
        f"v={actual_v_range[0]:.2f}~{actual_v_range[1]:.2f}"
    )
    
    return info


# ============================================================
# 主入口: 预处理一天的数据
# ============================================================
def prepare_day(
    date: str,
    source_name: str = "perth",
    output_base_dir: Optional[Path] = None,
    overwrite: bool = False,
    data_source: Optional[ROMSDataSource] = None,
) -> Path:
    """
    预处理某一天的数据,输出完整数据包。
    
    参数:
    -----
    date:             'YYYY-MM-DD'
    source_name:      数据源 ('perth' 等)
    output_base_dir:  输出根目录,默认 backend/data/frames/
    overwrite:        True = 覆盖已有数据
    data_source:      可选: 复用已经打开的 ROMSDataSource 句柄
                      (避免每次重新打开 OPeNDAP,加快 API 中的按需生成)
    
    返回:
    -----
    输出目录的 Path
    
    异常:
    -----
    ValueError: 日期不在源数据集中
    """
    # 准备输出目录路径(此时还不创建!)
    if output_base_dir is None:
        output_base_dir = _default_output_dir()
    output_dir = Path(output_base_dir) / source_name / date
    
    # 快速路径: 已存在且不强制覆盖
    if output_dir.exists() and not overwrite:
        meta_path = output_dir / "meta.json"
        if meta_path.exists():
            logger.info(
                f"Output already exists at {output_dir}. "
                f"Use --overwrite to regenerate."
            )
            return output_dir
    
    overall_start = time.time()
    logger.info(f"{'=' * 60}")
    logger.info(f"Preparing data: {source_name} / {date}")
    logger.info(f"{'=' * 60}")
    
    # ⭐ 步骤 0: 先验证日期是否存在,失败立刻抛出(不留下空目录)
    # 这里要么用传入的 data_source,要么自己开一个新的
    own_src = data_source is None
    if own_src:
        data_source = ROMSDataSource(source_name)
    
    try:
        # 这一步会从 .ncml 句柄查日期是否存在,不实际下载数据
        # 如果不存在,raise ValueError,而我们还没创建任何目录/文件
        available_dates = data_source.list_available_dates()
        if date not in available_dates:
            raise ValueError(
                f"Date {date!r} not available in source {source_name!r}. "
                f"Available range: {available_dates[0]} to {available_dates[-1]}"
            )
        
        # ✅ 验证通过,现在可以创建目录了
        output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Output: {output_dir}")
        
        # 步骤 1: 加载网格元数据 (本地缓存,极快)
        logger.info("\n[1/4] Loading grid metadata...")
        grid_meta = get_grid_meta(source_name)
        
        # 步骤 2: 从 OPeNDAP 拉一天数据
        logger.info(f"\n[2/4] Fetching 24 frames from OPeNDAP...")
        frames = data_source.get_day(date)
        
        if len(frames) == 0:
            raise RuntimeError(f"No data returned for {date}")
        
        # 步骤 3: 打包标量场
        logger.info(f"\n[3/4] Packing scalar fields...")
        var_info = {}
        for var_name in ["temp", "salt", "zeta"]:
            var_info[var_name] = _pack_scalar_field(
                frames, var_name, output_dir / f"{var_name}.bin"
            )
        
        # 步骤 4: 编码 u/v PNG
        logger.info(f"\n[4/4] Encoding u/v to PNG...")
        uv_info = _pack_uv_frames(frames, grid_meta.mask_rho, output_dir)
        
        # 写 meta.json
        times_iso = [f.time.isoformat() for f in frames]
        meta = {
            "format_version": FORMAT_VERSION,
            "source": source_name,
            "date": date,
            "n_frames": len(frames),
            "grid_shape": [grid_meta.n_eta, grid_meta.n_xi],
            "times": times_iso,
            "variables": var_info,
            "uv": uv_info,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        
        meta_path = output_dir / "meta.json"
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=2)
        
        # 汇总
        overall_elapsed = time.time() - overall_start
        total_size = sum(p.stat().st_size for p in output_dir.iterdir())
        
        logger.info(f"\n{'=' * 60}")
        logger.info(f"Done in {overall_elapsed:.1f}s")
        logger.info(f"Output size: {total_size / 1024 / 1024:.2f} MB")
        logger.info(f"{'=' * 60}")
        
        return output_dir
    
    finally:
        # 只关闭"自己开"的句柄;借来的句柄不关
        if own_src:
            data_source.close()


# ============================================================
# CLI
# ============================================================
def main():
    parser = argparse.ArgumentParser(
        description="Preprocess one day of ROMS data into front-end-ready format."
    )
    parser.add_argument(
        "date",
        help="Date in YYYY-MM-DD format (e.g., 2026-03-11)"
    )
    parser.add_argument(
        "--source",
        default="perth",
        help="Data source name (default: perth)"
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Output base directory (default: backend/data/frames/)"
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing output"
    )
    args = parser.parse_args()
    
    output_base = Path(args.output_dir) if args.output_dir else None
    prepare_day(
        date=args.date,
        source_name=args.source,
        output_base_dir=output_base,
        overwrite=args.overwrite,
    )


if __name__ == "__main__":
    main()