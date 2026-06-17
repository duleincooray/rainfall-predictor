import { useState, useEffect, useRef } from 'react';
import { ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const PRESETS = ['Kuching', 'Colombo', 'Tokyo', 'London', 'New York'];
const RAIN_THRESHOLD = 50; // % probability we call "likely"

// Reactive hue: amber (dry) → indigo (wet)
const hueFor = (prob) => Math.round(42 + (Math.max(0, Math.min(100, prob)) / 100) * 178);

// ---------- Ambient reactive backdrop ----------
function AtmosphericBackground({ probability }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    let raf;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize); resize();

    const raining = probability > 40;
    const hue = hueFor(probability);
    const count = raining ? Math.min(260, probability * 2.2) : 46;
    const parts = Array.from({ length: count }).map(() => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      len: raining ? Math.random() * 18 + 9 : Math.random() * 2.2 + 0.8,
      sp: raining ? Math.random() * 9 + 4 : Math.random() * 0.4 + 0.08,
      op: Math.random() * 0.35 + 0.05,
    }));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = `hsl(${hue} 80% 72%)`;
      ctx.lineWidth = raining ? 1 : 1.6;
      parts.forEach((p) => {
        ctx.globalAlpha = p.op;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(raining ? p.x - p.sp * 0.25 : p.x, p.y + p.len);
        ctx.stroke();
        p.y += p.sp;
        if (raining) p.x -= p.sp * 0.18;
        if (p.y > canvas.height) { p.y = -20; p.x = Math.random() * canvas.width; }
      });
      raf = requestAnimationFrame(render);
    };
    render();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(raf); };
  }, [probability]);
  return <canvas ref={ref} className="ambient" />;
}

// ---------- 270° gauge dial ----------
function Dial({ value, max = 100, accent, size = 200, stroke = 14, num, sub, numColor }) {
  const r = size / 2 - stroke;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / max));
  return (
    <div className="dialwrap" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ display: 'block' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}
          strokeDasharray={`${C * 0.75} ${C}`} strokeLinecap="round" transform={`rotate(135 ${c} ${c})`} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={accent} strokeWidth={stroke}
          strokeDasharray={`${C * 0.75 * frac} ${C}`} strokeLinecap="round" transform={`rotate(135 ${c} ${c})`}
          style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(.22,1,.36,1), stroke 0.8s', filter: `drop-shadow(0 0 8px ${accent})` }} />
      </svg>
      <div className="dialcenter">
        <div className="num" style={{ fontSize: size * 0.26, color: numColor || '#EAF0FC' }}>{num}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </div>
  );
}

function FlyTo({ center }) {
  const map = useMap();
  useEffect(() => { map.flyTo(center, 10, { duration: 1.4 }); }, [center, map]);
  return null;
}

// Animated radar: cycles through RainViewer's recent + nowcast frames
function RadarLayer({ opacity = 0.7 }) {
  const map = useMap();
  useEffect(() => {
    let layers = [];
    let timer = null;
    let active = true;

    (async () => {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        if (!active) return;
        const frames = [...(data.radar?.past || []), ...(data.radar?.nowcast || [])];
        layers = frames.map((f) =>
          // size 256 · color scheme 4 (rain green→red) · smooth + snow
          L.tileLayer(`${data.host}${f.path}/256/{z}/{x}/{y}/4/1_1.png`, {
            opacity: 0, zIndex: 5, tileSize: 256, maxNativeZoom: 8, maxZoom: 19,
          }).addTo(map)
        );
        if (!layers.length) return;
        layers[0].setOpacity(opacity);
        let prev = 0;
        timer = setInterval(() => {
          const next = (prev + 1) % layers.length;
          layers[next].setOpacity(opacity);
          layers[prev].setOpacity(0);
          prev = next;
        }, 600);
      } catch {
        /* radar feed unavailable — map still works without it */
      }
    })();

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      layers.forEach((l) => map.removeLayer(l));
    };
  }, [map, opacity]);
  return null;
}

const AQI = {
  1: { label: 'Good', fill: '#34D399' },
  2: { label: 'Fair', fill: '#60A5FA' },
  3: { label: 'Moderate', fill: '#FBBF24' },
  4: { label: 'Poor', fill: '#FB923C' },
  5: { label: 'Hazardous', fill: '#F87171' },
};

