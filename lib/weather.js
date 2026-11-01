// Talks to OpenWeatherMap. Every lookup resolves to a result object instead of
// throwing, so one bad city can never take the rest of the batch down with it.

const API_URL = 'https://api.openweathermap.org/data/2.5/weather';
const TIMEOUT_MS = 8000;

// Weather "main" values that delay a delivery. OpenWeatherMap doesn't have an
// "Extreme" group any more, so we treat its severe conditions as extreme.
const DELAY_CONDITIONS = new Set(['Rain', 'Snow', 'Thunderstorm', 'Tornado', 'Squall']);

class WeatherError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;     // 'not_found' | 'auth' | 'rate_limit' | 'timeout' | 'network' | 'http'
    this.status = status;
  }
}

async function fetchWeather(city, apiKey, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const url = `${API_URL}?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
  const startedAt = Date.now();
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const reason = body.message || res.statusText || 'request failed';
      if (res.status === 404) throw new WeatherError('not_found', `City not found: "${city}"`, 404);
      if (res.status === 401) throw new WeatherError('auth', `API key rejected (${reason})`, 401);
      if (res.status === 429) throw new WeatherError('rate_limit', `Rate limited by OpenWeatherMap (${reason})`, 429);
      throw new WeatherError('http', `HTTP ${res.status}: ${reason}`, res.status);
    }

    const w = body.weather?.[0] ?? {};
    return {
      city,
      ok: true,
      main: w.main,
      description: w.description,
      tempC: body.main?.temp,
      resolvedName: body.name,
      ms: Date.now() - startedAt,
    };
  } catch (err) {
    let error = err;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      error = new WeatherError('timeout', `No response within ${timeoutMs / 1000}s`);
    } else if (!(err instanceof WeatherError)) {
      error = new WeatherError('network', `Network error: ${err.message}`);
    }
    return { city, ok: false, error, ms: Date.now() - startedAt };
  }
}

// Fires one request per unique city, all at once. Promise.all is safe here
// because fetchWeather never rejects. Failures come back as { ok: false }.
async function fetchAllWeather(cities, apiKey, opts) {
  const unique = [...new Set(cities)];
  const results = await Promise.all(unique.map(city => fetchWeather(city, apiKey, opts)));
  return new Map(results.map(r => [r.city, r]));
}

const causesDelay = main => DELAY_CONDITIONS.has(main);

module.exports = { fetchWeather, fetchAllWeather, causesDelay, WeatherError, DELAY_CONDITIONS };
