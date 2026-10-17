"""Fetch today and the next 30 days of Taiwan rail timetables from TDX."""
import datetime as dt
import json
import os
import logging
import time
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
OUTPUT = DATA_DIR / 'trains.json'
HORIZON_DAYS = 30
# Always refresh the near future. Cached farther dates reduce TDX request volume.
REFRESH_DAYS = 2
REQUEST_GAP_SECONDS = 0.35
AUTH = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token'
BASE = 'https://tdx.transportdata.tw/api/basic/v2/Rail'
ROUTES = [
    ('tra_1', 'TRA', '竹南', '豐富'),
    ('thsr', 'THSR', '苗栗', '台中'),
    ('tra_2', 'TRA', '新烏日', '二水'),
    ('return_tra_1', 'TRA', '二水', '新烏日'),
    ('return_thsr', 'THSR', '台中', '苗栗'),
    ('return_tra_2', 'TRA', '豐富', '竹南'),
]


SESSION = requests.Session()
SESSION.mount('https://', HTTPAdapter(max_retries=Retry(
    total=5, status=5, connect=3, read=2,
    backoff_factor=2, status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=frozenset(['GET']), respect_retry_after_header=True
)))


def request_json(url, headers, params=None, timeout=65):
    response = SESSION.get(url, headers=headers, params=params, timeout=timeout)
    response.raise_for_status()
    time.sleep(REQUEST_GAP_SECONDS)
    return response.json()


def fare_shape_diagnostic(operator, items):
    """Log only schema and fare classification fields, never credentials."""
    if not items:
        print(f'DIAG {operator}: ODFare returned zero records')
        return
    first = items[0]
    fares = first.get('Fares') or []
    print(f'DIAG {operator}: records={len(items)}, itemKeys={sorted(first.keys())}, '
          f'fareCount={len(fares)}')
    for f in fares[:8]:
        safe = {k: f.get(k) for k in ('TicketType', 'FareClass', 'CabinClass',
                                     'Price', 'TicketTypeName', 'FareClassName') if k in f}
        print(f'DIAG {operator} fareFields: {json.dumps(safe, ensure_ascii=False)}')


def token():
    cid = os.environ['TDX_CLIENT_ID']
    secret = os.environ['TDX_CLIENT_SECRET']
    r = requests.post(AUTH, data={'grant_type': 'client_credentials', 'client_id': cid,
                                  'client_secret': secret}, timeout=35)
    r.raise_for_status()
    return r.json()['access_token']


def fetch(operator, date, headers):
    url = f'{BASE}/{operator}/DailyTimetable/TrainDate/{date}'
    value = request_json(url, headers, params={'$format': 'JSON'}, timeout=120)
    if isinstance(value, dict):
        value = value.get('value', [])
    if not isinstance(value, list):
        raise ValueError(f'Unexpected {operator} timetable response')
    return value


def station_name(stop):
    info = stop.get('StationName') or {}
    if isinstance(info, dict):
        return info.get('Zh_tw', '')
    return str(info)


def extract(entries, operator, origin, destination):
    out = []
    for entry in entries:
        stops = entry.get('StopTimes') or []
        origins = [(i, x) for i, x in enumerate(stops) if station_name(x) == origin]
        dests = [(i, x) for i, x in enumerate(stops) if station_name(x) == destination]
        for i, a in origins:
            later = [b for j, b in dests if j > i]
            if not later:
                continue
            b = later[0]
            depart = a.get('DepartureTime')
            arrive = b.get('ArrivalTime')
            if not depart or not arrive:
                continue
            train_info = entry.get('DailyTrainInfo') or {}
            train_no = train_info.get('TrainNo') or entry.get('TrainNo')
            if not train_no:
                continue
            out.append({'trainNo': str(train_no), 'departure': depart[:5],
                        'arrival': arrive[:5], 'fare': None, 'operator': operator,
                        'trainTypeCode': str(train_info.get('TrainTypeCode') or ''),
                        'trainTypeName': station_name({'StationName': train_info.get('TrainTypeName') or {}})})
            break
    return sorted(out, key=lambda x: (x['departure'], x['trainNo']))



def api_list(path, headers, params=None):
    """Fetch only small station/OD datasets; never download TRA's entire fare matrix."""
    obj = request_json(f'{BASE}/{path}', headers,
                       params={**(params or {}), '$format': 'JSON'})
    if isinstance(obj, dict):
        obj = obj.get('value', obj.get('Stations', obj.get('ODFares', [])))
    if not isinstance(obj, list):
        raise ValueError(f'Unexpected TDX response at {path}')
    return obj


def station_ids(operator, headers):
    stations = api_list(f'{operator}/Station', headers)
    names = {}
    for station in stations:
        zh = (station.get('StationName') or {}).get('Zh_tw', '')
        if zh:
            names[zh] = str(station.get('StationID', ''))
    return names


def adult_oneway_fares(operator, origin_id, destination_id, headers):
    """Read operator-specific adult fares; never infer fares from a cheaper category."""
    items = api_list(f'{operator}/ODFare/{origin_id}/to/{destination_id}', headers)
    fare_shape_diagnostic(operator, items)
    options = []
    for item in items:
        for f in item.get('Fares', []):
            price = f.get('Price')
            if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
                continue
            ticket_type = str(f.get('TicketType', '')).strip()
            if operator == 'THSR':
                if (ticket_type, str(f.get('FareClass')), str(f.get('CabinClass'))) != ('1', '1', '1'):
                    continue
                category = 'THSR_STANDARD'
            else:
                # TDX TRA TicketType uses Chinese text, unlike THSR numeric fields.
                # These are explicitly non-discounted adult codes only.
                category = {
                    '成自': '自強',
                    '成莒': '莒光',
                    '成區': '區間',
                    '成復': '區間',  # TDX legacy fare label: local/fast-local fare class
                    '成普': '普快',
                }.get(ticket_type)
                if category is None:
                    continue
            options.append({'price': int(price), 'category': category, 'ticketType': ticket_type})
    return options


