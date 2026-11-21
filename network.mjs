const WALK_LINKS = [
  ['南港', '南港', 10], ['台北', '台北', 12], ['板橋', '板橋', 10],
  ['六家', '新竹', 10], ['豐富', '苗栗', 15], ['新烏日', '台中', 15],
  ['沙崙', '台南', 12], ['新左營', '左營', 12],
];
const SAME_STATION_WALK = 5;
export const MAX_WAIT = 90;

const canonical = name => name.replaceAll('臺', '台');
const first = plan => plan.ride;

export function regularServices(day) {
  // TDX publishes charter services in the timetable, but they use separate
  // group or tour sales and do not accept standard origin–destination fares.
  const trains = day.trains.filter(([operator, , , , name]) =>
    operator !== 'TRA' || !/專開/.test(name ?? ''));
  const served = new Set();
  for (const [, , , stops] of trains) {
    for (const [station] of stops) served.add(station);
  }
  const stations = Object.fromEntries(Object.entries(day.stations).filter(([id]) => served.has(id)));
  return {...day, stations, trains};
}

export const byArrival = (a, b) =>
  a.arrival - b.arrival || b.departure - a.departure || a.legs - b.legs;
const suffixArrival = (a, b) => a.arrival - b.arrival || a.legs - b.legs || byArrival(a, b);

function take(list, plan, compare) {
  const index = list.findIndex(item => compare(plan, item) < 0);
  if (index === -1) {
    if (list.length < 3) list.push(plan);
    return;
  }
  list.splice(index, 0, plan);
  if (list.length > 3) list.pop();
}

function offer(ranking, plan, compare = byArrival) {
  take(ranking.arrival, plan, compare);
  if (plan.price !== null) take(ranking.price, plan, (a, b) => a.price - b.price || compare(a, b));
}

const ranking = () => ({arrival: [], price: []});
const frontier = rank => new Set([...rank.arrival, ...rank.price]);

function makeLinks(stations) {
  const links = new Map(Object.keys(stations).map(id => [id, [[id, SAME_STATION_WALK]]]));
  const byName = new Map(Object.entries(stations).map(([id, name]) => [
    id.split(':')[0] + ':' + canonical(name), id,
  ]));
  for (const [tra, thsr, walk] of WALK_LINKS) {
    const a = byName.get('TRA:' + tra), b = byName.get('THSR:' + thsr);
    if (a && b) {
      links.get(a).push([b, walk]);
      links.get(b).push([a, walk]);
    }
  }
  return links;
}

function toMinutes(value, previous) {
  const match = /^(\d{2}):([0-5]\d)(?::[0-5]\d)?$/.exec(value ?? '');
  if (!match) return null;
  const clock = Number(match[1]) * 60 + Number(match[2]);
  if (clock >= 2880) return null;
  const day = Math.max(0, Math.ceil((previous - clock) / 1440));
  return clock + day * 1440;
}

function indexTrains(days, stations) {
  const events = [];
  const departures = new Map(Object.keys(stations).map(id => [id, []]));
  days.forEach((day, index) => {
    for (const [operator, number, category, rawStops, name] of day.trains) {
      const train = {operator, number, category, name, fares: day.fares ?? {}, stops: []};
      let previous = 0;
      for (const [station, rawArrival, rawDeparture] of rawStops) {
        const arrival = toMinutes(rawArrival, previous);
        const departure = toMinutes(rawDeparture, arrival ?? previous);
        previous = departure ?? arrival ?? previous;
        train.stops.push({
          station,
          arrival: arrival === null ? null : arrival + 1440 * index,
          departure: departure === null ? null : departure + 1440 * index,
          onward: null,
        });
      }
      train.stops.slice(0, -1).forEach((stop, position) => {
        if (stop.departure === null) return;
        const event = {train, position, ...stop, best: ranking()};
        events.push(event);
        departures.get(stop.station).push(event);
      });
    }
  });
  for (const list of departures.values()) list.sort((a, b) => a.departure - b.departure);
  return {events: events.sort((a, b) => b.departure - a.departure), departures};
}

function firstAtOrAfter(list, time) {
  let low = 0, high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid].departure < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function onwardAt(stop, train, links, departures) {
  if (stop.onward) return stop.onward;
  const best = ranking();
  for (const [station, walk] of links.get(stop.station)) {
    const events = departures.get(station);
    const ready = stop.arrival + walk;
    for (let i = firstAtOrAfter(events, ready); i < events.length; i++) {
      const option = events[i];
      if (option.departure > ready + MAX_WAIT) break;
      if (option.train === train) continue;
      for (const plan of frontier(option.best)) offer(best, plan, suffixArrival);
    }
  }
  stop.onward = [...frontier(best)];
  return stop.onward;
}

function ticket(event, stop, catalog) {
  const {operator, number, category, fares} = event.train;
  const route = event.station + '/' + stop.station;
  return fares[operator + '/' + number + '/' + route] ??
    catalog[route + '/' + (operator === 'THSR' ? 'THSR_STANDARD' : category)] ?? null;
}

export function searchNetwork(days, origin, destination, earliest, catalog = {}) {
  const result = {all: ranking(), direct: ranking(), transfer: ranking()};
  const stations = Object.assign({}, ...days.map(day => day.stations));
  if (origin === destination || !Object.hasOwn(stations, origin) ||
      !Object.hasOwn(stations, destination)) return result;
  const links = makeLinks(stations);
  const startWalks = new Map(links.get(origin));
  const endWalks = new Map(links.get(destination));
  startWalks.set(origin, 0);
  endWalks.set(destination, 0);
  const {events, departures} = indexTrains(days, stations);
  // Every connection departs after the incoming boarding event. Processing in
  // reverse time makes each continuation final before a feeder evaluates it.
  for (const event of events) {
    if (event.departure < earliest) break;
    const startWalk = startWalks.get(event.station);
    const isStart = startWalk !== undefined && event.departure < 1440 &&
      event.departure - startWalk >= earliest;
    const {train} = event;
    for (let i = event.position + 1; i < train.stops.length; i++) {
      const stop = train.stops[i];
      // A return to the original departure station cannot improve a journey.
      if (stop.station === origin) break;
      if (stop.arrival === null || stop.arrival <= event.departure) continue;
      const endWalk = endWalks.get(stop.station);
      const nextPlans = stop.station === destination ? [null] :
        onwardAt(stop, train, links, departures).concat(endWalk === undefined ? [] : [null]);
      if (!nextPlans.length) continue;
      const ride = {
        operator: train.operator, number: train.number, name: train.name, from: event.station,
        to: stop.station, departure: event.departure, arrival: stop.arrival,
        fare: ticket(event, stop, catalog),
      };
      for (const next of nextPlans) {
        const price = ride.fare === null || (next && next.price === null)
          ? null : ride.fare + (next?.price ?? 0);
        const walk = next ? links.get(stop.station).find(([id]) => id === first(next).from)[1] : 0;
        const wait = next ? first(next).departure - stop.arrival - walk : 0;
        const plan = {ride, next, walk, wait, price, departure: ride.departure,
          endWalk: next ? 0 : endWalk, destination,
          arrival: next?.arrival ?? stop.arrival + endWalk,
          legs: 1 + (next?.legs ?? 0)};
        offer(event.best, plan);
        if (isStart) {
          const journey = {...plan, startWalk, origin, departure: plan.departure - startWalk};
          offer(result.all, journey);
          offer(next ? result.transfer : result.direct, journey);
        }
      }
      if (stop.station === destination) break;
    }
  }
  return result;
}
