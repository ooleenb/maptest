# Ocean Data Visualisation

A web-based visualisation system for operational ocean model output from the University of Western Australia. Displays surface temperature, salinity, sea-level, and current velocity fields from ROMS models running on the [UWA Coastal Oceanography research server](http://boreas.mywire.org:8080/thredds/catalog.html), with animated particle trajectories for surface currents. Inspired by [windy.com](https://windy.com), but tailored to high-resolution local ocean models.

Supervised by A/Prof Ivica Janekovic.

![home](/pictures/home.png)

---

## Quick start

Prerequisite: Have [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

```bash
git clone https://github.com/ooleenb/MapTest.git
cd MapTest
docker-compose up
```

First-time build takes 5–10 minutes. Subsequent starts take ~30 seconds.

Open `http://localhost:8081` in your browser.

To stop:

```bash
docker-compose down
```

---

## Features

- **Two ROMS data sources**, switchable from a single UI:
  - **Perth waters** — 500 m local model, 259×129 grid
  - **Central WA** — ~2 km regional model, 640×480 grid (full WA shelf)
- **Surface variables**: temperature, salinity, sea-surface height
- **Surface currents** rendered as animated particle trails
- **Time control**: 24-hour playback per day, scrubbable timeline, variable playback speed (0.5×–6×)
- **Point sampling**: click anywhere on the ocean to read the value at that coordinate
- **Date browsing**: any day from 2026-01-01 to the most recent available in the THREDDS catalogue
- **Multiple colourmaps** per variable (viridis, plasma, inferno, RdBu_r, etc.) with switchable global/local colour range
- **AWST + UTC dual time display** — the timeline scale is in UTC (matching the data); the headline time is in Australian Western Standard Time (UTC+8)

---

## Architecture

```
Browser  ──▶  Nginx (frontend container, :8081)
                │
                ├─ serves compiled static SPA (dist/)
                └─ /api/*  reverse-proxied to ──▶  FastAPI (backend container, :8000)
                                                       │
                                                       ├─ on-demand data prep
                                                       │  (xarray + dask, lazy OPeNDAP)
                                                       └─ persisted to /app/data (volume)
                                                                  │
                                                                  ▼
                                                       UWA THREDDS server
                                                       boreas.mywire.org:8080
```

The backend lazily opens a single long-lived OPeNDAP handle per data source on startup, then prepares per-day data packages on demand the first time each day is requested. Prepared data is cached on disk and reused on subsequent requests.

Data flow per day:

1. Frontend requests `/api/sources/perth/days/2026-05-17/meta` → triggers prep if absent
2. Backend pulls 24 timesteps from OPeNDAP (~5 s for Perth, ~50 s for CWA)
3. Backend packs scalars as Float32 binary blobs, encodes u/v as 24 PNG images (one per hour, RG channels)
4. Frontend fetches `temp.bin`, `salt.bin`, `zeta.bin`, and 24 PNGs in parallel
5. UI renders polygons (one per ocean cell) + animated particles

---

## Project structure

```
MapTest/
├── docker-compose.yml         # Orchestrates the two services
├── .dockerignore
├── .gitignore
├── backend/
│   ├── Dockerfile             # Python 3.11-slim + netCDF4 + FastAPI
│   ├── requirements.txt
│   └── app/
│       ├── api.py             # FastAPI routes
│       ├── data_loader.py     # OPeNDAP access layer (multi-source)
│       ├── grid_meta.py       # Grid metadata + ocean cell polygon builder
│       └── prep_day.py        # Per-day data preparation pipeline
└── frontend/
    ├── Dockerfile             # Two-stage: Node 20 builder + nginx:alpine runtime
    ├── nginx.conf             # Static serve + /api reverse proxy
    └── ocean-viz/             # React + Vite project
        ├── package.json
        └── src/
            ├── App.jsx
            ├── components/    # TopBar, BottomTimebar, popovers, etc.
            ├── data/          # API client, day loader
            ├── render/        # Particle simulator, colour layer, colormaps
            └── hooks/         # useDayData, usePlayback
```

---

## API reference

Base URL: `http://localhost:8000/api` (direct) or `http://localhost:8081/api` (via Nginx).

| Method | Path | Description |
|---|---|---|
| GET | `/sources` | List available data sources |
| GET | `/sources/{source}` | Metadata for one source |
| GET | `/sources/{source}/grid` | Ocean cell polygons + bounds (large, 5–60 MB) |
| GET | `/sources/{source}/dates?range=both` | Date listing (remote + local-cached) |
| GET | `/sources/{source}/days/{date}/meta` | Daily summary; triggers on-demand prep |
| GET | `/sources/{source}/days/{date}/scalar/{var}` | Float32 binary, shape `(24, nEta, nXi)` |
| GET | `/sources/{source}/days/{date}/uv/{hour}` | PNG (RG = u/v, B = land mask) for one hour |
| GET | `/health` | Health check (used by Docker healthcheck) |

`source` values: `perth`, `cwa`.
`var` values: `temp`, `salt`, `zeta`.
`hour` values: `00`–`23` (zero-padded).

---

## Configuration

### Volume mounts

The `docker-compose.yml` mounts `./backend/data` into the backend container at `/app/data`. This persists:

- **Grid cache** (`data/grid/*.nc`) — downloaded once per source on first run
- **Prepared days** (`data/frames/{source}/{date}/`) — built on demand, ~13 MB per Perth day, ~87 MB per CWA day

Removing this volume (or deleting `backend/data/`) forces a full re-download on next start.

### Ports

Defaults are configured in `docker-compose.yml`:

- Frontend: host `8081` → container `80`
- Backend: host `8000` → container `8000` (exposed for direct debugging)

Edit the `ports:` blocks in `docker-compose.yml` if these conflict with other services on your machine.

### Environment variables

The backend reads two optional environment variables:

- `ROMS_GRID_CACHE_DIR` — where to cache grid files (default `/app/data/grid` in Docker)
- `ROMS_DATA_ROOT` — where to write prepared day data (default `/app/data/frames`)

---

## Development mode (without Docker)

If you want to iterate on the code with hot-reload (faster than rebuilding the Docker image):

### Backend

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1      # Windows PowerShell
# source .venv/bin/activate       # macOS / Linux

pip install -r requirements.txt
cd app
python api.py
```

API runs at `http://localhost:8000`.

### Frontend

```bash
cd frontend/ocean-viz
npm install
npm run dev
```

UI runs at `http://localhost:5173`. The dev server's `vite.config.js` proxies `/api` to `http://localhost:8000`, so the frontend talks to the locally running backend.

---

## Technology stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + Vite |
| Map rendering | MapLibre GL JS + DeckGL |
| Basemap tiles | CARTO Voyager (free, no API key) |
| Backend framework | FastAPI + uvicorn |
| Numerical | xarray + dask + numpy + scipy |
| NetCDF access | netCDF4 + OPeNDAP |
| Container runtime | Docker + docker-compose |
| Static serving | nginx (alpine) |

### Why this stack (not the original spec)

The original project brief proposed a Java-based system built on [Kalisio Kano + Weacast](https://kalisio.github.io/kano/). After consultation with the supervisor, we adopted Python + React for these reasons:

- **The original "Java" specification refers to JavaScript** — Kano and Weacast are Node.js applications, not Java applications. Java only appears in their stack as a small dependency for one binary tool.
- **Python is the de facto standard for ocean / atmospheric data processing.** `xarray`, `dask`, and `netCDF4` form a mature ecosystem with no equivalent in Java.
- **The supervisor explicitly noted Python proficiency** ("I am good with linux/python and bash scripting") — long-term maintainability favours Python.
- **DeckGL/WebGL outperforms Leaflet** (Kano's renderer) for tens-to-hundreds of thousands of grid cells, particularly for the larger CWA domain (282 K visible polygons).

---

## Limitations & future work

- **WRF atmosphere model integration**: A WRF data source was scoped (`wrf_roms_d02_*.nc` on the same THREDDS server, providing 10 m wind, 2 m temperature, sea-level pressure, rainfall) but not deployed in this version. The data loader and grid handler were designed to accommodate a third source with minor configuration changes.
- **CWA playback performance**: Animation playback on the CWA grid (282 K cells) is throttled to hour-bucketed updates to avoid main-thread blocking. A future version could use GPU texture rendering for smooth continuous interpolation.
- **Cell-based rendering**: The visualisation deliberately preserves discrete ROMS grid cells rather than smoothing them (as windy.com does). This is a transparency decision — the user sees the actual model output, not a post-processed approximation. A "smooth mode" toggle is a possible future option.
- **HTTPS / production deployment**: Currently configured for local Docker only. Cloud deployment (UWA-provided server) is straightforward but requires server-specific configuration (HTTPS, domain, reverse proxy front-end).

---

## Acknowledgements

- Ocean model output produced by A/Prof Ivica Janekovic, UWA Oceans Institute
- THREDDS data server hosting at `boreas.mywire.org:8080`
- Basemap tiles by [CARTO](https://carto.com/) and [OpenStreetMap](https://www.openstreetmap.org/) contributors

<!-- --- -->

<!-- ## License

To be added. -->