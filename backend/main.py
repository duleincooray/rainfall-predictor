from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Allow our React frontend to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Vite's default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")

@app.get("/api/predict-rain/{city}")
async def predict_rain(city: str):
    if not WEATHER_API_KEY:
        raise HTTPException(status_code=500, detail="API key not configured")

    base_url = "http://api.openweathermap.org/data/2.5/forecast"
    params = {
        "q": city,
        "appid": WEATHER_API_KEY,
        "units": "metric"
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(base_url, params=params)
        
    if response.status_code != 200:
        raise HTTPException(status_code=404, detail="City not found")
        
    data = response.json()
    
    # Extract the next 24 hours of rain probability (8 intervals of 3 hours)
    forecasts = []
    for item in data["list"][:8]: 
        forecasts.append({
            "time": item["dt_txt"],
            "probability_of_rain": int(item.get("pop", 0) * 100), # converted to a percentage
            "rain_volume_mm": item.get("rain", {}).get("3h", 0) if item.get("rain") else 0
        })
        
    return {"city": data["city"]["name"], "forecast": forecasts}