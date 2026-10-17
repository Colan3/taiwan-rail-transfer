"""Fetch today's Taiwan rail timetables from TDX into data/trains.json."""
import datetime as dt
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data' / 'trains.json'
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


def token():
    cid = os.environ['TDX_CLIENT_ID']
    secret = os.environ['TDX_CLIENT_SECRET']
    r = requests.post(AUTH, data={'grant_type': 'client_credentials', 'client_id': cid,
                                  'client_secret': secret}, timeout=35)
    r.raise_for_status()
    return r.json()['access_token']


def fetch(operator, date, headers):
    url = f'{BASE}/{operator}/DailyTimetable/TrainDate/{date}'
    r = requests.get(url, headers=headers, params={'$format': 'JSON'}, timeout=120)
    r.raise_for_status()
    value = r.json()
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
                        'arrival': arrive[:5], 'fare': None, 'operator': operator})
            break
    return sorted(out, key=lambda x: (x['departure'], x['trainNo']))


def main():
    now = dt.datetime.now(ZoneInfo('Asia/Taipei'))
    date = now.date().isoformat()
    headers = {'Authorization': 'Bearer ' + token(), 'Accept': 'application/json'}
    datasets = {operator: fetch(operator, date, headers) for operator in ('TRA', 'THSR')}
    routes = {key: extract(datasets[operator], operator, start, end)
              for key, operator, start, end in ROUTES}
    # Fail closed: do not replace yesterday's file with an apparently valid empty timetable.
    empty = [key for key, trains in routes.items() if not trains]
    if empty:
        raise RuntimeError(f'No trains returned for: {empty}. Check TDX schema, permissions and station names.')
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    data = {'date': date, 'updatedAt': now.isoformat(timespec='seconds'),
            'source': 'TDX daily timetable (scheduled, not real-time)', 'routes': routes}
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {OUTPUT}: ' + ', '.join(f'{k}={len(v)}' for k, v in routes.items()))


if __name__ == '__main__':
    main()
