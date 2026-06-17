from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
from dotenv import load_dotenv
import time

# Simple in-memory cache: { city_lower: (timestamp, data) }
_cache = {}
CACHE_TTL = 600  # seconds (10 minutes)

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Allow our React frontend to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], 
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

    # 1. Fetch Rainfall & Coordinates
    weather_url = "http://api.openweathermap.org/data/2.5/forecast"
    weather_params = {
        "q": city,
        "appid": WEATHER_API_KEY,
        "units": "metric"
    }
    
    async with httpx.AsyncClient() as client:
        weather_res = await client.get(weather_url, params=weather_params)
        
    if weather_res.status_code != 200:
        raise HTTPException(status_code=404, detail="City not found")
        
    weather_data = weather_res.json()
    lat = weather_data["city"]["coord"]["lat"]
    lon = weather_data["city"]["coord"]["lon"]

    # 2. Fetch Air Quality Index (AQI) using the exact coordinates
    aqi_url = "http://api.openweathermap.org/data/2.5/air_pollution"
    aqi_params = {
        "lat": lat, 
        "lon": lon, 
        "appid": WEATHER_API_KEY
    }
    
    async with httpx.AsyncClient() as client:
        aqi_res = await client.get(aqi_url, params=aqi_params)
        
    aqi_data = aqi_res.json()
    # AQI is returned as an integer from 1 (Good) to 5 (Hazardous)
    current_aqi = aqi_data["list"][0]["main"]["aqi"] if aqi_data.get("list") else 1

    # Extract the next 24 hours of rain probability (8 intervals of 3 hours)
    forecasts = []
    for item in weather_data["list"][:8]:  
        forecasts.append({
            "time": item["dt_txt"],
            "dt": item["dt"],
            "probability_of_rain": int(item.get("pop", 0) * 100),
            "rain_volume_mm": item.get("rain", {}).get("3h", 0) if item.get("rain") else 0
        })
    
    # Pull current-ish conditions from the nearest forecast block
    nearest = weather_data["list"][0]
    current_conditions = {
        "temp": round(nearest["main"]["temp"]),
        "feels_like": round(nearest["main"]["feels_like"]),
        "humidity": nearest["main"]["humidity"],
        "wind_speed": round(nearest["wind"]["speed"], 1),
        "description": nearest["weather"][0]["description"].title() if nearest.get("weather") else ""
    }
    
    result = {
        "city": weather_data["city"]["name"], 
        "coord": weather_data["city"]["coord"],
        "timezone": weather_data["city"]["timezone"],
        "current_aqi": current_aqi,
        "current": current_conditions,
        "forecast": forecasts
    }
    _cache[cache_key] = (time.time(), result)
    return result

# Valid OWM tile layers — whitelist prevents this becoming an open proxy
VALID_LAYERS = {"precipitation_new", "clouds_new", "temp_new", "wind_new", "pressure_new"}
_tile_cache = {}
TILE_TTL = 600  # 10 minutes

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

    tile_url = f"https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png"
    async with httpx.AsyncClient() as client:
        res = await client.get(tile_url, params={"appid": WEATHER_API_KEY})

    if res.status_code != 200:
        raise HTTPException(status_code=502, detail="Tile fetch failed")

    _tile_cache[key] = (time.time(), res.content)
    return Response(content=res.content, media_type="image/png")