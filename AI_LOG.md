# AI Log

**Tool:** Claude Code (Claude Opus 5.5), working inside the project folder. It wrote the code, I reviewed it, and I ran it and the tests myself.

## Parallel fetching

**Prompt 1:**
> Build a Node.js script that reads orders.json and gets the current weather for each order's city from the OpenWeatherMap API. The calls must run at the same time with Promise.all, not one after another. Use only built-in Node features (fetch, no axios), and read the API key from a .env file.

**Prompt 2:**
> If two orders are going to the same city, only call the API once for that city. Print how long the whole batch took next to the slowest single call, so I can see the calls really happened in parallel.

**Prompt 3:**
> Write a test that proves the calls are concurrent. Use a fake fetch with a delay, and check that every request started before the first one finished.

## Error handling

**Prompt 4:**
> One of the cities is "InvalidCity123", which will return a 404. With plain Promise.all, a single rejected promise fails everything. Make each weather lookup return a result object ({ ok: true, ... } or { ok: false, error }) instead of throwing, so Promise.all can never reject and the other cities still get processed.

**Prompt 5:**
> Sort the failures into clear types: city not found (404), bad API key (401), rate limited (429), timeout (cancel after 8 seconds with AbortSignal.timeout), and network errors. Log each one to the console and as a JSON line in logs/errors.log, then carry on. Only stop the script if the API key is missing or orders.json can't be read.

**Prompt 6:**
> Write orders.json safely (temp file, then rename) so a crash mid-write can't corrupt it. Add tests for the invalid city, a bad key, a timeout and a dropped connection, all without needing a real API key.

## Apology function

**Prompt 7:**
> Write a weatherApology(order, weather) function that turns the API's weather description into natural wording ("heavy intensity rain" → "heavy rain", Thunderstorm → "a thunderstorm") and returns: "Hi {first name}, your order to {city} is delayed due to {weather}. We appreciate your patience!"

## What I changed or checked myself

- OpenWeatherMap has no "Extreme" weather group any more, so I decided to treat Thunderstorm, Tornado and Squall as extreme.
- The first version of the timeout test hung, because `AbortSignal.timeout` doesn't keep Node's event loop alive on its own. The fake "hanging server" in the test now holds a timer the way a real open socket would.
