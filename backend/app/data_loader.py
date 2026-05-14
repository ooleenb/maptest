"""
data_loader.py
==============

统一的 OPeNDAP / NetCDF 数据访问层。

设计思路:
---------
- 所有与"取数据"相关的逻辑集中在这一个文件里
- 上层代码 (prep_day.py / api.py) 不需要关心 OPeNDAP URL、变量名、时间索引等细节
- 支持两种访问模式:
    "aggregated": 一个 ncml URL 提供整年数据 (Perth/CWA ROMS)
    "per_day":    每天一个单独的 .nc 文件 (WRF)
- 不同数据源的实际变量名可能不同 (例如 ROMS 是 temp_sur, WRF 是 Tair),
  通过 var_map 配置统一映射, 上层代码看到的永远是 temp/salt/zeta/u/v

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
# 每个源用统一的接口暴露 (temp/salt/zeta/u/v + time_dim),
# 通过 var_map 把内部统一名映射到该数据集真实的变量名。
#
# access_mode 决定怎么打开数据:
#   "aggregated": 用 ncml_url, 一个句柄管所有日期 (适合 Perth/CWA)
#   "per_day":    用 day_url_pattern.format(ymd="20260516") 按需打开单天文件 (适合 WRF)
DATA_SOURCES = {
    "perth": {
        "name": "Perth waters 500m ROMS",
        "kind": "ocean",
        "access_mode": "aggregated",
        "ncml_url": "http://boreas.mywire.org:8080/thredds/dodsC/perthqck/perth_qck_2026.ncml",
        "resolution_m": 500,
        "time_dim": "ocean_time",
        # ROMS surface 变量
        # var_map 新结构: scalars 是 {规范名: 真实变量名} 字典, 可任意数量;
        # u/v 单独列出 (矢量场, 粒子系统专用)
        "var_map": {
            "scalars": {
                "temp": "temp_sur",
                "salt": "salt_sur",
                "zeta": "zeta",
            },
            "u": "u_sur_eastward",
            "v": "v_sur_northward",
        },
    },
    "cwa": {
        "name": "Central WA ~2km ROMS",
        "kind": "ocean",
        "access_mode": "aggregated",
        # ⚠️ 命名 misleading: cwa_qck_202601.ncml 其实是全年聚合 (137 天)
        # 真正一月份命名的 cwa_qck_2026.ncml 反而是 grid 文件
        "ncml_url": "http://boreas.mywire.org:8080/thredds/dodsC/cwaqck/cwa_qck_202601.ncml",
        "resolution_m": 2000,
        "time_dim": "ocean_time",
        "var_map": {
            "scalars": {
                "temp": "temp_sur",
                "salt": "salt_sur",
                "zeta": "zeta",
            },
            "u": "u_sur_eastward",
            "v": "v_sur_northward",
        },
    },
    # --- WRF 大气模型 (per_day 模式, 单天 .nc 文件, 无 ncml 聚合) ---
    # d01 = 西澳大范围, d02 = Perth 区域. 两者结构完全相同, 仅网格大小不同.
    # WRF 数据特点:
    #   - 25 个时间点/天 (00:00-24:00 含两端), 代码取前 24
    #   - 全域有效 (陆地+海洋都有值, 不像 ROMS 仅海洋)
    #   - 标量变量比 ROMS 多: 气温/气压/湿度/降雨/云量
    #   - 变量挂在多个 time 坐标上 (time/wind_time/tair_time...), 值都相同
    "wrf_d01": {
        "name": "Western Australia WRF (atmosphere)",
        "kind": "atmosphere",
        "access_mode": "per_day",
        "day_url_pattern": "http://boreas.mywire.org:8080/thredds/dodsC/WRF2026/wrf_roms_d01_{ymd}.nc",
        "date_range_start": "2026-01-01",
        "date_range_end":   "2026-05-21",
        "resolution_m": 2000,
        "time_dim": "time",          # WRF 主时间坐标
        "max_frames": 24,            # 25 个点取前 24 (丢弃重复的 24:00)
        "var_map": {
            "scalars": {
                "temp":  "Tair",     # 2m 气温 (\u00b0C)
                "Pair":  "Pair",     # 海平面气压 (mbar)
                "Qair":  "Qair",     # 相对湿度 (0-100)
                "rain":  "rain",     # 降雨率 (kg m-2 s-1)
                "cloud": "cloud",    # 云量 (0-1)
            },
            "u": "Uwind",            # 10m 东向风 (m/s)
            "v": "Vwind",            # 10m 北向风 (m/s)
        },
    },
    "wrf_d02": {
        "name": "Perth WRF (atmosphere)",
        "kind": "atmosphere",
        "access_mode": "per_day",
        "day_url_pattern": "http://boreas.mywire.org:8080/thredds/dodsC/WRF2026/wrf_roms_d02_{ymd}.nc",
        "date_range_start": "2026-01-01",
        "date_range_end":   "2026-05-21",
        "resolution_m": 2000,
        "time_dim": "time",
        "max_frames": 24,
        "var_map": {
            "scalars": {
                "temp":  "Tair",
                "Pair":  "Pair",
                "Qair":  "Qair",
                "rain":  "rain",
                "cloud": "cloud",
            },
            "u": "Uwind",
            "v": "Vwind",
        },
    },
}


# ============================================================
# 工具函数: numpy datetime64 -> python datetime
# ============================================================
def np_datetime_to_py(np_time: np.datetime64) -> datetime:
    """
    把 numpy datetime64 (纳秒精度) 转成 python datetime (微秒精度,UTC)。
    """
    py_dt = np_time.astype('datetime64[s]').astype(datetime)
    return py_dt.replace(tzinfo=timezone.utc)


# ============================================================
# 工具函数: 哨兵值清洗
# ============================================================
def _sanitize(arr: np.ndarray, threshold: float = 1e30) -> np.ndarray:
    """把数组里的"哨兵值" (例如 1e37) 替换成 NaN。"""
    arr = arr.astype(np.float32, copy=False)
    invalid = np.abs(arr) > threshold
    if np.any(invalid):
        arr = np.where(invalid, np.nan, arr).astype(np.float32)
    return arr


# ============================================================
# 工具函数: 日期范围生成
# ============================================================
def _generate_date_range(start: str, end: str) -> list[str]:
    """生成 [start, end] 之间所有日期的 YYYY-MM-DD 字符串列表。"""
    from datetime import date as date_cls, timedelta
    sd = date_cls.fromisoformat(start)
    ed = date_cls.fromisoformat(end)
    dates = []
    cur = sd
    while cur <= ed:
        dates.append(cur.isoformat())
        cur += timedelta(days=1)
    return dates


# ============================================================
# 数据帧的标准结构
# ============================================================
@dataclass
class FrameData:
    """单个时间点的所有变量.
    
    重构说明 (字典式):
    ------------------
    原本硬编码 temp/salt/zeta/u/v 五个字段, 只能装 ROMS 的固定变量集.
    现在标量场全部进 `scalars` 字典, 可容纳任意数量、任意命名的变量:
      - ROMS:  scalars = {"temp":..., "salt":..., "zeta":...}
      - WRF:   scalars = {"temp":..., "Pair":..., "Qair":..., "rain":..., "cloud":...}
    
    矢量场 u/v 仍单独留字段 —— 粒子系统专门消费它们, 留着方便.
    
    向后兼容:
    --------
    通过 __getattr__, 旧代码的 `frame.temp` / `frame.salt` 仍然可用,
    自动转发到 `frame.scalars["temp"]`. 这样 prep_day.py 等调用方
    暂时无需改动 (后续阶段会逐步迁移到显式的 frame.scalars[...]).
    """
    time: datetime
    time_index: int
    
    scalars: dict[str, np.ndarray]   # {"temp": arr, "salt": arr, ...} 任意标量变量
    u: np.ndarray                     # 矢量场 u 分量 (东向流速 / 东向风速)
    v: np.ndarray                     # 矢量场 v 分量 (北向流速 / 北向风速)
    
    def __getattr__(self, name: str) -> np.ndarray:
        """向后兼容: frame.temp -> frame.scalars["temp"].
        
        注意: __getattr__ 只在常规属性查找失败时才被调用,
        所以 time / time_index / scalars / u / v 不会进到这里.
        """
        # 避免 dataclass 初始化期间的递归 (scalars 还没设置时)
        scalars = self.__dict__.get("scalars")
        if scalars is not None and name in scalars:
            return scalars[name]
        raise AttributeError(
            f"{type(self).__name__!r} has no attribute {name!r} "
            f"(available scalars: {list(scalars.keys()) if scalars else []})"
        )
    
    @property
    def shape(self) -> tuple[int, int]:
        """网格形状. 从 u 分量取 (所有变量同形状)."""
        return self.u.shape
    
    @property
    def variables(self) -> list[str]:
        """这一帧包含的所有标量变量名."""
        return list(self.scalars.keys())


# ============================================================
# 主数据源类
# ============================================================
class ROMSDataSource:
    """
    数据源的统一访问接口 (尽管叫 ROMSDataSource, 也支持 WRF 等非 ROMS 数据)。
    
    内部根据 access_mode 走不同路径:
    - aggregated: 维护一个长期 xr.Dataset 句柄
    - per_day:    每次 get_day 时打开/关闭单天文件
    """
    
    def __init__(self, source_name: str = "perth", lazy_open: bool = True):
        if source_name not in DATA_SOURCES:
            available = ", ".join(DATA_SOURCES.keys())
            raise ValueError(
                f"Unknown data source: {source_name!r}. Available: {available}"
            )
        
        self.source_name = source_name
        self.config = DATA_SOURCES[source_name]
        self.access_mode = self.config.get("access_mode", "aggregated")
        self._dataset: Optional[xr.Dataset] = None  # 仅 aggregated 模式用
        self._dataset_opened_at: float = 0.0  # 句柄打开时间戳, 用于 TTL
        # TTL: OPeNDAP 句柄默认 5 分钟过期, 之后下次访问自动重新打开
        # (源服务器可能在背后更新, 比如新一天的数据出来了)
        self._dataset_ttl: float = 300.0  # 5 分钟
        
        if not lazy_open and self.access_mode == "aggregated":
            self._open()
    
    # ------------------------------------------------------------
    # aggregated 模式: 打开长期句柄
    # ------------------------------------------------------------
    def _open(
        self,
        max_retries: int = 3,
        retry_delay: float = 2.0,
        force_refresh: bool = False,
    ) -> xr.Dataset:
        """打开 .ncml 数据集 (仅 aggregated 模式).
        
        Args:
            force_refresh: 如果 True, 即便句柄存在也强制关闭并重开.
                          用于响应"用户请求 dates 列表"等需要新鲜数据的场景.
        """
        if self.access_mode != "aggregated":
            raise RuntimeError(
                f"_open() called on per_day source {self.source_name!r}. "
                f"Use _open_day(date) instead."
            )
        
        # TTL 检查: 句柄超过生存时间则视为过期
        now = time.time()
        is_stale = (
            self._dataset is not None
            and (now - self._dataset_opened_at) > self._dataset_ttl
        )
        
        if self._dataset is not None and not force_refresh and not is_stale:
            return self._dataset
        
        # 需要重开: 先 close 旧的
        if self._dataset is not None:
            reason = "force_refresh" if force_refresh else f"stale ({now - self._dataset_opened_at:.0f}s old)"
            logger.info(f"Refreshing dataset ({self.source_name}): {reason}")
            try:
                self._dataset.close()
            except Exception:
                pass
            self._dataset = None
        
        url = self.config["ncml_url"]
        logger.info(f"Opening dataset ({self.source_name}): {url}")
        
        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                t0 = time.time()
                ds = xr.open_dataset(url, chunks={}, decode_times=True)
                elapsed = time.time() - t0
                
                times = ds[self.config["time_dim"]].values
                logger.info(
                    f"  Opened in {elapsed:.1f}s. "
                    f"Time range: {times[0]} -> {times[-1]} "
                    f"({len(times)} timesteps)"
                )
                
                self._dataset = ds
                self._dataset_opened_at = time.time()
                return ds
            except Exception as e:
                last_error = e
                logger.warning(f"  Attempt {attempt}/{max_retries} failed: {e}")
                if attempt < max_retries:
                    time.sleep(retry_delay)
        
        raise RuntimeError(
            f"Failed to open {url} after {max_retries} attempts. "
            f"Last error: {last_error}"
        )
    
    # ------------------------------------------------------------
    # per_day 模式: 按日期打开单天文件
    # ------------------------------------------------------------
    def _open_day(self, date: str, max_retries: int = 3) -> xr.Dataset:
        """打开某天的单文件 (仅 per_day 模式). 调用方负责 close()."""
        if self.access_mode != "per_day":
            raise RuntimeError(
                f"_open_day() called on aggregated source {self.source_name!r}."
            )
        
        # date 'YYYY-MM-DD' -> ymd 'YYYYMMDD'
        ymd = date.replace("-", "")
        url = self.config["day_url_pattern"].format(ymd=ymd)
        logger.info(f"Opening day file ({self.source_name} {date}): {url}")
        
        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                t0 = time.time()
                ds = xr.open_dataset(url, chunks={}, decode_times=True)
                elapsed = time.time() - t0
                logger.info(f"  Day file opened in {elapsed:.1f}s")
                return ds
            except Exception as e:
                last_error = e
                logger.warning(f"  Attempt {attempt}/{max_retries} failed: {e}")
                if attempt < max_retries:
                    time.sleep(2.0)
        
        raise RuntimeError(
            f"Failed to open {url} after {max_retries} attempts. "
            f"Last error: {last_error}"
        )
    
    # ------------------------------------------------------------
    # 公共方法: 列出可用日期
    # ------------------------------------------------------------
    def list_available_dates(self, force_refresh: bool = False) -> list[str]:
        """返回数据集里所有可用的日期 (YYYY-MM-DD 格式).
        
        Args:
            force_refresh: 若 True, 重新连 OPeNDAP 拿最新时间维度
                          (用于前端请求"最新可用日期"的情况)
        """
        if self.access_mode == "aggregated":
            # 扫 ncml 时间维度
            ds = self._open(force_refresh=force_refresh)
            times = ds[self.config["time_dim"]].values
            return sorted({str(t)[:10] for t in times})
        else:
            # per_day 模式: 用配置里的日期范围生成
            # (实际文件可能没全, 但 list 用途主要是给前端日期选择器,
            # 缺失日期由 _open_day 打开时报错处理)
            return _generate_date_range(
                self.config["date_range_start"],
                self.config["date_range_end"],
            )
    
    # ------------------------------------------------------------
    # 公共方法: 取一整天的 24 帧
    # ------------------------------------------------------------
    def get_day(self, date: str) -> list[FrameData]:
        """取某一天的全部 24 小时数据。"""
        if self.access_mode == "aggregated":
            return self._get_day_aggregated(date)
        else:
            return self._get_day_per_day(date)
    
    # -- aggregated 实现 --
    def _get_day_aggregated(self, date: str) -> list[FrameData]:
        ds = self._open()
        time_dim = self.config["time_dim"]
        var_map = self.config["var_map"]
        
        all_times = ds[time_dim].values
        day_mask = np.array([str(t).startswith(date) for t in all_times])
        day_indices = np.where(day_mask)[0]
        
        if len(day_indices) == 0:
            raise ValueError(f"No data found for date {date}")
        if len(day_indices) != 24:
            logger.warning(
                f"Expected 24 hours on {date}, got {len(day_indices)}."
            )
        
        start_idx = int(day_indices[0])
        end_idx = int(day_indices[-1]) + 1
        expected = np.arange(start_idx, end_idx)
        if not np.array_equal(day_indices, expected):
            logger.warning(f"Day {date} has non-contiguous indices")
            time_selector = day_indices.tolist()
        else:
            time_selector = slice(start_idx, end_idx)
        
        logger.info(
            f"Fetching {len(day_indices)} frames for {date} "
            f"(indices {start_idx}..{end_idx - 1})..."
        )
        t0 = time.time()
        
        # 用 var_map 取真实变量名 (新结构: scalars 字典 + u/v)
        real_names = list(var_map["scalars"].values()) + [var_map["u"], var_map["v"]]
        day_data = ds[real_names].isel({time_dim: time_selector}).load()
        
        elapsed = time.time() - t0
        n_frames = len(day_indices)
        logger.info(
            f"  Day loaded in {elapsed:.1f}s ({elapsed/n_frames:.2f}s/frame)"
        )
        
        return self._build_frames(day_data, day_indices, time_dim, var_map)
    
    # -- per_day 实现 --
    def _get_day_per_day(self, date: str) -> list[FrameData]:
        ds = self._open_day(date)
        time_dim = self.config["time_dim"]
        var_map = self.config["var_map"]
        
        try:
            n_times = ds.sizes[time_dim]
            
            # WRF 数据是 25 个时间点 (00:00-24:00 含两端), 取前 max_frames 个.
            # max_frames 默认 24, 丢弃重复的 24:00 (= 次日 00:00).
            max_frames = self.config.get("max_frames", n_times)
            keep_frames = min(n_times, max_frames)
            if n_times != keep_frames:
                logger.info(
                    f"  Source has {n_times} time steps, keeping first {keep_frames} "
                    f"(per max_frames={max_frames})"
                )
            
            t0 = time.time()
            real_names = list(var_map["scalars"].values()) + [var_map["u"], var_map["v"]]
            # 只 load 前 keep_frames 个时间步, 省带宽
            day_data = ds[real_names].isel({time_dim: slice(0, keep_frames)}).load()
            elapsed = time.time() - t0
            logger.info(
                f"  Day loaded in {elapsed:.1f}s ({elapsed/keep_frames:.2f}s/frame)"
            )
            
            # per_day 模式下 index 是 0..(keep_frames-1) (相对于本文件)
            indices = list(range(keep_frames))
            return self._build_frames(day_data, indices, time_dim, var_map)
        finally:
            ds.close()
    
    # -- 公共: 把 xarray 数据包装成 FrameData 列表 --
    def _build_frames(self, day_data, indices, time_dim, var_map) -> list[FrameData]:
        """把 xarray Dataset 的多个时间步包装成 FrameData 列表.
        
        var_map 结构 (新):
            {
              "scalars": {"temp": "temp_sur", "salt": "salt_sur", ...},
              "u": "u_sur_eastward",
              "v": "v_sur_northward",
            }
        其中 scalars 是 {规范名: 数据集真实变量名} 的映射, 可任意数量.
        
        WRF 注意事项:
        - WRF 文件有多个 time 坐标 (time / wind_time / tair_time / ...),
          值都相同. 我们用主 time_dim 取时间戳.
        - WRF 变量可能挂在不同 time 坐标上, 但 .values[i] 按位置索引
          仍然能正确取到第 i 个时间步 (因为所有 time 坐标长度一致、对齐).
        """
        scalar_map = var_map["scalars"]   # {canonical_name: real_name}
        u_real = var_map["u"]
        v_real = var_map["v"]
        
        # 取时间戳数组: 优先用主 time_dim, 找不到就退而求其次
        if time_dim in day_data.coords or time_dim in day_data.variables:
            time_values = day_data[time_dim].values
        else:
            # 兜底: WRF 选了变量子集后主 time 坐标可能不在,
            # 找任意一个名字含 'time' 的坐标
            time_coord_name = None
            for cand in day_data.coords:
                if "time" in str(cand).lower():
                    time_coord_name = cand
                    break
            if time_coord_name is None:
                raise RuntimeError(
                    f"Cannot find time coordinate in dataset. "
                    f"Available coords: {list(day_data.coords)}"
                )
            logger.info(f"  Note: using '{time_coord_name}' as time coordinate")
            time_values = day_data[time_coord_name].values
        
        frames = []
        for i, idx in enumerate(indices):
            time_value = time_values[i]
            timestamp = np_datetime_to_py(time_value)
            
            # 动态构建标量字典: 遍历 scalar_map 把每个变量取出来
            scalars = {
                canonical: _sanitize(day_data[real].values[i])
                for canonical, real in scalar_map.items()
            }
            
            frames.append(FrameData(
                time=timestamp,
                time_index=int(idx),
                scalars=scalars,
                u=_sanitize(day_data[u_real].values[i]),
                v=_sanitize(day_data[v_real].values[i]),
            ))
        return frames
    
    # ------------------------------------------------------------
    # 公共方法: 取某天某小时的单帧
    # ------------------------------------------------------------
    def get_frame(self, date: str, hour: int) -> FrameData:
        """取某一天某一小时的单帧。"""
        if not (0 <= hour <= 23):
            raise ValueError(f"hour must be 0-23, got {hour}")
        # 复用 get_day, 取第 hour 个
        # (per_day 模式下 frame 索引就是 hour, aggregated 也是 0-23)
        frames = self.get_day(date)
        if hour >= len(frames):
            raise ValueError(f"Hour {hour} not available on {date}")
        return frames[hour]
    
    # ------------------------------------------------------------
    # 公共方法: 按索引取 (aggregated only, 给上层 prep 用)
    # ------------------------------------------------------------
    def get_frame_by_index(self, time_index: int) -> FrameData:
        """按时间索引直接取 (仅 aggregated 模式)."""
        if self.access_mode != "aggregated":
            raise RuntimeError(
                f"get_frame_by_index() not supported in per_day mode. "
                f"Use get_frame(date, hour) instead."
            )
        
        ds = self._open()
        time_dim = self.config["time_dim"]
        var_map = self.config["var_map"]
        
        t0 = time.time()
        snapshot = ds.isel({time_dim: time_index})
        real_names = list(var_map["scalars"].values()) + [var_map["u"], var_map["v"]]
        snapshot = snapshot[real_names].compute()
        elapsed = time.time() - t0
        
        time_value = snapshot[time_dim].values
        timestamp = np_datetime_to_py(time_value)
        
        # 动态构建标量字典
        scalars = {
            canonical: _sanitize(snapshot[real].values)
            for canonical, real in var_map["scalars"].items()
        }
        
        return FrameData(
            time=timestamp,
            time_index=time_index,
            scalars=scalars,
            u=_sanitize(snapshot[var_map["u"]].values),
            v=_sanitize(snapshot[var_map["v"]].values),
        )
    
    # ------------------------------------------------------------
    # 公共方法: 取全局统计 (仅 aggregated 模式)
    # ------------------------------------------------------------
    def get_global_stats(self, variable: str, sample_step: int = 24) -> dict:
        """扫描所有时间点, 算某个变量的全局 min/max/分位数."""
        if self.access_mode != "aggregated":
            raise RuntimeError(
                "get_global_stats() only supported in aggregated mode"
            )
        
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
        logger.info(f"  Stats computed in {elapsed:.1f}s")
        
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
    # 析构
    # ------------------------------------------------------------
    def close(self):
        if self._dataset is not None:
            self._dataset.close()
            self._dataset = None
            logger.info(f"Closed dataset: {self.source_name}")
    
    def __enter__(self):
        if self.access_mode == "aggregated":
            self._open()
        return self
    
    def __exit__(self, *args):
        self.close()


# ============================================================
# 独立测试入口
# ============================================================
if __name__ == "__main__":
    """
    用法:
        python data_loader.py              # 测试 perth (ROMS)
        python data_loader.py cwa          # 测试 cwa (ROMS)
        python data_loader.py wrf_d01      # 测试 wrf_d01 (WRF, WA 范围)
        python data_loader.py wrf_d02      # 测试 wrf_d02 (WRF, Perth 范围)
    """
    import sys
    source = sys.argv[1] if len(sys.argv) > 1 else "perth"
    
    print("=" * 60)
    print(f"Testing ROMSDataSource ({source})")
    print(f"  access_mode = {DATA_SOURCES[source].get('access_mode', 'aggregated')}")
    print(f"  kind        = {DATA_SOURCES[source].get('kind', '?')}")
    print("=" * 60)
    
    with ROMSDataSource(source) as src:
        # 测试 1: 列出可用日期
        print("\n[Test 1] List available dates")
        dates = src.list_available_dates()
        print(f"  Total available days: {len(dates)}")
        print(f"  First 3: {dates[:3]}")
        print(f"  Last 3:  {dates[-3:]}")
        
        # 测试 2: 取整天 (per_day 模式下直接用 get_day)
        # 选一个中间日期, 增加成功率
        # aggregated 模式取中间日期; per_day 模式 (WRF) 取一个肯定存在的近期日期
        test_date = dates[len(dates) // 2] if src.access_mode == "aggregated" else "2026-05-21"
        print(f"\n[Test 2] Get full day ({test_date})")
        day_frames = src.get_day(test_date)
        print(f"  Got {len(day_frames)} frames")
        print(f"  First frame: {day_frames[0].time.isoformat()}")
        print(f"  Last frame:  {day_frames[-1].time.isoformat()}")
        
        # 测试 3: 检查中间一帧的数据范围
        print(f"\n[Test 3] Mid-day frame stats (hour 13)")
        if len(day_frames) > 13:
            f = day_frames[13]
            print(f"  Shape: {f.shape}")
            print(f"  Variables: {f.variables}")
            # 遍历所有标量变量 (适配任意变量集: ROMS 3 个, WRF 5 个)
            for var_name in f.variables:
                arr = f.scalars[var_name]
                vmin, vmax = np.nanmin(arr), np.nanmax(arr)
                print(f"  {var_name:8s} range: {vmin:.3f} ~ {vmax:.3f}")
            print(f"  {'u':8s} range: {np.nanmin(f.u):.3f} ~ {np.nanmax(f.u):.3f}")
            print(f"  {'v':8s} range: {np.nanmin(f.v):.3f} ~ {np.nanmax(f.v):.3f}")
    
    print("\n" + "=" * 60)
    print("All tests passed ✓")
    print("=" * 60)