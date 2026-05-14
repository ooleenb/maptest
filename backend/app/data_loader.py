#data_loader.py
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
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



DATA_SOURCES = {
    "perth": {
        "name": "Perth waters 500m ROMS",
        "kind": "ocean",
        "access_mode": "aggregated",
        "ncml_url": "http://boreas.mywire.org:8080/thredds/dodsC/perthqck/perth_qck_2026.ncml",
        "resolution_m": 500,
        "time_dim": "ocean_time",
        # ROMS surface 变量
        "var_map": {
            "temp": "temp_sur",
            "salt": "salt_sur",
            "zeta": "zeta",
            "u":    "u_sur_eastward",
            "v":    "v_sur_northward",
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
            "temp": "temp_sur",
            "salt": "salt_sur",
            "zeta": "zeta",
            "u":    "u_sur_eastward",
            "v":    "v_sur_northward",
        },
    },
    "wrf": {
        "name": "WRF d02 atmospheric model",
        "kind": "atmosphere",
        "access_mode": "per_day",
        # 单天文件 URL 模板, {ymd} 替换为 YYYYMMDD
        "day_url_pattern": "http://boreas.mywire.org:8080/thredds/dodsC/WRF2026/wrf_roms_d02_{ymd}.nc",
        # 数据集时间范围 (硬编码; per_day 模式没有 ncml 给我们 list,
        # 这是为了让 list_available_dates() 不需要扫描整个 catalog)
        # 实际可用日期可能更窄: 文件存在与否在打开时才知道
        "date_range_start": "2026-01-01",
        "date_range_end":   "2026-05-17",
        "resolution_m": 2000,  # WRF d02 大约 2km
        "time_dim": "time",     # WRF 用 'time', ROMS 用 'ocean_time'

        "var_map": {
            "temp": "Tair",
            "salt": "Pair",
            "zeta": "Qair",
            "u":    "Uwind",
            "v":    "Vwind",
        },
    },
}



def np_datetime_to_py(np_time: np.datetime64) -> datetime:
    """
    把 numpy datetime64 (纳秒精度) 转成 python datetime (微秒精度,UTC)。
    """
    py_dt = np_time.astype('datetime64[s]').astype(datetime)
    return py_dt.replace(tzinfo=timezone.utc)



def _sanitize(arr: np.ndarray, threshold: float = 1e30) -> np.ndarray:
    """把数组里的"哨兵值" (例如 1e37) 替换成 NaN。"""
    arr = arr.astype(np.float32, copy=False)
    invalid = np.abs(arr) > threshold
    if np.any(invalid):
        arr = np.where(invalid, np.nan, arr).astype(np.float32)
    return arr



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
    """单个时间点的所有变量。"""
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
        
        # 用 var_map 取真实变量名
        real_names = [var_map["temp"], var_map["salt"], var_map["zeta"],
                      var_map["u"], var_map["v"]]
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
            if n_times != 24:
                logger.warning(f"Expected 24 hours, got {n_times}")
            
            t0 = time.time()
            real_names = [var_map["temp"], var_map["salt"], var_map["zeta"],
                          var_map["u"], var_map["v"]]
            day_data = ds[real_names].load()
            elapsed = time.time() - t0
            logger.info(
                f"  Day loaded in {elapsed:.1f}s ({elapsed/n_times:.2f}s/frame)"
            )
            
            # per_day 模式下 index 是 0..23 (相对于本文件)
            indices = list(range(n_times))
            return self._build_frames(day_data, indices, time_dim, var_map)
        finally:
            ds.close()
    
    # -- 公共: 把 xarray 数据包装成 FrameData 列表 --
    def _build_frames(self, day_data, indices, time_dim, var_map) -> list[FrameData]:
        frames = []
        for i, idx in enumerate(indices):
            time_value = day_data[time_dim].values[i]
            timestamp = np_datetime_to_py(time_value)
            
            frames.append(FrameData(
                time=timestamp,
                time_index=int(idx),
                temp=_sanitize(day_data[var_map["temp"]].values[i]),
                salt=_sanitize(day_data[var_map["salt"]].values[i]),
                zeta=_sanitize(day_data[var_map["zeta"]].values[i]),
                u=_sanitize(day_data[var_map["u"]].values[i]),
                v=_sanitize(day_data[var_map["v"]].values[i]),
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
        real_names = [var_map["temp"], var_map["salt"], var_map["zeta"],
                      var_map["u"], var_map["v"]]
        snapshot = snapshot[real_names].compute()
        elapsed = time.time() - t0
        
        time_value = snapshot[time_dim].values
        timestamp = np_datetime_to_py(time_value)
        
        return FrameData(
            time=timestamp,
            time_index=time_index,
            temp=_sanitize(snapshot[var_map["temp"]].values),
            salt=_sanitize(snapshot[var_map["salt"]].values),
            zeta=_sanitize(snapshot[var_map["zeta"]].values),
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
        python data_loader.py              # 测试 perth
        python data_loader.py cwa          # 测试 cwa
        python data_loader.py wrf          # 测试 wrf
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
        test_date = dates[len(dates) // 2] if src.access_mode == "aggregated" else "2026-05-16"
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
            print(f"  temp range: {np.nanmin(f.temp):.2f} ~ {np.nanmax(f.temp):.2f}")
            print(f"  salt range: {np.nanmin(f.salt):.2f} ~ {np.nanmax(f.salt):.2f}")
            print(f"  zeta range: {np.nanmin(f.zeta):.3f} ~ {np.nanmax(f.zeta):.3f}")
            print(f"  u range:    {np.nanmin(f.u):.3f} ~ {np.nanmax(f.u):.3f}")
            print(f"  v range:    {np.nanmin(f.v):.3f} ~ {np.nanmax(f.v):.3f}")
    
    print("\n" + "=" * 60)
    print("All tests passed ✓")
    print("=" * 60)