# Weather-Aware Order Delays

A small Node.js script that checks the current weather for every order's city, flags orders that will probably be late because of the weather, and writes a friendly apology for each one.

```
$ node index.js

Checking weather for 4 orders (4 cities), all requests in parallel...

  ✓ 1001  New York        Clouds (broken clouds, 9°C) → no delay
  ! 1003  London          Rain (light rain, 11°C) → Delayed
         "Hi Charlie, your order to London is delayed due to light rain. We appreciate your patience!"
  ✗ 1004  InvalidCity123  City not found: "InvalidCity123" → logged to logs/errors.log, skipping
  ...
  4 API calls fired together: finished in 212 ms (slowest single call: 209 ms)
```

## Run it

Needs Node.js 20.12 or newer. There are no packages to install.

```bash
cp .env.example .env          # then paste your OpenWeatherMap key into .env
node index.js                 # checks weather and updates orders.json
node index.js --dry-run       # same, but doesn't save
npm test                      # runs the tests (no API key needed)
npm run reset                 # puts orders.json back to all-Pending
```

Get a free key at https://home.openweathermap.org/api_keys. New keys can take up to a couple of hours to start working.

## How it works

**Parallel fetching.** The script collects the unique cities and starts one request per city at the same time with `Promise.all` ([lib/weather.js](lib/weather.js)). The total time is roughly the slowest single call, not the sum of all of them. The script prints both numbers so you can see it.

**Why `Promise.all` is safe here.** `fetchWeather` never throws. Every outcome, good or bad, comes back as an object like `{ ok: true, main, description }` or `{ ok: false, error }`. So one bad city can't reject the whole batch, and you get the concurrency of `Promise.all` without its "one failure kills everything" behaviour.

**The delay rule.** If the weather's `main` is `Rain` or `Snow`, or something extreme, the order becomes `Delayed` and gets an `apology` field. OpenWeatherMap no longer has a literal "Extreme" category, so I treat `Thunderstorm`, `Tornado` and `Squall` as extreme. `Drizzle`, `Clouds`, `Mist` and so on don't count as delays. The list lives in one `Set` in `lib/weather.js` if you want to change it.

**Weather-aware apology.** [lib/apology.js](lib/apology.js) turns the API's description into everyday wording ("heavy intensity rain" becomes "heavy rain", "Thunderstorm" becomes "a thunderstorm") and uses the customer's first name:

> Hi Alice, your order to New York is delayed due to heavy rain. We appreciate your patience!

**Errors don't stop the run.** Each failure is labelled as one of these kinds:

| Situation | What happens |
|---|---|
| City doesn't exist (`InvalidCity123` returns 404) | logged, order left as-is, everything else continues |
| Wrong or inactive API key (401) | logged per city with a clear message |
| Rate limited (429), other HTTP errors | logged |
| No answer within 8s | request is cancelled and logged as a timeout |
| No internet / DNS failure | logged as a network error |

Errors go to the console and, as one JSON line each, to `logs/errors.log`. The only things that stop the script are problems with its own setup: a missing API key or an unreadable `orders.json`.

**Safe writes.** `orders.json` is written to a temp file first and then renamed, so a crash halfway through can't leave a half-written file.

**No hardcoded key.** The key is read from `.env` with Node's built-in `process.loadEnvFile`. `.env` is git-ignored, and `.env.example` shows the format.

## Tests

`npm test` runs the real code against a fake OpenWeatherMap, so the results don't depend on today's weather:

- all 4 requests start before any of them finishes (proof they're parallel)
- Rain, Snow and Thunderstorm lead to `Delayed` with the right apology; clouds stay `Pending`
- `InvalidCity123` is logged and skipped, and the other three are still processed
- bad key, timeout and dropped connection all come back as errors, not crashes
- apology wording for different weather

## Files

```
index.js              main script: read orders, check weather, update, save
lib/weather.js        OpenWeatherMap client, parallel fetch, delay rule
lib/apology.js        weather-aware apology messages
test/orders.test.js   tests (node:test, no dependencies)
orders.json           the orders, updated by each run
orders.original.json  the starting data, used by `npm run reset`
AI_LOG.md             prompts used to build the parallel fetching and error handling
```
