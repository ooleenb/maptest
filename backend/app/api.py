"""
api.py
======

FastAPI 服务层。

核心职责:
- 把 backend/data/frames/ 下的预生成数据通过 HTTP 暴露给前端
- 当请求的数据不存在时,自动触发 prep_day 实时生成 (同步阻塞)
- 提供数据源元信息、日期列表等查询接口
- 提供管理/健康检查端点

启动方式 (开发):
    cd backend/app
    uvicorn api:app --reload --host 0.0.0.0 --port 8000

启动方式 (生产):
    uvicorn api:app --host 0.0.0.0 --port 8000 --workers 1
    
    注意: workers=1 是因为我们用了内存 cache 和长期 OPeNDAP 句柄,
    多 worker 会重复持有资源。生产用 nginx + uvicorn 单 worker 就够了。

依赖:
    pip install fastapi uvicorn[standard]
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

# 导入我们前几步写好的模块
from data_loader import ROMSDataSource, DATA_SOURCES
from grid_meta import get_grid_meta
from prep_day import prepare_day, _default_output_dir


# ============================================================
# 配置
# ============================================================
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(handler)


# 单次预处理的最长允许时间(秒)
# 实测一天 6 秒,这里给 60 秒 buffer 应对网络抖动
PREP_TIMEOUT_SECONDS = 60

# 数据根目录
DATA_ROOT = _default_output_dir()


# ============================================================
# 应用生命周期: 启动时打开 OPeNDAP 句柄, 关闭时释放
# ============================================================
# 全局缓存的数据源实例
# {source_name: ROMSDataSource} - 每个数据源一个长期实例
_data_sources: dict[str, ROMSDataSource] = {}

# 防止同一日期被并发预处理的锁
# {(source, date): asyncio.Lock} - 同一 key 只允许一个 prep 任务在跑
_prep_locks: dict[tuple[str, str], asyncio.Lock] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan: 启动时预加载,关闭时清理。
    
    这是 FastAPI 推荐的方式(替代了过时的 on_startup/on_shutdown 装饰器)。
    """
    # ----------- 启动 -----------
    logger.info("=" * 60)
    logger.info("Starting Ocean Viz API")
    logger.info("=" * 60)
    
    # 预先打开所有数据源的 OPeNDAP 句柄
    # (这样首次请求时不需要再等 1.4 秒)
    for src_name in DATA_SOURCES.keys():
        try:
            logger.info(f"Pre-opening data source: {src_name}")
            src = ROMSDataSource(src_name, lazy_open=False)
            _data_sources[src_name] = src
        except Exception as e:
            logger.error(f"Failed to open {src_name}: {e}")
            # 不抛出,允许应用启动 - 后续请求时会再次尝试
    
    # 预热网格元数据缓存
    for src_name in DATA_SOURCES.keys():
        try:
            logger.info(f"Pre-loading grid for: {src_name}")
            get_grid_meta(src_name)
        except Exception as e:
            logger.error(f"Failed to load grid for {src_name}: {e}")
    
    logger.info(f"Data root: {DATA_ROOT}")
    logger.info("Ready to serve requests")
    logger.info("=" * 60)
    
    yield  # 应用运行期间
    
    # ----------- 关闭 -----------
    logger.info("Shutting down...")
    for src_name, src in _data_sources.items():
        src.close()
    _data_sources.clear()


# ============================================================
# 创建 FastAPI 应用
# ============================================================
app = FastAPI(
    title="Ocean Visualization API",
    description="ROMS Perth ocean model data API for web visualization",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: 允许前端开发服务器访问
# 部署时把 allow_origins 改成具体域名 (不要在生产用 ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite 默认端口
        "http://localhost:5174",   # Vite 备用端口
        "http://127.0.0.1:5173",
        # 部署时加你的生产域名
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# gzip 压缩 (大于 1KB 的响应自动压缩)
app.add_middleware(GZipMiddleware, minimum_size=1024)


# ============================================================
# 工具函数
# ============================================================
def _validate_source(source: str) -> None:
    """校验数据源是否合法,不合法时抛出 404"""
    if source not in DATA_SOURCES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown data source: {source!r}. "
                   f"Available: {list(DATA_SOURCES.keys())}"
        )


