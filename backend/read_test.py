import xarray as xr
ds = xr.open_dataset("http://boreas.mywire.org:8080/thredds/dodsC/perthhis/perth_his_grid.nc")
print(ds)
print("---")
for var in ds.data_vars:
    print(f"{var}: shape={ds[var].shape}, dims={ds[var].dims}, units={ds[var].attrs.get('units', '?')}")