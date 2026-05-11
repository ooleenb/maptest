#server.py
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import uvicorn

app = FastAPI()
app.mount("/data", StaticFiles(directory=".", html=False), name="data")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)