def _validate_date(date: str) -> None:
    """校验日期格式 YYYY-MM-DD"""
    import re
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format: {date!r}. Expected YYYY-MM-DD"
        )


def _day_dir(source: str, date: str) -> Path:
    """返回某日数据的目录路径"""
    return DATA_ROOT / source / date


async def _ensure_day_prepared(source: str, date: str) -> Path:
    """
    确保某日的数据已经预处理好。如果不存在,触发同步预处理。
    
    防并发: 用 asyncio.Lock 保证同一 (source, date) 不会被并发生成。
    
    超时保护: 如果预处理超过 PREP_TIMEOUT_SECONDS 秒,抛 504。
    """
    day_dir = _day_dir(source, date)
    meta_path = day_dir / "meta.json"
    
    # 快速路径: 已存在
    if meta_path.exists():
        return day_dir
    
    # 慢速路径: 需要预处理
    lock_key = (source, date)
    if lock_key not in _prep_locks:
        _prep_locks[lock_key] = asyncio.Lock()
    
    async with _prep_locks[lock_key]:
        # 双重检查 (在等锁期间可能已经被别的请求生成了)
        if meta_path.exists():
            return day_dir
        
        logger.info(f"On-demand prep: {source}/{date}")
        t0 = time.time()
        
        # 复用启动时已经打开的 OPeNDAP 句柄(避免重新打开浪费 0.5-1.5s)
        src_handle = _data_sources.get(source)
        
        try:
            # prepare_day 是同步 CPU/IO 函数,扔到线程池里跑
            # 这样不会阻塞 asyncio 事件循环 (其他请求可以并发响应)
            await asyncio.wait_for(
                asyncio.to_thread(
                    prepare_day,
                    date=date,
                    source_name=source,
                    overwrite=False,
                    data_source=src_handle,  # ⭐ 复用句柄
                ),
                timeout=PREP_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=504,
                detail=f"Data preparation timed out after "
                       f"{PREP_TIMEOUT_SECONDS}s for {source}/{date}"
            )
        except ValueError as e:
            # data_loader/prep_day 抛 ValueError 表示"日期不在数据集里"
            raise HTTPException(
                status_code=404,
                detail=f"Date not available in source data: {e}"
            )
        except Exception as e:
            logger.exception(f"Prep failed for {source}/{date}")
            raise HTTPException(
                status_code=500,
                detail=f"Data preparation failed: {e}"
            )
        
        elapsed = time.time() - t0
        logger.info(f"On-demand prep done: {source}/{date} in {elapsed:.1f}s")
        
        return day_dir


# ============================================================
# 端点: 数据源列表
# ============================================================
@app.get("/api/sources")
async def list_sources():
    """列出所有可用的数据源。"""
    return {
        "sources": [
            {
                "name": name,
                "display_name": config["name"],
                "resolution_m": config["resolution_m"],
            }
            for name, config in DATA_SOURCES.items()
        ]
    }


@app.get("/api/sources/{source}")
async def get_source_info(source: str):
    """返回某数据源的基本信息(显示名、分辨率、时间范围等)。"""
    _validate_source(source)
    config = DATA_SOURCES[source]
    
    # 取时间范围(从已经打开的句柄,不会触发网络)
    src_handle = _data_sources.get(source)
    time_range = None
    n_timesteps = None
    if src_handle:
        try:
            ds = src_handle._open()
            time_dim = config["time_dim"]
            times = ds[time_dim].values
            time_range = {
                "start": str(times[0])[:19],  # 去掉纳秒
                "end": str(times[-1])[:19],
            }
            n_timesteps = int(len(times))
        except Exception as e:
            logger.warning(f"Could not get time range for {source}: {e}")
    
    return {
        "name": source,
        "display_name": config["name"],
        "resolution_m": config["resolution_m"],
        "ncml_url": config["ncml_url"],
        "time_range": time_range,
        "n_timesteps": n_timesteps,
    }


