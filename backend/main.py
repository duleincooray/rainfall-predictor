from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
import time
from dotenv import load_dotenv

load_dotenv()

# Caches (in-memory, cleared on restart)
_cache = {}        # city -> (timestamp, payload)
CACHE_TTL = 600    # 10 minutes
_tile_cache = {}   # tile key -> (timestamp, png bytes)
TILE_TTL = 600

# Shared client: reuses connections instead of reconnecting per request
http_client = httpx.AsyncClient(timeout=10.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await http_client.aclose()


app = FastAPI(lifespan=lifespan)

# Comma-separated list of allowed origins; defaults to local dev.
# In production set FRONTEND_ORIGIN to your deployed frontend URL.
ALLOWED_ORIGINS = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")


@app.get("/api/predict-rain/{city}")
async def predict_rain(city: str):
    cache_key = city.lower().strip()
    cached = _cache.get(cache_key)
    if cached and (time.time() - cached[0]) < CACHE_TTL:
        return cached[1]

    if not WEATHER_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    # 1. Forecast + coordinates
    weather_res = await http_client.get(
        "http://api.openweathermap.org/data/2.5/forecast",
        params={"q": city, "appid": WEATHER_API_KEY, "units": "metric"},
    )
    if weather_res.status_code != 200:
        raise HTTPException(status_code=404, detail="City not found")

    weather_data = weather_res.json()
    lat = weather_data["city"]["coord"]["lat"]
    lon = weather_data["city"]["coord"]["lon"]

    # 2. Air quality at those coordinates
    aqi_res = await http_client.get(
        "http://api.openweathermap.org/data/2.5/air_pollution",
        params={"lat": lat, "lon": lon, "appid": WEATHER_API_KEY},
    )
    aqi_data = aqi_res.json()
    current_aqi = aqi_data["list"][0]["main"]["aqi"] if aqi_data.get("list") else 1

    # Next 24 hours = 8 blocks of 3 hours
    forecasts = []
    for item in weather_data["list"][:8]:
        forecasts.append({
            "time": item["dt_txt"],
            "dt": item["dt"],
            "probability_of_rain": int(item.get("pop", 0) * 100),
            "rain_volume_mm": item.get("rain", {}).get("3h", 0) if item.get("rain") else 0,
        })

    nearest = weather_data["list"][0]
    current_conditions = {
        "temp": round(nearest["main"]["temp"]),
        "feels_like": round(nearest["main"]["feels_like"]),
        "humidity": nearest["main"]["humidity"],
        "wind_speed": round(nearest["wind"]["speed"], 1),
        "description": nearest["weather"][0]["description"].title() if nearest.get("weather") else "",
    }

    result = {
        "city": weather_data["city"]["name"],
        "coord": weather_data["city"]["coord"],
        "timezone": weather_data["city"]["timezone"],
        "current_aqi": current_aqi,
        "current": current_conditions,
        "forecast": forecasts,
    }
    _cache[cache_key] = (time.time(), result)
    return result


# Whitelist prevents this from becoming an open proxy
VALID_LAYERS = {"precipitation_new", "clouds_new", "temp_new", "wind_new", "pressure_new"}


@app.get("/api/tiles/{layer}/{z}/{x}/{y}.png")
async def weather_tile(layer: str, z: int, x: int, y: int):
    if layer not in VALID_LAYERS:
        raise HTTPException(status_code=400, detail="Invalid layer")
    if not WEATHER_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    key = f"{layer}/{z}/{x}/{y}"
    cached = _tile_cache.get(key)
    if cached and (time.time() - cached[0]) < TILE_TTL:
        return Response(content=cached[1], media_type="image/png")

    res = await http_client.get(
        f"https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png",
        params={"appid": WEATHER_API_KEY},
    )
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail="Tile fetch failed")

    _tile_cache[key] = (time.time(), res.content)
    return Response(content=res.content, media_type="image/png")
