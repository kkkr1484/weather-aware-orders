// Checks the weather for every order's city (all at once), marks orders as
// Delayed when the weather is bad, writes an apology for each delayed order,
// and logs, but survives, cities that can't be looked up.
//
// Usage: node index.js            (reads and updates ./orders.json)
//        node index.js --dry-run  (prints the result, doesn't save)

const fs = require('fs');
const path = require('path');
const { fetchAllWeather, causesDelay } = require('./lib/weather');
const { weatherApology } = require('./lib/apology');

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const ERROR_LOG = path.join(__dirname, 'logs', 'errors.log');

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`,
};

function loadApiKey() {
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch {
    // no .env file. Fall through, the key may already be in the environment.
  }
  const key = process.env.OPENWEATHER_API_KEY?.trim();
  if (!key) {
    console.error(c.red('Missing OPENWEATHER_API_KEY. Copy .env.example to .env and add your key.'));
    process.exit(1);
  }
  return key;
}

function logError(order, result) {
  const entry = {
    time: new Date().toISOString(),
    order_id: order.order_id,
    city: order.city,
    kind: result.error.kind,
    status: result.error.status ?? null,
    message: result.error.message,
  };
  fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
  fs.appendFileSync(ERROR_LOG, JSON.stringify(entry) + '\n');
  console.error(`  ${c.red('✗')} ${order.order_id}  ${order.city.padEnd(15)} ${c.red(result.error.message)} ${c.dim('→ logged to logs/errors.log, skipping')}`);
}

// Write to a temp file and rename, so a crash mid-write can't leave a broken orders.json.
function saveOrders(orders) {
  const tmp = ORDERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2) + '\n');
  fs.renameSync(tmp, ORDERS_FILE);
}

async function processOrders(orders, apiKey, { onError = logError, ...opts } = {}) {
  const t0 = Date.now();
  const weather = await fetchAllWeather(orders.map(o => o.city), apiKey, opts);
  const elapsed = Date.now() - t0;

  const summary = { delayed: 0, onTime: 0, failed: 0, elapsed, calls: weather.size };
  const updated = orders.map(order => {
    const result = weather.get(order.city);
    if (!result.ok) {
      summary.failed++;
      onError(order, result);
      return order; // leave it untouched, we couldn't check it
    }

    const label = `${result.main} (${result.description}, ${Math.round(result.tempC)}°C)`;
    if (causesDelay(result.main)) {
      summary.delayed++;
      const message = weatherApology(order, result);
      console.log(`  ${c.yellow('!')} ${order.order_id}  ${order.city.padEnd(15)} ${c.yellow(label)} → ${c.bold(c.yellow('Delayed'))}`);
      console.log(`         ${c.cyan('“' + message + '”')}`);
      return { ...order, status: 'Delayed', weather: result.main, apology: message };
    }

    summary.onTime++;
    console.log(`  ${c.green('✓')} ${order.order_id}  ${order.city.padEnd(15)} ${c.green(label)} ${c.dim('→ no delay')}`);
    return { ...order, weather: result.main };
  });

  return { updated, summary, weather };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apiKey = loadApiKey();
  const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));

  const cities = [...new Set(orders.map(o => o.city))];
  console.log(c.bold(`\nChecking weather for ${orders.length} orders (${cities.length} cities), all requests in parallel...\n`));

  const { updated, summary, weather } = await processOrders(orders, apiKey);

  const slowest = Math.max(...[...weather.values()].map(r => r.ms));
  console.log(c.dim(`\n  ${summary.calls} API calls fired together: finished in ${summary.elapsed} ms (slowest single call: ${slowest} ms)`));
  console.log(`  ${c.yellow(summary.delayed + ' delayed')}, ${c.green(summary.onTime + ' on time')}, ${c.red(summary.failed + ' failed')}`);
  if ([...weather.values()].some(r => r.error?.kind === 'auth')) {
    console.log(c.dim('  Tip: brand-new OpenWeatherMap keys can take up to 2 hours to activate.'));
  }

  if (dryRun) {
    console.log(c.dim('\n  --dry-run: orders.json not changed'));
  } else {
    saveOrders(updated);
    console.log(c.dim('\n  orders.json updated'));
  }
  console.log();
}

if (require.main === module) {
  main().catch(err => {
    // Anything that reaches here is a real bug (bad JSON, unreadable file),
    // not a weather lookup failure. Those are handled per city above.
    console.error(c.red(`Fatal: ${err.message}`));
    process.exit(1);
  });
}

module.exports = { processOrders };