# ============================================================
# 端点: 网格元数据
# ============================================================
@app.get("/api/sources/{source}/grid")
async def get_grid_json(source: str):
    """
    返回某数据源的网格 JSON (polygons + bounds + 推荐视图)。
    
    这个 JSON 由 grid_meta.py 在初次启动时导出。
    如果不存在,这里会同步生成。
    """
    _validate_source(source)
    
    grid_json_path = DATA_ROOT / source / "grid.json"
    
    if not grid_json_path.exists():
        logger.info(f"Generating grid.json for {source}")
        from grid_meta import export_grid_to_json
        meta = get_grid_meta(source)
        export_grid_to_json(meta, grid_json_path)
    
    # 用 FileResponse, 自动加 Content-Type、Last-Modified、ETag
    return FileResponse(
        grid_json_path,
        media_type="application/json",
        headers={
            # 网格几个月都不变, 长期缓存
            "Cache-Control": "public, max-age=86400",  # 1 天
        }
    )


# ============================================================
# 端点: 可用日期列表
# ============================================================
@app.get("/api/sources/{source}/dates")
async def list_dates(
    source: str,
    range: str = Query("remote", pattern="^(remote|available|both)$"),
    refresh: bool = Query(True, description="强制刷新 OPeNDAP 连接以拿到最新日期 (默认 True)"),
):
    """
    列出可用日期。
    
    参数 `range`:
    - "remote":    OPeNDAP 数据集里所有的日期 (默认)
    - "available": 已经在本地预生成的日期
    - "both":      返回两个列表
    
    参数 `refresh`: 是否强制重连 OPeNDAP 拿最新数据 (默认 True).
    设为 False 可以避免每次列日期都触发 OPeNDAP handshake (~1-2s).
    """
    _validate_source(source)
    
    result = {}
    
    if range in ("remote", "both"):
        src_handle = _data_sources.get(source)
        if src_handle:
            try:
                result["remote"] = src_handle.list_available_dates(force_refresh=refresh)
            except Exception as e:
                logger.error(f"Failed to list remote dates: {e}")
                result["remote"] = []
        else:
            result["remote"] = []
    
    if range in ("available", "both"):
        source_dir = DATA_ROOT / source
        if source_dir.exists():
            # 列出所有形如 YYYY-MM-DD 的子目录
            import re
            date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
            available = sorted([
                d.name for d in source_dir.iterdir()
                if d.is_dir() and date_pattern.match(d.name)
                and (d / "meta.json").exists()
            ])
            result["available"] = available
        else:
            result["available"] = []
    
    return result


# ============================================================
# 端点: 某日的 meta.json
# ============================================================
@app.get("/api/sources/{source}/days/{date}/meta")
async def get_day_meta(source: str, date: str):
    """
    返回某日的 meta.json。如果不存在,触发同步预处理。
    """
    _validate_source(source)
    _validate_date(date)
    
    day_dir = await _ensure_day_prepared(source, date)
    meta_path = day_dir / "meta.json"
    
    return FileResponse(
        meta_path,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=3600"}  # 1 小时
    )


# ============================================================
# 端点: 标量场二进制
# ============================================================
@app.get("/api/sources/{source}/days/{date}/scalar/{var}")
async def get_scalar_data(source: str, date: str, var: str):
    """
    返回某日某变量 (temp/salt/zeta) 的 Float32 二进制数据。
    
    布局: 24 帧 × 259 × 129 个 float32, little-endian
    """
    _validate_source(source)
    _validate_date(date)
    
    if var not in ("temp", "salt", "zeta"):
        raise HTTPException(
            status_code=400,
            detail=f"Unknown variable: {var!r}. Allowed: temp, salt, zeta"
        )
    
    day_dir = await _ensure_day_prepared(source, date)
    bin_path = day_dir / f"{var}.bin"
    
    if not bin_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Data file missing after prep: {bin_path.name}"
        )
    
    return FileResponse(
        bin_path,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "public, max-age=86400",  # 数据不变,长期缓存
            # 告诉前端用什么类型解析
            "X-Data-Dtype": "float32",
            "X-Data-Layout": "frame-major (n_frames, n_eta, n_xi)",
        }
    )


