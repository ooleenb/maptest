#prep_one_frame.py
import os
import json
import numpy as np
import xarray as xr
import xesmf as xe

# =========================================================
# 1) 配置参数
# =========================================================
URL = "http://boreas.mywire.org:8080/thredds/dodsC/perthqck/perth_qck_20260311.nc"

# 规则网格仅用于粒子场（u/v）
dlat = 0.001
dlon = 0.001

# 输出目录名称
OUT_DIR = "cwa_20260311"

# =========================================================
# 2) 打开数据集
# =========================================================
print("Opening dataset from OPeNDAP...")
ds = xr.open_dataset(URL)

lat2d = ds["lat_rho"]
lon2d = ds["lon_rho"]
time_values = ds["ocean_time"].values

print("Dataset opened.")
print("ocean_time count:", len(time_values))
print("time range:", str(time_values[0]), "->", str(time_values[-1]))

# =========================================================
# 3) 构造规则网格（只给粒子 u/v 用）
# =========================================================
lat_min = float(lat2d.min())
lat_max = float(lat2d.max())
lon_min = float(lon2d.min())
lon_max = float(lon2d.max())

print("\nSource grid bounds:")
print(f"  lat: {lat_min:.6f} to {lat_max:.6f}")
print(f"  lon: {lon_min:.6f} to {lon_max:.6f}")

target = xr.Dataset(
    {
        "lat": (["lat"], np.arange(lat_min, lat_max + dlat, dlat)),
        "lon": (["lon"], np.arange(lon_min, lon_max + dlon, dlon)),
    }
)

source = xr.Dataset(
    {
        "lat": (["y", "x"], lat2d.values),
        "lon": (["y", "x"], lon2d.values),
    }
)

print("\nTarget regular grid for particles:")
print("  lat size:", target["lat"].size)
print("  lon size:", target["lon"].size)

# =========================================================
# 4) 创建 regridder（仅 u/v 用）
# =========================================================
print("\nBuilding regridder for particle field...")
regridder = xe.Regridder(
    source,
    target,
    "bilinear",
    periodic=False,
    reuse_weights=False
)

# =========================================================
# 5) 创建输出目录，保存静态文件
# =========================================================
os.makedirs(OUT_DIR, exist_ok=True)

# 5.1 规则网格（粒子用）
lat_1d = target["lat"].values.astype(np.float32)
lon_1d = target["lon"].values.astype(np.float32)

np.save(os.path.join(OUT_DIR, "lat.npy"), lat_1d)
np.save(os.path.join(OUT_DIR, "lon.npy"), lon_1d)

# 5.2 原始 curvilinear 网格（温度层用）
lon_rho_np = lon2d.values.astype(np.float32)
lat_rho_np = lat2d.values.astype(np.float32)

np.save(os.path.join(OUT_DIR, "lon_rho.npy"), lon_rho_np)
np.save(os.path.join(OUT_DIR, "lat_rho.npy"), lat_rho_np)

# 可选：导出 mask_rho，前端做过滤更方便
if "mask_rho" in ds.variables:
    mask_rho_np = ds["mask_rho"].values.astype(np.float32)
else:
    mask_rho_np = np.ones_like(lon_rho_np, dtype=np.float32)

np.save(os.path.join(OUT_DIR, "mask_rho.npy"), mask_rho_np)

times_iso = [np.datetime_as_string(t, unit="s") for t in time_values]

meta = {
    "source_url": URL,
    "time_count": len(times_iso),
    "times": times_iso,
    "particle_grid": {
        "lat_size": int(lat_1d.shape[0]),
        "lon_size": int(lon_1d.shape[0]),
        "dlat": dlat,
        "dlon": dlon,
        "bounds": {
            "minLon": float(lon_1d.min()),
            "maxLon": float(lon_1d.max()),
            "minLat": float(lat_1d.min()),
            "maxLat": float(lat_1d.max()),
        },
    },
    "raw_grid": {
        "shape": [int(lon_rho_np.shape[0]), int(lon_rho_np.shape[1])],
        "bounds": {
            "minLon": float(np.nanmin(lon_rho_np)),
            "maxLon": float(np.nanmax(lon_rho_np)),
            "minLat": float(np.nanmin(lat_rho_np)),
            "maxLat": float(np.nanmax(lat_rho_np)),
        },
    },
}

with open(os.path.join(OUT_DIR, "meta.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)

print("\nSaved static files:")
print("  - lat.npy / lon.npy               (regular grid for particles)")
print("  - lat_rho.npy / lon_rho.npy       (raw ROMS grid for temperature layer)")
print("  - mask_rho.npy")
print("  - meta.json")

# =========================================================
# 6) 循环导出 24 个小时
# temp_raw_xx.npy: 原始网格温度（温度层）
# u_xx.npy / v_xx.npy: 规则网格流场（粒子）
# =========================================================
for time_index in range(len(time_values)):
    print(f"\nProcessing hour {time_index:02d} / {len(time_values)-1:02d} ...")

    t = ds.isel(ocean_time=time_index)

    temp_raw = t["temp_sur"].values.astype(np.float32)
    u = t["u_sur_eastward"]
    v = t["v_sur_northward"]

    u_rg = regridder(u).values.astype(np.float32)
    v_rg = regridder(v).values.astype(np.float32)

    temp_raw_path = os.path.join(OUT_DIR, f"temp_raw_{time_index:02d}.npy")
    u_path = os.path.join(OUT_DIR, f"u_{time_index:02d}.npy")
    v_path = os.path.join(OUT_DIR, f"v_{time_index:02d}.npy")

    np.save(temp_raw_path, temp_raw)
    np.save(u_path, u_rg)
    np.save(v_path, v_rg)

    temp_nan = int(np.isnan(temp_raw).sum())
    u_nan = int(np.isnan(u_rg).sum())
    v_nan = int(np.isnan(v_rg).sum())

    print(
        "  saved:",
        os.path.basename(temp_raw_path),
        os.path.basename(u_path),
        os.path.basename(v_path),
    )
    print("  temp_raw shape:", temp_raw.shape)
    print("  u/v shape     :", u_rg.shape)
    print("  NaN counts    :", temp_nan, u_nan, v_nan)

print("\nDone.")
print("Output folder:", OUT_DIR)