import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import update_trains as updater


class NetworkPublicationTest(unittest.TestCase):
    def test_station_locations_use_county_from_official_address(self):
        stations = [
            {'StationID': '1010', 'StationAddress': '110台北市信義區',
             'StationPosition': {'PositionLat': 25.03}},
            {'StationID': '1030', 'StationAddress': '板橋區',
             'StationPosition': {'PositionLat': 25.01}},
        ]
        self.assertEqual(updater.station_locations('TRA', stations), {
            'TRA:1010': {'county': '臺北市', 'latitude': 25.03}
        })

    def test_adult_fares_cover_standard_express_train_variants(self):
        for name, expected in [
            ('自強（3000）', '自強'), ('自強(推拉式自強號且無自行車車廂)', '自強'),
            ('普悠瑪', '自強'), ('太魯閣號', '自強'), ('莒光(無身障座位)', '莒光'),
            ('區間快', '區間'), ('莒光（郵輪式觀光）', None), ('未知車種', None),
        ]:
            with self.subTest(name=name):
                self.assertEqual(updater.tra_category({'trainTypeName': name}), expected)

    def test_future_files_beyond_today_plus_seven_are_retired(self):
        today = dt.date(2026, 11, 21)
        end = today + dt.timedelta(days=updater.HORIZON_DAYS)
        self.assertEqual(end.isoformat(), '2026-11-28')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            network = root / 'network'
            network.mkdir()
            for folder in (root, network):
                for name in ('dates.json', '2026-11-20.json', '2026-11-28.json', '2026-11-29.json'):
                    (folder / name).touch()
            with patch.object(updater, 'DATA_DIR', root):
                updater.retire_future_files(end)
            for folder in (root, network):
                self.assertEqual(sorted(path.name for path in folder.glob('*.json')),
                                 ['2026-11-20.json', '2026-11-28.json', 'dates.json'])

    def test_publish_legacy_and_network_from_same_timetable(self):
        datasets = {'TRA': [], 'THSR': []}
        catalogs = {}
        for index, (key, operator, origin, destination) in enumerate(updater.ROUTES):
            stations = sorted({name for _, op, *names in updater.ROUTES
                               if op == operator for name in names})
            stops = [
                {'StopSequence': seq, 'StationID': str(stations.index(name)),
                 'StationName': {'Zh_tw': name}, 'ArrivalTime': time, 'DepartureTime': time}
                for seq, name, time in [(1, origin, '17:00'), (2, destination, '17:30')]
            ]
            datasets[operator].append({
                'DailyTrainInfo': {'TrainNo': str(index), 'TrainTypeName': {'Zh_tw': '區間'}},
                'StopTimes': stops,
            })
            catalogs[key] = [{'price': 75, 'category': '區間' if operator == 'TRA' else 'THSR_STANDARD'}]
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(updater, 'DATA_DIR', Path(directory)), patch.object(
                updater, 'fetch', side_effect=lambda operator, *_: datasets[operator]
            ):
                legacy = updater.make_day('2026-11-21', dt.datetime(2026, 11, 21), {}, catalogs)
            network = json.loads((Path(directory) / 'network/2026-11-21.json').read_text(encoding='utf-8'))
        self.assertEqual(len(legacy['routes']), 6)
        self.assertEqual(len(network['trains']), 6)
        self.assertEqual(len(network['fares']), 6)
        self.assertTrue(all(fare == 75 for fare in network['fares'].values()))
        self.assertIn('THSR:0', network['stations'])
        self.assertIn('TRA:0', network['stations'])

    def test_catalog_keeps_only_adult_and_unambiguous_fares(self):
        adult = {'TicketType': 1, 'FareClass': 1, 'CabinClass': 1, 'Price': 200}
        unwanted = {**adult, 'TicketType': 2, 'Price': 100}
        first = {'OriginStationID': '1', 'DestinationStationID': '2', 'Fares': [adult, unwanted]}
        second = {**first, 'Fares': [{**adult, 'Price': 210}]}
        with tempfile.TemporaryDirectory() as directory:
            def read_page(path, headers, params):
                return [first, second] if path == 'THSR/ODFare' and params['$skip'] == 0 else []

            with patch.object(updater, 'DATA_DIR', Path(directory)), patch.object(
                updater, 'api_list', side_effect=read_page
            ):
                updater.refresh_network_fares({}, dt.date(2026, 11, 21))
            catalog = json.loads((Path(directory) / 'network-fares.json').read_text(encoding='utf-8'))
        self.assertEqual(catalog['fares'], {'THSR:1/THSR:2/THSR_STANDARD': None})