# ============================================================
# 端点: u/v PNG 单帧
# ============================================================
@app.get("/api/sources/{source}/days/{date}/uv/{hour}")
async def get_uv_png(source: str, date: str, hour: str):
    """
    返回某日某小时的 u/v PNG 编码图。
    
    参数 hour: 0-23 的整数,或 "00" - "23" 字符串(都接受)
    """
    _validate_source(source)
    _validate_date(date)
    
    # hour 校验
    try:
        h = int(hour)
        if not (0 <= h <= 23):
            raise ValueError
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid hour: {hour!r}. Expected 0-23"
        )
    
    day_dir = await _ensure_day_prepared(source, date)
    png_path = day_dir / f"uv_{h:02d}.png"
    
    if not png_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"PNG file missing after prep: {png_path.name}"
        )
    
    return FileResponse(
        png_path,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"}
    )


# ============================================================
# 端点: 管理 - 强制重新生成
# ============================================================
@app.post("/api/admin/prepare")
async def admin_prepare(
    source: str = Query(...),
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    overwrite: bool = Query(False),
):
    """
    管理端点: 强制(重新)生成某日的数据。
    
    生产环境应该加权限验证 (API key / token),
    现在 demo 阶段先开放。
    """
    _validate_source(source)
    
    logger.info(f"Admin prep requested: {source}/{date} overwrite={overwrite}")
    t0 = time.time()
    
    src_handle = _data_sources.get(source)  # 复用启动时的句柄
    
    try:
        await asyncio.wait_for(
            asyncio.to_thread(
                prepare_day,
                date=date,
                source_name=source,
                overwrite=overwrite,
                data_source=src_handle,
            ),
            timeout=PREP_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Preparation timed out")
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Admin prep failed")
        raise HTTPException(500, str(e))
    
    elapsed = time.time() - t0
    return {
        "status": "ok",
        "source": source,
        "date": date,
        "elapsed_seconds": round(elapsed, 2),
    }


# ============================================================
# 端点: 健康检查
# ============================================================
@app.get("/api/health")
async def health_check():
    """
    健康检查: 检查 OPeNDAP 句柄、数据目录、磁盘空间。
    """
    import shutil
    
    status = {"status": "ok", "checks": {}}
    
    # 检查数据目录
    status["checks"]["data_dir"] = {
        "path": str(DATA_ROOT),
        "exists": DATA_ROOT.exists(),
        "writable": DATA_ROOT.exists() and Path(DATA_ROOT).is_dir(),
    }
    
    # 检查磁盘空间
    try:
        total, used, free = shutil.disk_usage(DATA_ROOT.parent)
        status["checks"]["disk_space"] = {
            "free_gb": round(free / 1024**3, 2),
            "total_gb": round(total / 1024**3, 2),
            "used_percent": round(100 * used / total, 1),
        }
    except Exception as e:
        status["checks"]["disk_space"] = {"error": str(e)}
    
    # 检查每个数据源的 OPeNDAP 句柄
    status["checks"]["sources"] = {}
    for src_name, src in _data_sources.items():
        try:
            ds = src._open()
            status["checks"]["sources"][src_name] = {
                "opened": True,
                "n_timesteps": int(len(ds[DATA_SOURCES[src_name]["time_dim"]])),
            }
        except Exception as e:
            status["checks"]["sources"][src_name] = {
                "opened": False,
                "error": str(e),
            }
            status["status"] = "degraded"
    
    return status


# ============================================================
# 根路径: 简单的欢迎页
# ============================================================
@app.get("/")
async def root():
    """根路径: 给个简单的导航。"""
    return {
        "name": "Ocean Visualization API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "sources": "/api/sources",
            "grid": "/api/sources/{source}/grid",
            "dates": "/api/sources/{source}/dates",
            "day_meta": "/api/sources/{source}/days/{date}/meta",
            "scalar": "/api/sources/{source}/days/{date}/scalar/{var}",
            "uv": "/api/sources/{source}/days/{date}/uv/{hour}",
            "health": "/api/health",
        }
    }


# ============================================================
# 独立运行入口
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # 开发时自动重载
    )