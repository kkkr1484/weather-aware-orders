// Weather-aware apology messages.
// e.g. "Hi Alice, your order to New York is delayed due to heavy rain. We appreciate your patience!"

// Turns OpenWeatherMap's main/description into something a person would say.
function describeWeather(main, description = '') {
  const d = description.toLowerCase();
  switch (main) {
    case 'Rain':
      if (/heavy|extreme|very heavy/.test(d)) return 'heavy rain';
      if (/freezing/.test(d)) return 'freezing rain';
      if (/shower/.test(d)) return 'rain showers';
      if (/light/.test(d)) return 'light rain';
      return 'rain';
    case 'Snow':
      if (/heavy/.test(d)) return 'heavy snow';
      if (/sleet/.test(d)) return 'sleet';
      return 'snow';
    case 'Thunderstorm':
      return 'a thunderstorm';
    case 'Tornado':
      return 'a tornado warning';
    case 'Squall':
      return 'strong squalls';
    default:
      return d || 'bad weather';
  }
}

function firstName(customer) {
  const name = String(customer || '').trim().split(/\s+/)[0];
  return name || 'there';
}

function weatherApology(order, weather) {
  const cause = describeWeather(weather.main, weather.description);
  return `Hi ${firstName(order.customer)}, your order to ${order.city} is delayed due to ${cause}. We appreciate your patience!`;
}

module.exports = { weatherApology, describeWeather, firstName };