def tra_category(train):
    """Only map train types with a clear ordinary adult fare class."""
    name = str(train.get('trainTypeName') or '').strip()
    if name in ('區間', '區間車', '區間快', '區間快車'):
        return '區間'
    if name in ('莒光', '莒光號'):
        return '莒光'
    if name in ('自強', '自強號'):
        return '自強'
    if name in ('復興', '復興號'):
        return '區間'  # Shares the fare class represented by TDX 成復
    if name in ('普快', '普快車'):
        return '普快'
    # Do not silently assume newer premium trains use the ordinary Tze-Chiang fare.
    return None


def fetch_fare_catalog(headers):
    """Fetch each OD fare only once per run, rather than once per date."""
    stations = {op: station_ids(op, headers) for op in ('TRA', 'THSR')}
    catalogs = {}
    for key, operator, origin, destination in ROUTES:
        try:
            a, b = stations[operator][origin], stations[operator][destination]
            catalogs[key] = adult_oneway_fares(operator, a, b, headers)
            print(f'FARE CATALOG: {key}: {len(catalogs[key])} options', flush=True)
        except (requests.RequestException, KeyError, ValueError, TypeError) as exc:
            catalogs[key] = []
            logging.warning('Fare unavailable for %s: %s', key, exc)
    return catalogs


def assign_fares(routes, catalogs):
    diagnostics = []
    for key, operator, origin, destination in ROUTES:
        fares = catalogs.get(key, [])
        for train in routes[key]:
            if operator == 'TRA':
                category = tra_category(train)
                matches = [f for f in fares if f['category'] == category] if category else []
            else:
                matches = [f for f in fares if f['category'] == 'THSR_STANDARD']
            unique = {f['price'] for f in matches}
            if len(unique) == 1:
                train['fare'] = unique.pop()
        resolved = sum(x['fare'] is not None for x in routes[key])
        diagnostics.append(f'{key}: {resolved}/{len(routes[key])} fares')
    return diagnostics


def load_cached(path, expected_date):
    try:
        obj = json.loads(path.read_text(encoding='utf-8'))
        if obj.get('date') != expected_date or not isinstance(obj.get('routes'), dict):
            return None
        if any(not isinstance(obj['routes'].get(key), list) or not obj['routes'][key]
               for key, _, _, _ in ROUTES):
            return None
        return obj
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def make_day(date, now, headers, catalogs):
    datasets = {operator: fetch(operator, date, headers) for operator in ('TRA', 'THSR')}
    routes = {key: extract(datasets[operator], operator, origin, destination)
              for key, operator, origin, destination in ROUTES}
    missing = [key for key, trains in routes.items() if not trains]
    if missing:
        raise ValueError(f'Incomplete timetable for {date}: {missing}')
    diagnostics = assign_fares(routes, catalogs)
    print(f'{date}: ' + ', '.join(diagnostics), flush=True)
    return {
        'date': date,
        'updatedAt': now.isoformat(timespec='seconds'),
        'source': 'TDX date-specific scheduled timetable and ODFare (not real-time)',
        'farePolicy': 'Adult one-way; THSR standard reserved; TRA explicit fare categories',
        'routes': routes,
    }

def main():
    now = dt.datetime.now(ZoneInfo('Asia/Taipei'))
    today = now.date()
    headers = {'Authorization': 'Bearer ' + token(), 'Accept': 'application/json'}
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # One fare catalog shared by every date. This avoids ~186 extra fare calls.
    catalogs = fetch_fare_catalog(headers)
    available = []
    unavailable = []
    for offset in range(HORIZON_DAYS + 1):
        day = today + dt.timedelta(days=offset)
        date = day.isoformat()
        path = DATA_DIR / f'{date}.json'
        cached = load_cached(path, date)
        if cached is not None and offset > REFRESH_DAYS:
            available.append(date)
            print(f'CACHE: {date} (previously fetched)', flush=True)
            continue
        try:
            obj = make_day(date, now, headers, catalogs)
            write_json(path, obj)
            if offset == 0:
                # Preserve compatibility with the existing V8 URL.
                write_json(OUTPUT, obj)
            available.append(date)
            print(f'OK: {date} -> {path.relative_to(ROOT)}', flush=True)
        except (requests.RequestException, KeyError, ValueError, TypeError) as exc:
            # Do not publish partial or fabricated timetables.
            if cached is not None:
                available.append(date)
                if offset == 0:
                    write_json(OUTPUT, cached)
                logging.warning('Using cached %s after fetch failure: %s', date, exc)
            else:
                unavailable.append(date)
                logging.warning('Date %s unavailable: %s', date, exc)
                if offset == 0:
                    raise RuntimeError('Today has no complete timetable; refusing to publish.') from exc

    # A manifest tells the web page which dates have complete published datasets.
    manifest = {
        'startDate': today.isoformat(),
        'endDate': (today + dt.timedelta(days=HORIZON_DAYS)).isoformat(),
        'updatedAt': now.isoformat(timespec='seconds'),
        'availableDates': available,
        'unavailableDates': unavailable,
    }
    write_json(DATA_DIR / 'dates.json', manifest)
    print(f'DONE: available={len(available)} unavailable={len(unavailable)}', flush=True)


if __name__ == '__main__':
    main()
