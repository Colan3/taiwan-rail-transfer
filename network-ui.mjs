import {searchNetwork} from './network.mjs';

const get = id => document.getElementById(id);
const operator = code => code === 'TRA' ? '台鐵' : '高鐵';
const formatTime = minute => {
  const pad = value => String(value).padStart(2, '0');
  const day = Math.floor(minute / 1440);
  return (day ? `+${day} 日 ` : '') +
    `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;
};
const fare = amount => amount === null ? '票價待確認' : `NT$ ${amount}`;
const stationLabel = (id, stations) => `${operator(id.split(':')[0])} ${stations[id]}`;
let enabled = false, sequence = 0, sort = 'arrival';
let days = [], stations = {}, catalog = {}, results = null;

function writePlan(plan) {
  const lines = [];
  if (plan.startWalk) {
    lines.push(`步行 ${formatTime(plan.departure)}｜${stationLabel(plan.origin, stations)} → ${stationLabel(plan.ride.from, stations)}｜預留 ${plan.startWalk} 分鐘`);
  }
  for (let leg = plan; leg; leg = leg.next) {
    const {ride} = leg;
    lines.push(`${operator(ride.operator)} ${ride.number} 次｜${stations[ride.from]} ${formatTime(ride.departure)} → ${stations[ride.to]} ${formatTime(ride.arrival)}｜${fare(ride.fare)}`);
    if (leg.next) {
      const interchange = ride.to === leg.next.ride.from ? stations[ride.to] :
        `${stationLabel(ride.to, stations)} → ${stationLabel(leg.next.ride.from, stations)}`;
      lines.push(`轉乘 ${interchange}｜步行預留 ${leg.walk} 分鐘、候車 ${leg.wait} 分鐘`);
    }
    if (leg.endWalk) {
      lines.push(`步行至 ${stationLabel(leg.destination, stations)}｜預留 ${leg.endWalk} 分鐘｜${formatTime(leg.arrival)} 抵達`);
    }
  }
  return lines.join('\n');
}

function apply(plan) {
  get('networkFeedback').textContent = '';
  get('networkCopy').disabled = !plan;
  if (!plan) {
    get('networkSummary').textContent = '請先套用方案。';
    get('networkPreview').value = '';
    return;
  }
  const details = `${writePlan(plan)}\n\n全程 ${plan.arrival - plan.departure} 分鐘｜成人全票 ${fare(plan.price)}`;
  get('networkSummary').textContent = details;
  get('networkPreview').value = `台灣鐵路行程\n搭乘日期 ${get('date').value}\n${details}\n\n資料為預定時刻表，搭車前請確認官方資訊。`;
}

function render() {
  const area = get('networkComparison');
  area.replaceChildren();
  get('networkRecommend').disabled = !results?.all.arrival.length;
  for (const [id, value] of [['networkArrival', 'arrival'], ['networkPrice', 'price']]) {
    get(id).classList.toggle('active', sort === value);
    get(id).setAttribute('aria-pressed', String(sort === value));
    get(id).disabled = !results;
  }
  if (!results) return;
  function append(tag, content, parent, className = '') {
    const element = document.createElement(tag);
    element.textContent = content;
    element.className = className;
    parent.append(element);
    return element;
  }
  for (const [key, title] of [['all', '綜合 TOP 3'], ['direct', '直達 TOP 3'], ['transfer', '轉乘 TOP 3']]) {
    append('h3', title, area);
    const plans = results[key][sort];
    if (!plans.length) {
      append('p', results[key].arrival.length ? '這類方案的成人票價尚未完整。' : '沒有符合條件的班次。', area, 'muted');
    }
    for (const [index, plan] of plans.entries()) {
      const card = append('article', '', area, 'plan');
      append('h4', `第 ${index + 1} 名 · ${formatTime(plan.departure)} → ${formatTime(plan.arrival)}｜${fare(plan.price)}`, card);
      append('p', `全程 ${plan.arrival - plan.departure} 分鐘｜${plan.legs === 1 ? '直達' : `轉乘 ${plan.legs - 1} 次`}`, card, 'plan-metrics');
      append('p', writePlan(plan), card, 'plan-lines');
      const button = append('button', '套用這組', card);
      button.type = 'button';
      button.addEventListener('click', () => apply(plan));
    }
  }
}

function query() {
  apply(null);
  results = null;
  const origin = get('origin').value, destination = get('destination').value;
  if (days.length && origin && destination && origin !== destination) {
    const earliest = Number(get('hour').value) * 60 + Number(get('minute').value);
    results = searchNetwork(days, origin, destination, earliest, catalog);
  }
  if (days.length) {
    get('networkStatus').textContent = origin && origin === destination ?
      '出發站與抵達站需要不同。' :
      `已載入 ${days[0].date} 預定班次${days.length > 1 ? '及次日銜接班次' : '。次日班次未發布'}。`;
  }
  render();
}

function populate(id, fallback) {
  const select = get(id), previous = select.value;
  select.replaceChildren(new Option('請選擇車站', ''));
  for (const code of ['TRA', 'THSR']) {
    const group = document.createElement('optgroup');
    group.label = operator(code);
    const entries = Object.entries(stations).filter(([station]) => station.startsWith(code + ':'));
    entries.sort((a, b) => a[1].localeCompare(b[1], 'zh-TW'));
    for (const [station, name] of entries) group.append(new Option(name, station));
    select.append(group);
  }
  select.value = stations[previous] ? previous :
    Object.keys(stations).find(key => key.startsWith('TRA:') && stations[key] === fallback) ?? '';
}

async function readJson(path) {
  const response = await fetch(path, {cache: 'no-cache'});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function readDay(date) {
  const data = await readJson(`data/network/${date}.json`);
  if (data.version !== 1 || data.date !== date || !data.stations || !data.trains?.length) {
    throw new Error('全站班次格式或日期不符');
  }
  return data;
}

async function load() {
  const request = ++sequence, date = get('date').value;
  days = [];
  for (const id of ['origin', 'destination', 'swapStations']) get(id).disabled = true;
  get('networkStatus').textContent = `正在載入 ${date} 的全站班次…`;
  query();
  const next = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(next.getTime())) {
    get('networkStatus').textContent = '請選擇搭乘日期。';
    return;
  }
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  try {
    const [day, tomorrow, fares] = await Promise.all([
      readDay(date),
      nextDate <= get('date').max ? readDay(nextDate).catch(() => null) : null,
      readJson('data/network-fares.json').catch(() => null),
    ]);
    if (request !== sequence) return;
    days = tomorrow ? [day, tomorrow] : [day];
    stations = day.stations;
    catalog = fares?.fares ?? {};
    populate('origin', '竹南');
    populate('destination', '二水');
    for (const id of ['origin', 'destination', 'swapStations']) get(id).disabled = false;
    query();
  } catch (error) {
    if (request !== sequence) return;
    get('networkStatus').textContent = `${date} 無法載入全站班次（${error.message}）。請改選日期或在資料更新後重試。`;
  }
}

function setMode(network) {
  if (enabled === network) return;
  enabled = network;
  for (const id of ['legacyDirection', 'legacyWalk', 'legacyResults']) get(id).hidden = network;
  for (const id of ['networkStations', 'networkResults']) get(id).hidden = !network;
  for (const [id, active] of [['legacyMode', !network], ['networkMode', network]]) {
    get(id).classList.toggle('active', active);
    get(id).setAttribute('aria-pressed', String(active));
  }
  for (const [legacy, general] of [['plans', 'networkPlans'], ['tripSummary', 'networkTrip'], ['shareCard', 'networkShare']]) {
    const link = document.querySelector(`.mobile-dock a[href="#${network ? legacy : general}"]`);
    link.href = '#' + (network ? general : legacy);
  }
  if (network) load();
  else sequence++;
}

get('legacyMode').addEventListener('click', () => setMode(false));
get('networkMode').addEventListener('click', () => setMode(true));
get('date').addEventListener('change', () => { if (enabled) load(); });
get('reloadNetwork').addEventListener('click', load);
for (const id of ['origin', 'destination', 'hour', 'minute']) {
  get(id).addEventListener('change', () => { if (enabled) query(); });
}
get('swapStations').addEventListener('click', () => {
  const origin = get('origin'), destination = get('destination');
  [origin.value, destination.value] = [destination.value, origin.value];
  query();
});
for (const [id, value] of [['networkArrival', 'arrival'], ['networkPrice', 'price']]) {
  get(id).addEventListener('click', () => { sort = value; render(); });
}
get('networkRecommend').addEventListener('click', () => apply(results.all.arrival[0]));
get('networkCopy').addEventListener('click', async () => {
  const preview = get('networkPreview');
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(preview.value);
    } else {
      preview.focus();
      preview.select();
      if (!document.execCommand('copy')) throw Error('Clipboard unavailable');
    }
    get('networkFeedback').textContent = '已複製行程';
  } catch {
    preview.focus();
    preview.select();
    get('networkFeedback').textContent = '請手動複製已選取的行程文字。';
  }
});
