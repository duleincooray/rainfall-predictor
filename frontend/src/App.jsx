import { useState } from 'react';

export default function App() {
  const [city, setCity] = useState('');
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchRainData = async () => {
    if (!city) return;
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/predict-rain/${city}`);
      if (!response.ok) throw new Error('City not found or API error');
      
      const data = await response.json();
      setForecast(data);
    } catch (err) {
      setError(err.message);
      setForecast(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '100vh', padding: '3rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        
        <h1 style={{ textAlign: 'center', marginBottom: '2rem', fontSize: '2.5rem', fontWeight: 'bold' }}>
          Global Rainfall Predictor
        </h1>

        {/* Search Section */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '3rem' }}>
          <input 
            type="text" 
            value={city} 
            onChange={(e) => setCity(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchRainData()}
            placeholder="Enter any city name..."
            style={{ 
              padding: '1rem', 
              borderRadius: '8px', 
              border: '1px solid #334155', 
              backgroundColor: '#1e293b', 
              color: '#f8fafc',
              width: '100%',
              maxWidth: '400px',
              fontSize: '1rem'
            }}
          />
          <button 
            onClick={fetchRainData} 
            disabled={loading}
            style={{ 
              padding: '1rem 2rem', 
              backgroundColor: '#3b82f6', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px',
              fontSize: '1rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              transition: 'background-color 0.2s'
            }}>
            {loading ? 'Scanning...' : 'Analyze'}
          </button>
        </div>

        {/* Error Handling */}
        {error && (
          <div style={{ textAlign: 'center', color: '#ef4444', marginBottom: '2rem', padding: '1rem', backgroundColor: '#450a0a', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        {/* Results Dashboard */}
        {forecast && (
          <div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', borderBottom: '1px solid #334155', paddingBottom: '0.5rem' }}>
              24-Hour Forecast: <span style={{ color: '#60a5fa' }}>{forecast.city}</span>
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              {forecast.forecast.map((interval, idx) => (
                <div key={idx} style={{ backgroundColor: '#1e293b', padding: '1.5rem', borderRadius: '12px', border: '1px solid #334155' }}>
                  <p style={{ color: '#94a3b8', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    {new Date(interval.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <h3 style={{ 
                    fontSize: '1.8rem', 
                    margin: '0.5rem 0',
                    color: interval.probability_of_rain > 40 ? '#60a5fa' : '#f8fafc' 
                  }}>
                    {interval.probability_of_rain}%
                  </h3>
                  <p style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
                    {interval.rain_volume_mm > 0 ? `${interval.rain_volume_mm} mm expected` : 'No significant rain'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}