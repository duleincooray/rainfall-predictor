import { useState, useEffect, useRef } from 'react';
import { ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar, Legend, CartesianGrid, Label } from 'recharts';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default Leaflet marker icons in React
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

// --- DYNAMIC BACKGROUND COMPONENT ---
const AtmosphericBackground = ({ probability }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const isRaining = probability > 40;
    const particleCount = isRaining ? probability * 2 : 50;
    const particles = Array.from({ length: particleCount }).map(() => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      length: isRaining ? Math.random() * 20 + 10 : Math.random() * 2 + 1,
      speed: isRaining ? Math.random() * 10 + 5 : Math.random() * 0.5 + 0.1,
      opacity: Math.random() * 0.5 + 0.1
    }));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = isRaining ? '#60a5fa' : '#cbd5e1';
      ctx.lineWidth = isRaining ? 1 : 2;

      particles.forEach(p => {
        ctx.globalAlpha = p.opacity;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y + p.length);
        ctx.stroke();

        p.y += p.speed;
        if (isRaining) p.x -= p.speed * 0.2;

        if (p.y > canvas.height) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }
      });

      animationFrameId = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [probability]);

  return <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, zIndex: 0, pointerEvents: 'none' }} />;
};

// --- MAP HELPER COMPONENT ---
function ChangeView({ center, zoom }) {
  const map = useMap();
  map.flyTo(center, zoom, { duration: 1.5 });
  return null;
}

