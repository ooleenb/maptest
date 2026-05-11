"""
read_perth_nc.py

Goal:
- Open teacher's NetCDF via THREDDS/OPeNDAP
- Inspect dataset (dims/vars)
- Pick a surface variable (default: temp_sur)
- Plot one timestep on lon/lat grid

Requirements:
  pip install xarray netCDF4 numpy matplotlib
"""

import sys
import numpy as np
import xarray as xr
import matplotlib.pyplot as plt


URL_DEFAULT = "http://boreas.mywire.org:8080/thredds/dodsC/perthqck/perth_qck_20260211.nc"

# You can change this order if you want.
CANDIDATE_VARS = [
    "temp_sur",
    "salt_sur",
    "zeta",
    "u_sur_eastward",
    "v_sur_northward",
    "ubar_eastward",
    "vbar_northward",
]


def pick_first_existing_var(ds: xr.Dataset, candidates):
    for v in candidates:
        if v in ds.data_vars:
            return v
    return None


def pick_lon_lat(ds: xr.Dataset):
    """
    Tries common coordinate names.
    Your dataset shows lon_rho/lat_rho, but we keep it robust.
    """
    lon_names = ["lon_rho", "lon", "longitude", "x"]
    lat_names = ["lat_rho", "lat", "latitude", "y"]

    lon = None
    lat = None

    for name in lon_names:
        if name in ds.variables:
            lon = ds[name]
            break
    for name in lat_names:
        if name in ds.variables:
            lat = ds[name]
            break

    return lon, lat


def pick_time(ds: xr.Dataset):
    time_names = ["ocean_time", "time", "Times"]
    for name in time_names:
        if name in ds.variables:
            return ds[name]
    return None


def main():
    url = URL_DEFAULT
    if len(sys.argv) >= 2 and sys.argv[1].strip():
        url = sys.argv[1].strip()

    print(f"\nOpening dataset:\n  {url}\n")
    try:
        ds = xr.open_dataset(url)  # works for OPeNDAP netCDF
    except Exception as e:
        print(" Failed to open dataset.")
        print("Error:", repr(e))
        print("\nTips:")
        print("- Check the URL in browser to confirm it's reachable.")
        print("- Make sure you installed: xarray, netCDF4")
        return

    print("✅ Opened successfully.\n")
    print("===== DATASET SUMMARY =====")
    print(ds)
    print("===========================\n")

    # Find lon/lat/time
    lon, lat = pick_lon_lat(ds)
    tcoord = pick_time(ds)

    if lon is None or lat is None:
        print("❌ Could not find lon/lat coordinates automatically.")
        print("Available variables:", list(ds.variables))
        print("Try editing pick_lon_lat() to match your coord names.")
        return

    print(f"Using lon variable: {lon.name}")
    print(f"Using lat variable: {lat.name}")

    if tcoord is not None:
        print(f"Using time variable: {tcoord.name}")
        # Print time range if possible
        try:
            # Sometimes ocean_time is seconds since 2000... we can show raw values.
            print("Time coordinate preview:", tcoord.values[:3], "...", tcoord.values[-3:])
        except Exception:
            pass
    else:
        print("⚠️ No obvious time coordinate found (will try first slice anyway).")

    # Pick a data variable to plot
    var_name = pick_first_existing_var(ds, CANDIDATE_VARS)
    if var_name is None:
        print("\n None of the candidate variables were found.")
        print("Candidates:", CANDIDATE_VARS)
        print("Available data variables:", list(ds.data_vars))
        print("\nPick one from above and put it in CANDIDATE_VARS.")
        return

    da = ds[var_name]
    print(f"\n Selected variable to plot: {var_name}")
    print(da)

    # Choose a time index
    time_dim = None
    for possible in ["ocean_time", "time", "valid_time"]:
        if possible in da.dims:
            time_dim = possible
            break

    if time_dim is not None:
        da2d = da.isel({time_dim: 0})
        title_time = None
        try:
            title_time = str(ds[time_dim].isel({time_dim: 0}).values)
        except Exception:
            title_time = f"{time_dim}=0"
    else:
        # No time dimension; try to squeeze to 2D
        da2d = da.squeeze()
        title_time = "no explicit time dim"

    # Make sure it's 2D for plotting
    if da2d.ndim != 2:
        print("\n The selected variable is not 2D after slicing.")
        print("Result dims:", da2d.dims, "ndim=", da2d.ndim)
        print("Try choosing a variable like temp_sur/salt_sur/zeta or adjust slicing.")
        return

    # Convert to numpy for plotting
    data = da2d.values

    # Plot
    plt.figure(figsize=(9, 9))
    plt.pcolormesh(lon.values, lat.values, data, shading="auto")
    plt.colorbar(label=f"{var_name} ({da.attrs.get('units', 'unknown units')})")
    plt.title(f"{var_name} at {title_time}")
    plt.xlabel("Longitude")
    plt.ylabel("Latitude")
    plt.tight_layout()
    plt.show()

    print("\n Done. You should see a map plot window.\n")


if __name__ == "__main__":
    main()
