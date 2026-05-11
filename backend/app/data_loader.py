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
    
    src = ROMSDataSource("perth")     # 选择 perth 数据源
    frame = src.get_frame("2026-03-11", hour=13)
    print(frame.temp.shape)           # (259, 129)
    print(frame.u.shape)              # (259, 129)
    print(frame.time)                 # 2026-03-11T13:00:00 (UTC)

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
# 为什么用字典而不是硬编码:
# 未来要加 CWA / GBR / Sri Lanka 等数据源,只需要在这里加一行配置,
# 上层代码完全不用改。这是"决策 4"里说的"架构上支持任意域"的体现。
DATA_SOURCES = {
    "perth": {
        "name": "Perth waters 500m ROMS",
        # .ncml 聚合 URL —— 这是你新发现的连续 5 个月数据集
        "ncml_url": "http://boreas.mywire.org:8080/thredds/dodsC/perthqck/perth_qck_2026.ncml",
        # 网格元数据文件(只读一次,缓存到本地)
        "grid_url": "http://boreas.mywire.org:8080/thredds/dodsC/perthqck/perth_his_grid.nc",
        # 模型分辨率(米),用于汇报和日志显示
        "resolution_m": 500,
        # 时间维度的名字(ROMS 是 ocean_time, WRF 是 Time, 不同模型不一样)
        "time_dim": "ocean_time",
    },
    # 未来扩展示例(注释掉,等真正要做的时候再填 URL):
    # "cwa": {
    #     "name": "Coast of Western Australia ROMS",
    #     "ncml_url": "http://.../cwaqck/cwa_qck_2026.ncml",
    #     "grid_url": "http://.../cwaqck/cwa_his_grid.nc",
    #     "resolution_m": 2000,
    #     "time_dim": "ocean_time",
    # },
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
    
    正确做法是先用 numpy 把精度降到秒级,再转 python datetime。
    """
    # astype('datetime64[s]') 把纳秒精度降到秒精度
    # .astype(datetime) 转成 python datetime (此时无时区信息)
    py_dt = np_time.astype('datetime64[s]').astype(datetime)
    # 补上 UTC 时区 (ROMS ocean_time 默认是 UTC)
    return py_dt.replace(tzinfo=timezone.utc)


# ============================================================
# 数据帧的标准结构
# ============================================================
@dataclass
class FrameData:
    """
    单个时间点的所有变量,组织成一个统一的结构。
    
    用 @dataclass 而不是 dict,是为了让上层代码用属性访问 (frame.temp)
    而不是字符串 key (frame["temp"]),减少拼写错误,IDE 也能自动补全。
    
    所有 2D 数组的 shape 都是 (eta_rho, xi_rho),对 Perth 来说就是 (259, 129)。
    """
    # 时间信息
    time: datetime          # UTC 时间,带时区
    time_index: int         # 在原始数据集里的索引
    
    # 标量场(都是 2D 数组,float32)
    temp: np.ndarray        # 表层温度 (°C)
    salt: np.ndarray        # 表层盐度 (无单位)
    zeta: np.ndarray        # 海面高度 (m)
    
    # 矢量场(粒子可视化用)
    u: np.ndarray           # 东向流速 (m/s)
    v: np.ndarray           # 北向流速 (m/s)
    
    # 网格 shape 快速访问
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
        
        关键参数解释:
        - chunks={}: 启用 dask 懒加载,默认每个变量切成一块。
                     这样数据"虚拟存在",真正读取发生在 .values 或 .load() 时
        - decode_times=True: 把 ocean_time 自动解析成 datetime 对象
        """
        if self._dataset is not None:
            return self._dataset
        
        url = self.config["ncml_url"]
        logger.info(f"Opening dataset: {url}")
        
        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                t0 = time.time()
                ds = xr.open_dataset(
                    url,
                    chunks={},               # 启用 dask 懒加载
                    decode_times=True,       # ocean_time -> datetime64
                )
                elapsed = time.time() - t0
                
                # 取时间范围用于日志
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
        前端的日期选择器需要这个列表。
        """
        ds = self._open()
        times = ds[self.config["time_dim"]].values
        # 把 datetime64 转成日期字符串,然后用 set 去重
        date_strs = sorted({
            str(t)[:10]  # 取前 10 个字符,即 YYYY-MM-DD
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
        
        参数:
        -----
        date: 'YYYY-MM-DD' 格式
        hour: 0 到 23
        
        返回:
        -----
        FrameData 对象(numpy 数组已在内存里)
        """
        if not (0 <= hour <= 23):
            raise ValueError(f"hour must be 0-23, got {hour}")
        
        ds = self._open()
        time_dim = self.config["time_dim"]
        
        # 构造目标时间戳
        target_time = np.datetime64(f"{date}T{hour:02d}:00:00")
        
        # 在时间维度上找到对应索引
        # ROMS 输出的 ocean_time 通常是整点 (00:00, 01:00, ...),所以 == 匹配
        all_times = ds[time_dim].values
        matches = np.where(all_times == target_time)[0]
        
        if len(matches) == 0:
            # 找不到精确匹配,给出友好错误信息
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
    # 公共方法: 按时间索引直接取(批量预处理时用)
    # ------------------------------------------------------------
    def get_frame_by_index(self, time_index: int) -> FrameData:
        """
        直接通过整数索引取帧。比按日期/小时取快(省了查找步骤)。
        prep_day.py 批量预处理时会用这个。
        """
        ds = self._open()
        time_dim = self.config["time_dim"]
        
        # isel 是 xarray 的"按索引切片",这里相当于 ds[time_dim][time_index]
        t0 = time.time()
        snapshot = ds.isel({time_dim: time_index})
        
        # .compute() 会触发 dask 真正下载这一帧的数据
        # 关键: 一次性把需要的 5 个变量都拉下来,而不是一个一个拉
        # (避免 OPeNDAP 多次往返)
        needed_vars = ["temp_sur", "salt_sur", "u_sur_eastward",
                       "v_sur_northward", "zeta"]
        snapshot = snapshot[needed_vars].compute()
        elapsed = time.time() - t0
        
        # 提取时间戳
        time_value = snapshot[time_dim].values
        # numpy datetime64 -> python datetime (UTC)
        timestamp = np_datetime_to_py(time_value)
        
        logger.debug(
            f"  Fetched frame [{time_index}] {timestamp.isoformat()} "
            f"in {elapsed:.2f}s"
        )
        
        return FrameData(
            time=timestamp,
            time_index=time_index,
            temp=snapshot["temp_sur"].values.astype(np.float32),
            salt=snapshot["salt_sur"].values.astype(np.float32),
            zeta=snapshot["zeta"].values.astype(np.float32),
            u=snapshot["u_sur_eastward"].values.astype(np.float32),
            v=snapshot["v_sur_northward"].values.astype(np.float32),
        )
    
    # ------------------------------------------------------------
    # 公共方法: 取一整天的 24 帧(预处理主用法)
    # ------------------------------------------------------------
    def get_day(self, date: str) -> list[FrameData]:
        """
        取某一天的全部 24 小时数据。
        
        实现细节(性能关键):
        ------------------
        这里有个非常隐蔽的性能陷阱: 同样是"取 24 帧",用不同的索引方式
        速度能差几十上百倍。
        
        ❌ 慢的写法: isel(time=[i, i+1, ..., i+23])  # list of indices
           - OPeNDAP 把它解读成 24 个独立"取 1 帧"请求
           - 每个请求都有 TCP/SSL 往返开销
           - dask 还可能把每个变量×每个索引切成独立 chunk
           - 实测: 419 秒 / 24 帧 (~17 秒/帧)
        
        ✅ 快的写法: isel(time=slice(i, i+24))  # contiguous slice
           - OPeNDAP 知道这是一次"连续读",合并成单次传输
           - dask 合并成单个 chunk
           - 实测预期: 5-15 秒 / 24 帧
        
        24 小时的数据在原始数据集里永远是 24 个连续索引,所以可以放心用 slice。
        """
        ds = self._open()
        time_dim = self.config["time_dim"]
        
        # 找到当天数据的起始和结束索引(取最小、最大即可,因为 ROMS 时间是单调递增的)
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
        
        # ⭐ 关键: 用 slice 而不是 list of indices
        start_idx = int(day_indices[0])
        end_idx = int(day_indices[-1]) + 1  # slice 是半开区间
        
        # 验证索引确实连续 (理论上 ROMS qck 永远连续,但 paranoid check 一下)
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
        
        # 一次性 isel 连续切片 + load
        needed_vars = ["temp_sur", "salt_sur", "u_sur_eastward",
                       "v_sur_northward", "zeta"]
        day_data = ds[needed_vars].isel({time_dim: time_selector}).load()
        
        elapsed = time.time() - t0
        n_frames = len(day_indices)
        logger.info(
            f"  Day loaded in {elapsed:.1f}s "
            f"({elapsed / n_frames:.2f}s/frame)"
        )
        
        # 拆成 FrameData 列表
        frames = []
        for i, idx in enumerate(day_indices):
            time_value = day_data[time_dim].values[i]
            timestamp = np_datetime_to_py(time_value)
            
            frames.append(FrameData(
                time=timestamp,
                time_index=int(idx),
                temp=day_data["temp_sur"].values[i].astype(np.float32),
                salt=day_data["salt_sur"].values[i].astype(np.float32),
                zeta=day_data["zeta"].values[i].astype(np.float32),
                u=day_data["u_sur_eastward"].values[i].astype(np.float32),
                v=day_data["v_sur_northward"].values[i].astype(np.float32),
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
        
        用途: 固定 colormap 范围。比如温度永远用 14-26°C 染色,
        用户跨日比较时颜色含义一致。
        
        参数:
        -----
        variable: 'temp_sur' / 'salt_sur' / 'zeta'
        sample_step: 每隔多少帧采样一次(默认 24 = 每天一帧,够用了)
                     全扫描太慢,采样估计就行
        
        性能优化:
        --------
        和 get_day 同理: 用 stride slice (slice(0, n, step)) 代替
        list of indices, 让 OPeNDAP/dask 把它当成单次连续读取。
        """
        ds = self._open()
        time_dim = self.config["time_dim"]
        n_times = len(ds[time_dim])
        
        # ⭐ 用 stride slice 而不是 list,大幅减少网络往返
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
        python data_loader.py
    """
    print("=" * 60)
    print("Testing ROMSDataSource (perth)")
    print("=" * 60)
    
    with ROMSDataSource("perth") as src:
        # 测试 1: 列出可用日期
        print("\n[Test 1] List available dates")
        dates = src.list_available_dates()
        print(f"  Total available days: {len(dates)}")
        print(f"  First 3: {dates[:3]}")
        print(f"  Last 3:  {dates[-3:]}")
        
        # 测试 2: 取单帧
        # 用一个肯定在数据集里的日期(取数据集中间那一天)
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
        
        # 测试 4: 全局统计(只采样,避免太慢)
        print("\n[Test 4] Global stats for temperature")
        stats = src.get_global_stats("temp_sur", sample_step=72)  # 3天1样本
        print(f"  Global min/max: {stats['min']:.2f} / {stats['max']:.2f} °C")
        print(f"  1%/99% range:   {stats['p01']:.2f} / {stats['p99']:.2f} °C")
    
    print("\n" + "=" * 60)
    print("All tests passed ✓")
    print("=" * 60)