"""
data_loader.py
==============

统一的 OPeNDAP / NetCDF 数据访问层。

设计思路:
---------
- 所有与"取数据"相关的逻辑集中在这一个文件里
- 上层代码 (prep_day.py / api.py) 不需要关心 OPeNDAP URL、变量名、时间索引等细节
- 通过 .ncml 聚合视图访问连续多天数据,而不是按日打开单个 .nc 文件
- 用 dask 做懒加载,只把"实际要用的那一帧"读入内存,而不是把整个 5 个月数据下载下来
- 内置重试机制,应对偶尔卡顿的 OPeNDAP 网络

使用示例:
---------
    from data_loader import ROMSDataSource
    
    src = ROMSDataSource("perth")
    frame = src.get_frame("2026-03-11", hour=13)
    print(frame.temp.shape)           # (259, 129)
    
    src_cwa = ROMSDataSource("cwa")
    frame_cwa = src_cwa.get_frame("2026-03-11", hour=13)
    print(frame_cwa.temp.shape)       # (640, 480)

依赖:
-----
    pip install xarray netCDF4 dask numpy
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import xarray as xr


# ============================================================
# 日志配置
# ============================================================
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(handler)


# ============================================================
# 数据源配置
# ============================================================
# Perth 和 CWA 的 qck 数据集使用相同的 surface-only 变量命名:
#   temp_sur, salt_sur, u_sur_eastward, v_sur_northward, zeta
# 所以新增数据源只需要换 URL,变量名一致。
DATA_SOURCES = {
    "perth": {
        "name": "Perth waters 500m ROMS",
        # .ncml 聚合 URL —— 连续 5 个月数据
        "ncml_url": "http://boreas.mywire.org:8080/thredds/dodsC/perthqck/perth_qck_2026.ncml",
        "resolution_m": 500,
        "time_dim": "ocean_time",
    },
    "cwa": {
        "name": "Central WA ~2km ROMS",
        # ⚠️ URL 命名是 misleading 的:
        # 文件名带 "_202601" 看起来只是一月份, 但实际是整年的聚合数据
        # (验证: ocean_time 维度有 3288 时步, 137 天 × 24 小时 = 2026-01 到 2026-05)
        # 真正一月份命名的 cwa_qck_2026.ncml 反而是 grid 文件 (静态网格定义),
        # 由 grid_meta.py 独立使用。
        "ncml_url": "http://boreas.mywire.org:8080/thredds/dodsC/cwaqck/cwa_qck_202601.ncml",
        "resolution_m": 2000,
        "time_dim": "ocean_time",
    },
}


# ============================================================
# 工具函数: numpy datetime64 -> python datetime
# ============================================================
def np_datetime_to_py(np_time: np.datetime64) -> datetime:
    """
    把 numpy datetime64 (纳秒精度) 转成 python datetime (微秒精度,UTC)。
    
    为什么需要这个函数:
    -----------------
    numpy 的 datetime64[ns] 转字符串会带 9 位小数 (纳秒),
    但 python 标准库 datetime.fromisoformat() 在 3.11 之前
    最多只接受 6 位小数 (微秒),所以直接转字符串会报错。
    """
    py_dt = np_time.astype('datetime64[s]').astype(datetime)
    return py_dt.replace(tzinfo=timezone.utc)


# ============================================================
# 工具函数: 哨兵值清洗
# ============================================================
def _sanitize(arr: np.ndarray, threshold: float = 1e30) -> np.ndarray:
    """
    把数组里的"哨兵值"(ROMS 的 _FillValue, 通常是 1e37)替换成 NaN。
    
    为什么需要:
    ---------
    某些 OPeNDAP 数据集 (例如 CWA) 的 _FillValue 没被 xarray 自动 mask 掉,
    导致 zeta/temp 等场出现 1e37 这种极端值。后续 PNG 编码、配色范围计算
    都会被这种值污染 (例如颜色范围被拉到 0 ~ 1e37,所有合理数据挤成一片)。
    
    Perth 没出现这问题, CWA 偶尔有, 不管哪个都过滤一遍是最稳的策略。
    
    阈值 1e30 是因为合理的物理量都不会超过这个 (温度 0~30, 流速 0~5,
    高度 ±10 米, 盐度 0~40). 任何 > 1e30 几乎肯定是哨兵。
    """
    arr = arr.astype(np.float32, copy=False)
    # 任何绝对值超过阈值的都视为无效
    invalid = np.abs(arr) > threshold
    if np.any(invalid):
        arr = np.where(invalid, np.nan, arr).astype(np.float32)
    return arr


# ============================================================
# 数据帧的标准结构
# ============================================================
@dataclass
class FrameData:
    """
    单个时间点的所有变量,组织成一个统一的结构。
    
    所有 2D 数组的 shape 都是 (eta_rho, xi_rho):
        Perth: (259, 129)
        CWA:   (640, 480)
    """
    time: datetime
    time_index: int
    
    temp: np.ndarray
    salt: np.ndarray
    zeta: np.ndarray
    u: np.ndarray
    v: np.ndarray
    
    @property
    def shape(self) -> tuple[int, int]:
        return self.temp.shape


# ============================================================
# 主数据源类
# ============================================================
class ROMSDataSource:
    """
    ROMS 数据源的统一访问接口。
    
    一个实例对应一个数据源(perth / cwa / ...)。
    内部维护一个长期打开的 xarray Dataset 句柄,通过 dask 懒加载,
    只在 .get_frame() 时才真正下载需要的那一帧数据。
    """
    
    def __init__(self, source_name: str = "perth", lazy_open: bool = True):
        """
        参数:
        -----
        source_name: 数据源名字,必须是 DATA_SOURCES 里的 key
        lazy_open:   True = 立刻打开 .ncml 句柄(可能慢几秒)
                     False = 第一次 get_frame 时再打开
        """
        if source_name not in DATA_SOURCES:
            available = ", ".join(DATA_SOURCES.keys())
            raise ValueError(
                f"Unknown data source: {source_name!r}. Available: {available}"
            )
        
        self.source_name = source_name
        self.config = DATA_SOURCES[source_name]
        self._dataset: Optional[xr.Dataset] = None
        
        if not lazy_open:
            self._open()
    
    # ------------------------------------------------------------
    # 内部: 打开 .ncml 句柄
    # ------------------------------------------------------------
    def _open(self, max_retries: int = 3, retry_delay: float = 2.0) -> xr.Dataset:
        """
        打开 .ncml 数据集。带重试机制,因为 OPeNDAP 偶尔会临时卡顿。
        
        关键参数:
        - chunks={}: 启用 dask 懒加载,默认每个变量切成一块。
        - decode_times=True: 把 ocean_time 自动解析成 datetime64
        """
        if self._dataset is not None:
            return self._dataset
        
        url = self.config["ncml_url"]
        logger.info(f"Opening dataset ({self.source_name}): {url}")
        
        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                t0 = time.time()
                ds = xr.open_dataset(
                    url,
                    chunks={},
                    decode_times=True,
                )
                elapsed = time.time() - t0
                
                times = ds[self.config["time_dim"]].values
                logger.info(
                    f"  Opened in {elapsed:.1f}s. "
                    f"Time range: {times[0]} -> {times[-1]} "
                    f"({len(times)} timesteps)"
                )
                
                self._dataset = ds
                return ds
            except Exception as e:
                last_error = e
                logger.warning(
                    f"  Attempt {attempt}/{max_retries} failed: {e}"
                )
                if attempt < max_retries:
                    time.sleep(retry_delay)
        
        raise RuntimeError(
            f"Failed to open {url} after {max_retries} attempts. "
            f"Last error: {last_error}"
        )
    
    # ------------------------------------------------------------
    # 公共方法: 列出可用日期
    # ------------------------------------------------------------
    def list_available_dates(self) -> list[str]:
        """
        返回数据集里所有可用的日期(去重,YYYY-MM-DD 格式)。
        """
        ds = self._open()
        times = ds[self.config["time_dim"]].values
        date_strs = sorted({
            str(t)[:10]
            for t in times
        })
        return date_strs
    
    # ------------------------------------------------------------
    # 公共方法: 取某天某小时的单帧
    # ------------------------------------------------------------
    def get_frame(
        self,
        date: str,
        hour: int,
    ) -> FrameData:
        """
        取某一天某一小时的所有变量,打包成 FrameData。
        """
        if not (0 <= hour <= 23):
            raise ValueError(f"hour must be 0-23, got {hour}")
        
        ds = self._open()
        time_dim = self.config["time_dim"]
        
        target_time = np.datetime64(f"{date}T{hour:02d}:00:00")
        
        all_times = ds[time_dim].values
        matches = np.where(all_times == target_time)[0]
        
        if len(matches) == 0:
            available_on_date = [
                str(t) for t in all_times
                if str(t).startswith(date)
            ]
            if not available_on_date:
                raise ValueError(
                    f"Date {date} not available. "
                    f"Available range: {all_times[0]} to {all_times[-1]}"
                )
            else:
                raise ValueError(
                    f"Hour {hour} not available on {date}. "
                    f"Available hours: {[t[11:13] for t in available_on_date]}"
                )
        
        time_index = int(matches[0])
        return self.get_frame_by_index(time_index)
    
    # ------------------------------------------------------------
    # 公共方法: 按时间索引直接取
    # ------------------------------------------------------------
    def get_frame_by_index(self, time_index: int) -> FrameData:
        """
        直接通过整数索引取帧。比按日期/小时取快(省了查找步骤)。
        """
        ds = self._open()
        time_dim = self.config["time_dim"]
        
        t0 = time.time()
        snapshot = ds.isel({time_dim: time_index})
        
        needed_vars = ["temp_sur", "salt_sur", "u_sur_eastward",
                       "v_sur_northward", "zeta"]
        snapshot = snapshot[needed_vars].compute()
        elapsed = time.time() - t0
        
        time_value = snapshot[time_dim].values
        timestamp = np_datetime_to_py(time_value)
        
        logger.debug(
            f"  Fetched frame [{time_index}] {timestamp.isoformat()} "
            f"in {elapsed:.2f}s"
        )
        
        return FrameData(
            time=timestamp,
            time_index=time_index,
            temp=_sanitize(snapshot["temp_sur"].values),
            salt=_sanitize(snapshot["salt_sur"].values),
            zeta=_sanitize(snapshot["zeta"].values),
            u=_sanitize(snapshot["u_sur_eastward"].values),
            v=_sanitize(snapshot["v_sur_northward"].values),
        )
    
    # ------------------------------------------------------------
    # 公共方法: 取一整天的 24 帧(预处理主用法)
    # ------------------------------------------------------------
    def get_day(self, date: str) -> list[FrameData]:
        """
        取某一天的全部 24 小时数据。
        
        实现细节(性能关键):
        ------------------
        ❌ 慢的写法: isel(time=[i, i+1, ..., i+23])  # list of indices
        ✅ 快的写法: isel(time=slice(i, i+24))        # contiguous slice
        
        OPeNDAP 把 slice 合并成单次连续读取,比 24 个独立请求快几十倍。
        """
        ds = self._open()
        time_dim = self.config["time_dim"]
        
        all_times = ds[time_dim].values
        day_mask = np.array([str(t).startswith(date) for t in all_times])
        day_indices = np.where(day_mask)[0]
        
        if len(day_indices) == 0:
            raise ValueError(f"No data found for date {date}")
        
        if len(day_indices) != 24:
            logger.warning(
                f"Expected 24 hours on {date}, got {len(day_indices)}. "
                f"This is unusual—check the source data."
            )
        
        start_idx = int(day_indices[0])
        end_idx = int(day_indices[-1]) + 1
        
        expected = np.arange(start_idx, end_idx)
        if not np.array_equal(day_indices, expected):
            logger.warning(
                f"Day {date} has non-contiguous time indices, "
                f"falling back to slower list-based loading"
            )
            time_selector = day_indices.tolist()
        else:
            time_selector = slice(start_idx, end_idx)
        
        logger.info(
            f"Fetching {len(day_indices)} frames for {date} "
            f"(indices {start_idx}..{end_idx - 1})..."
        )
        t0 = time.time()
        
        needed_vars = ["temp_sur", "salt_sur", "u_sur_eastward",
                       "v_sur_northward", "zeta"]
        day_data = ds[needed_vars].isel({time_dim: time_selector}).load()
        
        elapsed = time.time() - t0
        n_frames = len(day_indices)
        logger.info(
            f"  Day loaded in {elapsed:.1f}s "
            f"({elapsed / n_frames:.2f}s/frame)"
        )
        
        frames = []
        for i, idx in enumerate(day_indices):
            time_value = day_data[time_dim].values[i]
            timestamp = np_datetime_to_py(time_value)
            
            frames.append(FrameData(
                time=timestamp,
                time_index=int(idx),
                temp=_sanitize(day_data["temp_sur"].values[i]),
                salt=_sanitize(day_data["salt_sur"].values[i]),
                zeta=_sanitize(day_data["zeta"].values[i]),
                u=_sanitize(day_data["u_sur_eastward"].values[i]),
                v=_sanitize(day_data["v_sur_northward"].values[i]),
            ))
        
        return frames
    
    # ------------------------------------------------------------
    # 公共方法: 取整个数据集的全局统计(用于固定 colormap 范围)
    # ------------------------------------------------------------
    def get_global_stats(
        self,
        variable: str,
        sample_step: int = 24,
    ) -> dict:
        """
        扫描所有时间点,算某个变量的全局 min/max/分位数。
        """
        ds = self._open()
        time_dim = self.config["time_dim"]
        n_times = len(ds[time_dim])
        
        sample_selector = slice(0, n_times, sample_step)
        n_samples = (n_times + sample_step - 1) // sample_step
        
        logger.info(
            f"Computing global stats for '{variable}' "
            f"using ~{n_samples} samples (stride={sample_step})..."
        )
        
        t0 = time.time()
        sampled = ds[variable].isel({time_dim: sample_selector}).load()
        values = sampled.values
        valid = values[np.isfinite(values)]
        
        elapsed = time.time() - t0
        logger.info(
            f"  Stats computed in {elapsed:.1f}s "
            f"({elapsed / n_samples:.2f}s/sample)"
        )
        
        return {
            "variable": variable,
            "min": float(np.min(valid)),
            "max": float(np.max(valid)),
            "p01": float(np.percentile(valid, 1)),
            "p99": float(np.percentile(valid, 99)),
            "mean": float(np.mean(valid)),
            "samples_used": n_samples,
        }
    
    # ------------------------------------------------------------
    # 析构: 关闭句柄
    # ------------------------------------------------------------
    def close(self):
        if self._dataset is not None:
            self._dataset.close()
            self._dataset = None
            logger.info(f"Closed dataset: {self.source_name}")
    
    def __enter__(self):
        self._open()
        return self
    
    def __exit__(self, *args):
        self.close()


# ============================================================
# 独立测试入口
# ============================================================
if __name__ == "__main__":
    """
    跑这个文件本身会执行一系列测试,验证数据访问层工作正常。
    
    用法:
        python data_loader.py              # 测试 perth (默认)
        python data_loader.py cwa          # 测试 cwa
    """
    import sys
    source = sys.argv[1] if len(sys.argv) > 1 else "perth"
    
    print("=" * 60)
    print(f"Testing ROMSDataSource ({source})")
    print("=" * 60)
    
    with ROMSDataSource(source) as src:
        # 测试 1: 列出可用日期
        print("\n[Test 1] List available dates")
        dates = src.list_available_dates()
        print(f"  Total available days: {len(dates)}")
        print(f"  First 3: {dates[:3]}")
        print(f"  Last 3:  {dates[-3:]}")
        
        # 测试 2: 取单帧
        test_date = dates[len(dates) // 2]
        print(f"\n[Test 2] Get single frame ({test_date} 13:00)")
        frame = src.get_frame(test_date, hour=13)
        print(f"  Time: {frame.time.isoformat()}")
        print(f"  Shape: {frame.shape}")
        print(f"  temp range: {np.nanmin(frame.temp):.2f} ~ "
              f"{np.nanmax(frame.temp):.2f} °C")
        print(f"  salt range: {np.nanmin(frame.salt):.2f} ~ "
              f"{np.nanmax(frame.salt):.2f}")
        print(f"  u range:    {np.nanmin(frame.u):.3f} ~ "
              f"{np.nanmax(frame.u):.3f} m/s")
        print(f"  v range:    {np.nanmin(frame.v):.3f} ~ "
              f"{np.nanmax(frame.v):.3f} m/s")
        print(f"  zeta range: {np.nanmin(frame.zeta):.3f} ~ "
              f"{np.nanmax(frame.zeta):.3f} m")
        
        # 测试 3: 取整天
        print(f"\n[Test 3] Get full day ({dates[0]})")
        day_frames = src.get_day(dates[0])
        print(f"  Got {len(day_frames)} frames")
        print(f"  First frame: {day_frames[0].time.isoformat()}")
        print(f"  Last frame:  {day_frames[-1].time.isoformat()}")
    
    print("\n" + "=" * 60)
    print("All tests passed ✓")
    print("=" * 60)