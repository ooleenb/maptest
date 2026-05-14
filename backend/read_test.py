import xarray as xr
ds = xr.open_dataset("http://boreas.mywire.org:8080/thredds/dodsC/perthqck/perth_qck_202601.ncml")
print(ds)
print("---")
for var in ds.data_vars:
    print(f"{var}: shape={ds[var].shape}, dims={ds[var].dims}, units={ds[var].attrs.get('units', '?')}")


# import xarray as xr
# ds = xr.open_dataset("http://boreas.mywire.org:8080/thredds/dodsC/cwaqck/cwa_qck_20260516.nc")
# print(f"lon: {ds.lon_rho.min().values:.3f} ~ {ds.lon_rho.max().values:.3f}")
# print(f"lat: {ds.lat_rho.min().values:.3f} ~ {ds.lat_rho.max().values:.3f}")
# print(f"lon center: {ds.lon_rho.mean().values:.3f}")
# print(f"lat center: {ds.lat_rho.mean().values:.3f}")