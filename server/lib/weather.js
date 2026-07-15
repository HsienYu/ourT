/**
 * weather.js
 *
 * Fetches real-time weather for the Xinjiaying venue (Chiayi, Taiwan)
 * from the Open-Meteo free API (no key required).
 *
 * Caches for CACHE_TTL_MS to avoid hammering the API during the show.
 * Returns a plain object safe to embed in system prompts and the control panel.
 */

'use strict';

// Xinjiaying (新嘉義座), Chiayi City, Taiwan
const LAT = 23.4800;
const LON = 120.4491;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,relative_humidity_2m,apparent_temperature,` +
  `surface_pressure,weather_code,wind_speed_10m` +
  `&timezone=Asia%2FTaipei` +
  `&forecast_days=1`;

// WMO weather code → short description (zh-TW)
const WMO_CODES = {
  0: '晴天', 1: '大致晴', 2: '部分多雲', 3: '陰天',
  45: '霧', 48: '霧淞', 51: '毛毛雨（輕）', 53: '毛毛雨', 55: '毛毛雨（重）',
  61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪',
  80: '陣雨（輕）', 81: '陣雨', 82: '陣雨（強）', 95: '雷雨', 99: '雷雨伴冰雹',
};

let cache = null;
let cacheTime = 0;

/**
 * Returns current weather data. Uses cache if fresh.
 * @returns {Promise<WeatherData>}
 */
async function getWeather() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  try {
    const res = await fetch(OPEN_METEO_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const c = json.current;

    cache = {
      temperature: c.temperature_2m,           // °C
      humidity: c.relative_humidity_2m,         // %
      pressure: c.surface_pressure,             // hPa
      apparentTemp: c.apparent_temperature,     // °C
      windSpeed: c.wind_speed_10m,              // km/h
      condition: WMO_CODES[c.weather_code] ?? '未知',
      fetchedAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    };
    cacheTime = now;
    console.log('[weather] Fetched:', cache.temperature + '°C', cache.condition);
    return cache;
  } catch (err) {
    console.error('[weather] Fetch failed:', err.message);
    // Return stale cache if available, else a null object
    return cache ?? {
      temperature: null, humidity: null, pressure: null,
      apparentTemp: null, windSpeed: null, condition: '無法取得',
      fetchedAt: null,
    };
  }
}

/**
 * Formats weather data as a concise string for injection into AI system prompts.
 * @param {WeatherData} w
 * @returns {string}
 */
function formatForPrompt(w) {
  if (!w.temperature) return '（無法取得現場氣象資料）';
  return (
    `現場氣象（新嘉義座）：` +
    `氣溫 ${w.temperature}°C（體感 ${w.apparentTemp}°C）、` +
    `濕度 ${w.humidity}%、` +
    `氣壓 ${w.pressure} hPa、` +
    `${w.condition}、` +
    `風速 ${w.windSpeed} km/h。`
  );
}

module.exports = { getWeather, formatForPrompt };
