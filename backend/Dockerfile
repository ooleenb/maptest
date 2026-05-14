
FROM python:3.11-slim


RUN apt-get update && apt-get install -y --no-install-recommends \
        libnetcdf-dev \
        libhdf5-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*


WORKDIR /app


COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt


COPY app/ ./app/


RUN mkdir -p /app/data/grid /app/data/frames


ENV PYTHONUNBUFFERED=1 \
    ROMS_GRID_CACHE_DIR=/app/data/grid \
    ROMS_DATA_ROOT=/app/data/frames


EXPOSE 8000


# CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8000"]
WORKDIR /app/app
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
