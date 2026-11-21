import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import update_trains as updater


class NetworkPublicationTest(unittest.TestCase):
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
