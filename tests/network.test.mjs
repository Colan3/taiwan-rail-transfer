import assert from 'node:assert/strict';
import {searchNetwork} from '../network.mjs';
const O='TRA:o', A='TRA:a', H='THSR:h', D='THSR:d', B='TRA:b';
const stations={[O]:'竹南',[A]:'豐富',[H]:'苗栗',[D]:'台中',[B]:'二水'};
const train=(op,no,times)=>[op,no,'區間',times.map(([id,t])=>[id,t,t])];
const t=(no,times)=>train('TRA', no, times);
const h=(no,times)=>train('THSR', no, times);
const dataset={stations,trains:[
  t('A',[[O,'17:00'],[A,'17:20']]),
  t('direct',[[O,'17:20'],[B,'18:40']]),
  t('local',[[A,'17:25'],[B,'18:20']]),
  h('short',[[H,'17:34'],[D,'17:50']]),
  h('good',[[H,'17:35'],[D,'18:00']]),
  h('late',[[H,'19:06'],[D,'19:30']]),
]};
const fares={
  [O+'/'+A+'/區間']: 20, [A+'/'+B+'/區間']: 60, [O+'/'+B+'/區間']: 70,
  [H+'/'+D+'/THSR_STANDARD']: 130,
};
const transfer=searchNetwork([dataset], O,D,1020,fares);
assert.deepEqual(transfer.all.arrival.map(p=>p.next.ride.number), ['good']);
assert.equal(transfer.all.arrival[0].walk,15);
assert.equal(transfer.all.arrival[0].wait,0);
assert.equal(transfer.all.price[0].price,150);
assert.equal(transfer.direct.arrival.length,0);
const comparison=searchNetwork([dataset], O,B,1020,fares);
assert.equal(comparison.all.arrival[0].legs,2);
assert.equal(comparison.all.price[0].ride.number,'direct');
assert.equal(comparison.direct.arrival[0].arrival,1120);
assert.equal(searchNetwork([dataset],O,D,1021).all.arrival.length,0);
assert.equal(searchNetwork([dataset],O,D,1020).all.price.length,0);
assert.equal(searchNetwork([dataset],D,O,0).all.arrival.length,0);
assert.equal(searchNetwork([dataset],O,O,0).all.arrival.length,0);
const night={stations,trains:[t('night',[[O,'23:55'],[A,'00:03']])]};
const following={stations,trains:[
  h('false',[[H,'00:17'],[D,'00:30']]),
  h('next',[[H,'00:18'],[D,'00:45']]),
]};
assert.equal(searchNetwork([night], O,D,0).all.arrival.length,0);
const overnight=searchNetwork([night,following], O,D,0).all.arrival[0];
assert.equal(overnight.next.ride.number,'next');
assert.equal(overnight.arrival,1485);
assert.equal(searchNetwork([night,following], H,D,0).all.arrival.length,0);
const fourLegs={stations,trains:[
 t('one',[[O,'17:00'],[B,'17:08']]), t('two',[[B,'17:13'],[A,'17:20']]),
 h('three',[[H,'17:35'],[D,'18:00']]), h('four',[[D,'18:05'],['THSR:e','18:20']]),
]};
fourLegs.stations={...stations,'THSR:e':'左營'};
assert.equal(searchNetwork([fourLegs],O,'THSR:e',0).all.arrival[0].legs,4);
const terminalWalks = {
  stations: {...stations, 'TRA:w': '新烏日'},
  trains: [h('walk-direct', [[H, '17:35'], [D, '18:00']])],
};
const withWalks = searchNetwork([terminalWalks], A, 'TRA:w', 1020, fares).direct.arrival[0];
assert.equal(withWalks.startWalk, 15);
assert.equal(withWalks.departure, 1040);
assert.equal(withWalks.endWalk, 15);
assert.equal(withWalks.arrival, 1095);
assert.equal(withWalks.price, 130);
assert.equal(searchNetwork([terminalWalks], A, 'TRA:w', 1041).all.arrival.length, 0);
console.log('routing assertions passed');