export default function App() {
  const [city, setCity] = useState(() => localStorage.getItem('lastCity') || 'Kuching');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { fetchData(city); /* eslint-disable-next-line */ }, []);

  const fetchData = async (target = city) => {
    if (!target) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/api/predict-rain/${target}`);
      if (!res.ok) throw new Error('not-found');
      const json = await res.json();
      json.forecast = json.forecast.map((f) => ({
        ...f,
        displayTime: new Date((f.dt + json.timezone) * 1000)
          .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
      }));
      setData(json);
      setCity(target);
      localStorage.setItem('lastCity', target);
    } catch {
      setError(`No reading for "${target}". Check the spelling, or try a nearby city.`);
      setData(null);
    } finally { setLoading(false); }
  };

  const prob = data ? data.forecast[0].probability_of_rain : 0;
  const hue = hueFor(prob);
  const accent = `hsl(${hue} 82% 66%)`;
  const accentGlow = `hsl(${hue} 82% 58% / 0.30)`;

  const rainSummary = () => {
    const b = data.forecast;
    if (b[0].probability_of_rain >= RAIN_THRESHOLD) return { text: 'Rain likely now', rain: true };
    const next = b.find((x) => x.probability_of_rain >= RAIN_THRESHOLD);
    if (next) return { text: `Next rain ~${next.displayTime} · ${next.probability_of_rain}%`, rain: true };
    return { text: 'Clear skies for the next 24 hours', rain: false };
  };

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
      <div style={{ background: 'rgba(8,13,26,0.92)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 14px', backdropFilter: 'blur(10px)', fontFamily: 'IBM Plex Mono, monospace' }}>
        <div style={{ color: '#9099B0', fontSize: 11, letterSpacing: '0.12em' }}>{p.displayTime}</div>
        <div style={{ color: accent, fontSize: 18, fontWeight: 700, marginTop: 4 }}>{p.probability_of_rain}%</div>
        <div style={{ color: '#9099B0', fontSize: 12, marginTop: 2 }}>{p.rain_volume_mm} mm</div>
      </div>
    );
  };

  return (
    <div className="app" style={{ '--accent': accent, '--accent-glow': accentGlow }}>
      <AtmosphericBackground probability={prob} />
      <div className="shell">

        <header className="topbar rise rise-1">
          <div className="wordmark">
            <span className="dot" />
            <span>Atmosphere</span>
            <small>rain predictor</small>
          </div>
          <div className="controls">
            <div className="field">
              <input
                value={city}
                disabled={loading}
                onChange={(e) => setCity(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchData()}
                placeholder="Search a city"
              />
              <button className="btn" disabled={loading} onClick={() => fetchData()}>
                {loading ? '…' : 'Read sky'}
              </button>
            </div>
            <div className="pills">
              {PRESETS.map((p) => (
                <button key={p} className="pill" data-active={city.toLowerCase() === p.toLowerCase()}
                  onClick={() => !loading && fetchData(p)}>{p}</button>
              ))}
            </div>
          </div>
        </header>

        {error && (
          <div className="center-state"><div className="errbox">{error}</div></div>
        )}

        {!data && !error && (
          <div className="center-state">
            <div>
              <div className="big">Read the sky over any city</div>
              <div className="small">Search above to begin</div>
            </div>
          </div>
        )}

        {data && (
          <div className={`stage ${loading ? 'dim' : ''}`}>
            <div className="console">

              <div className="herorow">
                <section className="panel hero rise rise-2">
                  <div className="eyebrow">Precipitation · {data.city}</div>
                  {(() => { const s = rainSummary(); return (
                    <div className="nextrain" data-rain={s.rain}>{s.text}</div>
                  ); })()}
                  <Dial value={prob} accent={accent} size={186} num={`${prob}%`}
                    sub={`${data.forecast[0].displayTime} local`} numColor={accent} />
                </section>

                <section className="panel hero rise rise-2">
                  <div className="eyebrow">Air quality · {data.city}</div>
                  {(() => { const a = AQI[data.current_aqi] || AQI[1]; return (
                    <>
                      <div className="nextrain" style={{ color: a.fill }}>Air is {a.label.toLowerCase()}</div>
                      <Dial value={(6 - (data.current_aqi || 1)) * 20} accent={a.fill} size={186}
                        num={data.current_aqi || 1} sub={`AQI · ${a.label}`} numColor={a.fill} />
                    </>
                  ); })()}
                </section>
              </div>

              <section className="panel conditions rise rise-3">
                {[
                  { k: 'Temp', v: data.current.temp, u: '°C' },
                  { k: 'Feels like', v: data.current.feels_like, u: '°C' },
                  { k: 'Humidity', v: data.current.humidity, u: '%' },
                  { k: 'Wind', v: data.current.wind_speed, u: 'm/s' },
                ].map((r) => (
                  <div className="readout" key={r.k}>
                    <div className="k">{r.k}</div>
                    <div className="v">{r.v}<span> {r.u}</span></div>
                  </div>
                ))}
              </section>

              <section className="panel chart rise rise-4">
                <div className="head">
                  <div className="eyebrow">24-hour outlook</div>
                  <div className="eyebrow" style={{ color: 'var(--faint)' }}>{data.current.description}</div>
                </div>
                <div className="body">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.forecast} margin={{ top: 8, right: 6, left: -6, bottom: 0 }}>
                      <defs>
                        <linearGradient id="prob" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={accent} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="displayTime" stroke="#59617A" tickLine={false} axisLine={false}
                        tick={{ fill: '#59617A', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }} />
                      <YAxis yAxisId="p" domain={[0, 100]} width={30} tickLine={false} axisLine={false}
                        tick={{ fill: '#59617A', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }} />
                      <YAxis yAxisId="v" orientation="right" domain={[0, 'dataMax + 4']} width={30} tickLine={false} axisLine={false}
                        tick={{ fill: '#59617A', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }} />
                      <Tooltip content={<Tip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Legend iconType="circle" wrapperStyle={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#9099B0' }} />
                      <Bar yAxisId="v" name="Volume (mm)" dataKey="rain_volume_mm" fill="rgba(129,140,248,0.45)" radius={[3, 3, 0, 0]} maxBarSize={34} />
                      <Area yAxisId="p" name="Probability (%)" type="monotone" dataKey="probability_of_rain" stroke={accent} strokeWidth={2.5} fill="url(#prob)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section className="panel mapwrap rise rise-3">
              <div className="maptag"><span className="dot" />{data.city}</div>
              <div className="maptag right"><span className="dot live-dot" />Live radar</div>
              <MapContainer center={[data.coord.lat, data.coord.lon]} zoom={10} zoomControl={false} style={{ height: '100%', width: '100%' }}>
                <FlyTo center={[data.coord.lat, data.coord.lon]} />
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; OSM &copy; CARTO · Radar &copy; RainViewer' />
                <RadarLayer opacity={0.7} />
                <Marker position={[data.coord.lat, data.coord.lon]} />
              </MapContainer>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
