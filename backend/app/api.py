# api.py

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


from data_loader import ROMSDataSource, DATA_SOURCES
from grid_meta import get_grid_meta
from prep_day import prepare_day, _default_output_dir



logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(handler)



PREP_TIMEOUT_SECONDS = 60

# 数据根目录
DATA_ROOT = _default_output_dir()



_data_sources: dict[str, ROMSDataSource] = {}


_prep_locks: dict[tuple[str, str], asyncio.Lock] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):

    
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
    
    
    for src_name in DATA_SOURCES.keys():
        try:
            logger.info(f"Pre-loading grid for: {src_name}")
            get_grid_meta(src_name)
        except Exception as e:
            logger.error(f"Failed to load grid for {src_name}: {e}")
    
    logger.info(f"Data root: {DATA_ROOT}")
    logger.info("Ready to serve requests")
    logger.info("=" * 60)
    
    yield  
    
    
    logger.info("Shutting down...")
    for src_name, src in _data_sources.items():
        src.close()
    _data_sources.clear()



# FastAPI 

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
        
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.add_middleware(GZipMiddleware, minimum_size=1024)



def _validate_source(source: str) -> None:
    
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
    
    return DATA_ROOT / source / date


async def _ensure_day_prepared(source: str, date: str) -> Path:
    
    day_dir = _day_dir(source, date)
    meta_path = day_dir / "meta.json"
    
    
    if meta_path.exists():
        return day_dir
    
    
    lock_key = (source, date)
    if lock_key not in _prep_locks:
        _prep_locks[lock_key] = asyncio.Lock()
    
    async with _prep_locks[lock_key]:
        
        if meta_path.exists():
            return day_dir
        
        logger.info(f"On-demand prep: {source}/{date}")
        t0 = time.time()
        
        
        src_handle = _data_sources.get(source)
        
        try:
            
            await asyncio.wait_for(
                asyncio.to_thread(
                    prepare_day,
                    date=date,
                    source_name=source,
                    overwrite=False,
                    data_source=src_handle,  
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
    
    _validate_source(source)
    config = DATA_SOURCES[source]
    
    
    src_handle = _data_sources.get(source)
    time_range = None
    n_timesteps = None
    if src_handle:
        try:
            ds = src_handle._open()
            time_dim = config["time_dim"]
            times = ds[time_dim].values
            time_range = {
                "start": str(times[0])[:19],  
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



@app.get("/api/sources/{source}/grid")
async def get_grid_json(source: str):
    
    _validate_source(source)
    
    grid_json_path = DATA_ROOT / source / "grid.json"
    
    if not grid_json_path.exists():
        logger.info(f"Generating grid.json for {source}")
        from grid_meta import export_grid_to_json
        meta = get_grid_meta(source)
        export_grid_to_json(meta, grid_json_path)
    
    
    return FileResponse(
        grid_json_path,
        media_type="application/json",
        headers={
            
            "Cache-Control": "public, max-age=86400",  # 1 day
        }
    )



@app.get("/api/sources/{source}/dates")
async def list_dates(
    source: str,
    range: str = Query("remote", pattern="^(remote|available|both)$"),
    refresh: bool = Query(True, description="强制刷新 OPeNDAP 连接以拿到最新日期 (默认 True)"),
):
    
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



@app.get("/api/sources/{source}/days/{date}/meta")
async def get_day_meta(source: str, date: str):
    
    _validate_source(source)
    _validate_date(date)
    
    day_dir = await _ensure_day_prepared(source, date)
    meta_path = day_dir / "meta.json"
    
    return FileResponse(
        meta_path,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=3600"}  # 1 hour
    )



@app.get("/api/sources/{source}/days/{date}/scalar/{var}")
async def get_scalar_data(source: str, date: str, var: str):
    
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
            "Cache-Control": "public, max-age=86400",  
            
            "X-Data-Dtype": "float32",
            "X-Data-Layout": "frame-major (n_frames, n_eta, n_xi)",
        }
    )



@app.get("/api/sources/{source}/days/{date}/uv/{hour}")
async def get_uv_png(source: str, date: str, hour: str):
    
    _validate_source(source)
    _validate_date(date)
    
    
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



@app.post("/api/admin/prepare")
async def admin_prepare(
    source: str = Query(...),
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    overwrite: bool = Query(False),
):
    
    _validate_source(source)
    
    logger.info(f"Admin prep requested: {source}/{date} overwrite={overwrite}")
    t0 = time.time()
    
    src_handle = _data_sources.get(source)  
    
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



@app.get("/api/health")
async def health_check():
    
    import shutil
    
    status = {"status": "ok", "checks": {}}
    
    
    status["checks"]["data_dir"] = {
        "path": str(DATA_ROOT),
        "exists": DATA_ROOT.exists(),
        "writable": DATA_ROOT.exists() and Path(DATA_ROOT).is_dir(),
    }
    
    
    try:
        total, used, free = shutil.disk_usage(DATA_ROOT.parent)
        status["checks"]["disk_space"] = {
            "free_gb": round(free / 1024**3, 2),
            "total_gb": round(total / 1024**3, 2),
            "used_percent": round(100 * used / total, 1),
        }
    except Exception as e:
        status["checks"]["disk_space"] = {"error": str(e)}
    
    
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



@app.get("/")
async def root():

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



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )