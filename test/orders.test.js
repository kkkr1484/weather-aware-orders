// Runs the real logic against a fake fetch, so these tests don't need an API
// key and give the same result whatever the weather is today.
const test = require('node:test');
const assert = require('node:assert/strict');
const { processOrders } = require('../index');
const { fetchWeather } = require('../lib/weather');
const { weatherApology, describeWeather } = require('../lib/apology');
const orders = require('../orders.original.json');

const reply = (status, body) => ({ ok: status < 400, status, statusText: '', json: async () => body });
const weatherBody = (name, main, description, temp = 12) => ({ name, weather: [{ main, description }], main: { temp } });

// Fake OpenWeatherMap: each city answers after a delay, and we record when
// every request started and finished.
function fakeApi(table, delayMs = 50) {
  const calls = [];
  const fetchImpl = (url) => {
    const city = new URL(url).searchParams.get('q');
    const call = { city, start: Date.now(), end: null };
    calls.push(call);
    return new Promise(resolve => setTimeout(() => {
      call.end = Date.now();
      resolve(table[city] ?? reply(404, { cod: '404', message: 'city not found' }));
    }, delayMs));
  };
  return { fetchImpl, calls };
}

const quiet = { onError: () => {} };
const silence = () => { const log = console.log, err = console.error; console.log = console.error = () => {}; return () => { console.log = log; console.error = err; }; };

test('all weather requests start before any of them finishes (parallel, not one by one)', async () => {
  const api = fakeApi({
    'New York': reply(200, weatherBody('New York', 'Clear', 'clear sky')),
    'Mumbai': reply(200, weatherBody('Mumbai', 'Clouds', 'few clouds')),
    'London': reply(200, weatherBody('London', 'Rain', 'light rain')),
  }, 120);
  const restore = silence();
  const t0 = Date.now();
  await processOrders(orders, 'test-key', { ...quiet, fetchImpl: api.fetchImpl });
  restore();

  assert.equal(api.calls.length, 4);
  const firstEnd = Math.min(...api.calls.map(c => c.end));
  assert.ok(api.calls.every(c => c.start < firstEnd), 'a request started only after another had finished');
  // 4 calls x 120 ms would take ~480 ms one by one. Together it's ~120 ms.
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms, looks sequential`);
});

test('Rain, Snow and extreme weather mark the order Delayed with an apology; others stay Pending', async () => {
  const api = fakeApi({
    'New York': reply(200, weatherBody('New York', 'Snow', 'heavy snow', -3)),
    'Mumbai': reply(200, weatherBody('Mumbai', 'Thunderstorm', 'thunderstorm with heavy rain', 29)),
    'London': reply(200, weatherBody('London', 'Clouds', 'overcast clouds')),
  });
  const restore = silence();
  const { updated, summary } = await processOrders(orders, 'k', { ...quiet, fetchImpl: api.fetchImpl });
  restore();

  const byId = Object.fromEntries(updated.map(o => [o.order_id, o]));
  assert.equal(byId['1001'].status, 'Delayed');
  assert.equal(byId['1001'].apology, 'Hi Alice, your order to New York is delayed due to heavy snow. We appreciate your patience!');
  assert.equal(byId['1002'].status, 'Delayed');
  assert.match(byId['1002'].apology, /^Hi Bob, .*thunderstorm/);
  assert.equal(byId['1003'].status, 'Pending');
  assert.equal(byId['1003'].apology, undefined);
  assert.deepEqual([summary.delayed, summary.onTime, summary.failed], [2, 1, 1]);
});

test('InvalidCity123 is logged and skipped. The other cities still get processed', async () => {
  const api = fakeApi({
    'New York': reply(200, weatherBody('New York', 'Rain', 'heavy intensity rain')),
    'Mumbai': reply(200, weatherBody('Mumbai', 'Clear', 'clear sky')),
    'London': reply(200, weatherBody('London', 'Drizzle', 'light drizzle')),
  });
  const errors = [];
  const restore = silence();
  const { updated } = await processOrders(orders, 'k', { onError: (o, r) => errors.push([o.order_id, r.error.kind]), fetchImpl: api.fetchImpl });
  restore();

  assert.deepEqual(errors, [['1004', 'not_found']]);
  assert.equal(updated.length, 4);
  assert.deepEqual(updated.find(o => o.order_id === '1004'), orders.find(o => o.order_id === '1004'));
  assert.equal(updated.find(o => o.order_id === '1001').status, 'Delayed');
});

test('a bad key, a timeout and a dropped connection all come back as errors instead of crashing', async () => {
  const badKey = await fetchWeather('London', 'nope', { fetchImpl: async () => reply(401, { message: 'Invalid API key' }) });
  assert.equal(badKey.ok, false); assert.equal(badKey.error.kind, 'auth');

  // A server that never answers. The timer stands in for the open socket a real
  // fetch would hold. Without it Node exits before the abort fires.
  const hang = (url, { signal }) => new Promise((_, reject) => {
    const socket = setTimeout(() => {}, 10_000);
    signal.addEventListener('abort', () => { clearTimeout(socket); reject(signal.reason); });
  });
  const slow = await fetchWeather('London', 'k', { fetchImpl: hang, timeoutMs: 50 });
  assert.equal(slow.ok, false); assert.equal(slow.error.kind, 'timeout');

  const offline = await fetchWeather('London', 'k', { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(offline.ok, false); assert.equal(offline.error.kind, 'network');
});

test('apology wording follows the actual weather', () => {
  const order = { customer: 'Alice Smith', city: 'New York' };
  assert.equal(weatherApology(order, { main: 'Rain', description: 'heavy intensity rain' }),
    'Hi Alice, your order to New York is delayed due to heavy rain. We appreciate your patience!');
  assert.equal(describeWeather('Rain', 'light rain'), 'light rain');
  assert.equal(describeWeather('Snow', 'light snow'), 'snow');
  assert.equal(describeWeather('Tornado', 'tornado'), 'a tornado warning');
});