// --- MAIN APPLICATION ---
export default function App() {
  const [city, setCity] = useState(() => localStorage.getItem('lastCity') || 'Kuching');
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-fetch data on initial load
  useEffect(() => {
    fetchRainData(city);
  }, []);

  const fetchRainData = async (targetCity = city) => {
    if (!targetCity) return;
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/predict-rain/${targetCity}`);
      if (!response.ok) throw new Error('City not found or API error');
      
      const data = await response.json();
      const formattedData = {
        ...data,
        forecast: data.forecast.map(item => ({
          ...item,
          displayTime: new Date((item.dt + data.timezone) * 1000)
           .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
        }))
      };
      setForecast(formattedData);
      setCity(targetCity); // Keep input synced with quick-selects
      localStorage.setItem('lastCity', targetCity);
    } catch (err) {
      setError(`Couldn't load weather for "${targetCity}". Check the spelling or try another city.`);
      setForecast(null);
    } finally {
      setLoading(false);
    }
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ backgroundColor: 'rgba(30, 41, 59, 0.9)', padding: '1rem', border: '1px solid #334155', borderRadius: '8px', backdropFilter: 'blur(10px)', zIndex: 10 }}>
          <p style={{ color: '#94a3b8', margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>{payload[0].payload.displayTime}</p>
          <p style={{ color: '#60a5fa', margin: 0, fontWeight: 'bold', fontSize: '1.2rem' }}>
            {payload[0].payload.probability_of_rain}% Chance
          </p>
          <p style={{ color: '#cbd5e1', margin: '0.5rem 0 0 0', fontSize: '0.85rem' }}>
            {payload[0].payload.rain_volume_mm} mm volume
          </p>
        </div>
      );
    }
    return null;
  };

  const getAqiData = (aqi) => {
    const mapping = {
      1: { label: 'Good', fill: '#10b981', value: 100 },
      2: { label: 'Fair', fill: '#3b82f6', value: 80 },
      3: { label: 'Moderate', fill: '#f59e0b', value: 60 },
      4: { label: 'Poor', fill: '#f97316', value: 40 },
      5: { label: 'Hazardous', fill: '#ef4444', value: 20 }
    };
    const current = mapping[aqi] || mapping[1];
    return [{ name: 'AQI', value: current.value, fill: current.fill, label: current.label }];
  };

  const getRainSummary = (data) => {
    const THRESHOLD = 50; // % probability we'll call "likely"
    const blocks = data.forecast;

    if (blocks[0].probability_of_rain >= THRESHOLD) {
      return { text: 'Rain likely now', highlight: true };
    }
    const next = blocks.find((b) => b.probability_of_rain >= THRESHOLD);
    if (next) {
      return { text: `Next rain ~${next.displayTime} (${next.probability_of_rain}%)`, highlight: true };
    }
    return { text: 'No rain expected in the next 24h', highlight: false };
  };

  return (
    <div style={{ backgroundColor: '#0f172a', color: '#f8fafc', height: '100vh', width: '100vw', overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box', position: 'relative' }}>
      
      <AtmosphericBackground probability={forecast ? forecast.forecast[0].probability_of_rain : 0} />
      
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
        
        {/* Header & Quick Selects */}
        <header style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(30, 41, 59, 0.5)', display: 'flex', flexDirection: 'column', gap: '1rem', backdropFilter: 'blur(5px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>
              <span style={{ color: '#3b82f6' }}>Atmosphere</span> | Predictor
            </h1>
            
            <div style={{ display: 'flex', gap: '0.5rem', width: '400px' }}>
              <input 
                disabled={loading}
                type="text" 
                value={city} 
                onChange={(e) => setCity(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchRainData()}
                placeholder="Search global location..."
                style={{ flex: 1, padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #334155', backgroundColor: 'rgba(30, 41, 59, 0.8)', color: '#f8fafc', outline: 'none' }}
              />
              <button 
                onClick={() => fetchRainData()} 
                disabled={loading}
                style={{ padding: '0 1.5rem', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '600', transition: 'all 0.2s' }}>
                {loading ? '...' : 'Search'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', width: '100%' }}>
            {['Kuching', 'Colombo', 'Tokyo', 'London', 'New York'].map((preset) => (
              <button
                key={preset}
                onClick={() => !loading && fetchRainData(preset)}
                style={{
                  padding: '0.4rem 1rem',
                  fontSize: '0.8rem',
                  backgroundColor: city.toLowerCase() === preset.toLowerCase() ? 'rgba(59, 130, 246, 0.2)' : 'rgba(30, 41, 59, 0.5)',
                  color: city.toLowerCase() === preset.toLowerCase() ? '#60a5fa' : '#94a3b8',
                  border: `1px solid ${city.toLowerCase() === preset.toLowerCase() ? 'rgba(59, 130, 246, 0.5)' : '#334155'}`,
                  borderRadius: '20px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </header>

        {/* Main Content Area */}
        <main style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem', justifyContent: 'center' }}>
          
          {error && <div style={{ textAlign: 'center', color: '#ef4444', padding: '1rem', backgroundColor: 'rgba(69, 10, 10, 0.8)', borderRadius: '8px', alignSelf: 'center', width: '100%', maxWidth: '600px' }}>{error}</div>}
          {!forecast && !error && <div style={{ textAlign: 'center', color: '#64748b', fontSize: '1.2rem', marginTop: '-10vh' }}>Awaiting coordinates...</div>}

          {forecast && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', height: '100%', opacity: loading ? 0.4 : 1, transition: 'opacity 0.2s', pointerEvents: loading ? 'none' : 'auto' }}>
              
              {/* LEFT COLUMN */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', height: '100%' }}>
                
                <div style={{ flex: 0.6, display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1, backgroundColor: 'rgba(30, 41, 59, 0.3)', padding: '1.5rem', borderRadius: '24px', border: '1px solid rgba(51, 65, 85, 0.5)', textAlign: 'center', backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <h2 style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '0.5rem' }}>
                      Precipitation: <span style={{ color: '#f8fafc', fontWeight: 'bold' }}>{forecast.city}</span>
                    </h2>
                    <p style={{ fontSize: '1rem', color: '#cbd5e1', marginBottom: '0.5rem' }}>{forecast.forecast[0].displayTime} local</p>
                    <div style={{ fontSize: '4.5rem', fontWeight: '800', lineHeight: '1', color: forecast.forecast[0].probability_of_rain > 40 ? '#60a5fa' : '#f8fafc', textShadow: forecast.forecast[0].probability_of_rain > 40 ? '0 0 30px rgba(96, 165, 250, 0.3)' : 'none' }}>
                      {forecast.forecast[0].probability_of_rain}%
                    </div>
                  </div>

                  {(() => {
                    const summary = getRainSummary(forecast);
                    return (
                      <p style={{ marginTop: '0.75rem', fontSize: '1rem', fontWeight: 600, color: summary.highlight ? '#60a5fa' : '#94a3b8' }}>
                        {summary.text}
                      </p>
                    );
                  })()}

                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-around', backgroundColor: 'rgba(30, 41, 59, 0.3)', padding: '1rem', borderRadius: '16px', border: '1px solid rgba(51, 65, 85, 0.5)', backdropFilter: 'blur(12px)' }}>
                    {[
                      { label: 'Temp', value: `${forecast.current.temp}°C` },
                      { label: 'Feels Like', value: `${forecast.current.feels_like}°C` },
                      { label: 'Humidity', value: `${forecast.current.humidity}%` },
                      { label: 'Wind', value: `${forecast.current.wind_speed} m/s` },
                    ].map((stat) => (
                      <div key={stat.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.25rem' }}>{stat.label}</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: '700', color: '#f8fafc' }}>{stat.value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ flex: 0.6, backgroundColor: 'rgba(30, 41, 59, 0.3)', padding: '1.5rem', borderRadius: '24px', border: '1px solid rgba(51, 65, 85, 0.5)', textAlign: 'center', backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <h2 style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '0' }}>Air Quality</h2>
                    <div style={{ height: '120px', width: '100%', marginTop: '-10px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="100%" barSize={10} data={getAqiData(forecast.current_aqi)} startAngle={180} endAngle={0}>
                          <RadialBar minAngle={15} background={{ fill: '#334155' }} clockWise dataKey="value" cornerRadius={10} />
                        </RadialBarChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ marginTop: '-40px', fontSize: '1.5rem', fontWeight: 'bold', color: getAqiData(forecast.current_aqi)[0].fill }}>
                      {getAqiData(forecast.current_aqi)[0].label}
                    </div>
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, padding: '1rem 0 0 0', borderTop: '1px solid rgba(30, 41, 59, 0.5)' }}>
                  <h3 style={{ fontSize: '0.9rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '1rem' }}>Probability vs Volume Matrix</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <ComposedChart data={forecast.forecast} margin={{ top: 10, right: 5, left: 5, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorProb" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                        <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#818cf8" stopOpacity={0.8}/><stop offset="95%" stopColor="#818cf8" stopOpacity={0.2}/></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(51, 65, 85, 0.3)" vertical={false} />
                      <XAxis dataKey="displayTime" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="prob" domain={[0, 100]} stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} width={35}>
                        <Label value="Probability (%)" angle={-90} position="insideLeft" style={{ fill: '#64748b', fontSize: 11, textAnchor: 'middle' }} />
                      </YAxis>
                      <YAxis yAxisId="vol" orientation="right" domain={[0, 'dataMax + 5']} stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} width={35}>
                        <Label value="Volume (mm)" angle={90} position="insideRight" style={{ fill: '#64748b', fontSize: 11, textAnchor: 'middle' }} />
                      </YAxis>
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                      <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} iconType="circle" />
                      <Bar yAxisId="vol" dataKey="rain_volume_mm" fill="url(#colorVol)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Area yAxisId="prob" type="monotone" dataKey="probability_of_rain" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorProb)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* RIGHT COLUMN: Interactive Dark Map */}
              <div style={{ borderRadius: '24px', overflow: 'hidden', border: '1px solid rgba(51, 65, 85, 0.5)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', height: '100%', minHeight: '400px', backgroundColor: '#1e293b' }}>
                <MapContainer center={[forecast.coord.lat, forecast.coord.lon]} zoom={10} style={{ height: '100%', width: '100%', zIndex: 1 }} zoomControl={false}>
                  <ChangeView center={[forecast.coord.lat, forecast.coord.lon]} zoom={10} />
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                  />
                  <TileLayer
                    url={`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${import.meta.env.VITE_OWM_KEY}`}
                    opacity={0.6}
                  />
                  <TileLayer
                    url="http://127.0.0.1:8000/api/tiles/precipitation_new/{z}/{x}/{y}.png"
                    opacity={0.6}
                  />
                  <Marker position={[forecast.coord.lat, forecast.coord.lon]} />
                </MapContainer>
              </div>

            </div>
          )}
        </main>
      </div>
    </div>
  );
}