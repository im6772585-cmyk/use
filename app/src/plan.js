// 길찾기: ① 대중교통+타슈 ② 대중교통 ③ 타슈 — 세 경로를 같은 형식으로 계산
import L from 'leaflet';
import { STATIONS } from './data.js';
import { ROAD_LV } from './congestion.js';

export const dist = (a, b) => L.latLng(a).distanceTo(L.latLng(b)) / 1000; // km
const mins = (km, kmh) => Math.max(1, Math.round((km / kmh) * 60));

// 기존 분석과 같은 기준
export const BIKE_SPD = [13, 12, 10, 8];   // 도로 혼잡 단계별 자전거 속도 (원활·서행·혼잡·정체)
const BIKEWAY_SPD = 16;                    // 자전거길
const PEN = [0, 0.4, 1.8, 4];              // 혼잡 회피 비용 패널티
const BUS_SPD = [20, 15, 11, 8];           // 단계별 시내버스 속도
const WALK = 4.5;
export const KCAL_PER_KM = 30, CO2_G_PER_KM = 125; // 타슈 1km당 소모 칼로리, 승용차 대비 탄소 감축
const MIN_PER_STATION = 2, SUBWAY_WAIT = 4;

// 대전 도시철도 1호선 (판암 → 반석). 좌표 출처: Wikidata
export const SUBWAY = [
  ['판암역', 36.3169, 127.458], ['신흥역', 36.3196, 127.449], ['대동역', 36.3295, 127.443], ['대전역', 36.3313, 127.433],
  ['중앙로역', 36.3286, 127.426], ['중구청역', 36.3249, 127.42], ['서대전네거리역', 36.3224, 127.413], ['오룡역', 36.3283, 127.405],
  ['용문역', 36.3382, 127.393], ['탄방역', 36.3454, 127.385], ['시청역', 36.3514, 127.387], ['정부청사역', 36.3577, 127.381],
  ['갈마역', 36.3575, 127.373], ['월평역', 36.3583, 127.364], ['갑천역', 36.3542, 127.355], ['유성온천역', 36.3537, 127.341],
  ['구암역', 36.3566, 127.331], ['현충원역', 36.359, 127.321], ['월드컵경기장역', 36.3669, 127.318], ['노은역', 36.3741, 127.318],
  ['지족역', 36.3841, 127.32], ['반석역', 36.3921, 127.315],
].map(([name, lat, lon], idx) => ({ name, pos: [lat, lon], idx }));

export const TASHU = STATIONS.map(([id, name, addr, dong, lat, lon, rents]) => ({ id, name, addr, dong, pos: [lat, lon], rents, total: rents[0] + rents[1] + rents[2] }));
export const nearest = (list, p) => list.reduce((b, s) => { const d = dist(p, s.pos); return !b || d < b.d ? { ...s, d } : b; }, null);

// 환승 대여소: 역에서 걸어서 3분(약 220m) 안. 대여·반납이 많아 자전거가 잘 있는 곳 우선
export const TRANSFER = SUBWAY.map((s) => {
  const near = TASHU.filter((t) => dist(s.pos, t.pos) < 0.22).sort((a, b) => b.total - a.total);
  return { station: s, list: near };
});
const bestTashuNear = (p, radiusKm = 0.4) => {
  const c = TASHU.filter((t) => Math.abs(t.pos[0] - p[0]) < 0.01 && Math.abs(t.pos[1] - p[1]) < 0.012).map((t) => ({ ...t, d: dist(p, t.pos) }));
  const inR = c.filter((t) => t.d <= radiusKm);
  if (inR.length) return inR.sort((a, b) => (a.d * 3000 - a.total / 50) - (b.d * 3000 - b.total / 50))[0]; // 가까우면서 이용이 많은 곳
  return nearest(TASHU, p);
};

// ---- 경로가 지나는 도로 이름(경로 서버의 단계별 도로명)으로 혼잡 단계·자전거길 판정
function analyze(r, band) {
  const segs = (r.steps && r.steps.length ? r.steps : [{ name: '', km: lineKm(r.geo) }])
    .filter((st) => st.km > 0.001)
    .map((st) => ({ l: st.km, lv: ROAD_LV[st.name]?.[band] || 0, bike: /자전거|자전거도로|천변/.test(st.name) }));
  const km = segs.reduce((a, s) => a + s.l, 0);
  return {
    km,
    congKm: segs.filter((s) => s.lv >= 2).reduce((a, s) => a + s.l, 0),
    bikewayKm: segs.filter((s) => s.bike).reduce((a, s) => a + s.l, 0),
    bikeMin: segs.reduce((a, s) => a + (s.l / (s.bike ? BIKEWAY_SPD : BIKE_SPD[s.lv])) * 60, 0),
    busMin: segs.reduce((a, s) => a + (s.l / (s.bike ? BUS_SPD[0] : BUS_SPD[s.lv])) * 60, 0),
    cost: { avoid: segs.reduce((a, s) => a + (s.bike ? s.l / 16 : s.l / 13 * (1 + PEN[s.lv])), 0), bike: segs.reduce((a, s) => a + (s.bike ? s.l / 16 : s.l / 13 * 2), 0), short: km },
  };
}
const lineKm = (geo) => { const c = geo.coordinates; let k = 0; for (let i = 1; i < c.length; i++) k += dist([c[i - 1][1], c[i - 1][0]], [c[i][1], c[i][0]]); return k; };

const line = (a, b) => ({ type: 'LineString', coordinates: [[a[1], a[0]], [b[1], b[0]]] });
// 같은 출발·도착 경로는 한 번만 묻고 기억해 둠 (시간대·기준을 바꿔도 다시 기다리지 않게)
const ROUTE_CACHE = new Map();
// 동시에 보내는 길찾기 요청 수 제한 (무료 서버가 막지 않게)
let inFlight = 0; const waitQ = [];
const slot = () => (inFlight < 3 ? (inFlight++, Promise.resolve()) : new Promise((r) => waitQ.push(r)));
const release = () => { const n = waitQ.shift(); if (n) n(); else inFlight--; };
function decode6(str) {
  let i = 0, lat = 0, lon = 0; const out = [];
  while (i < str.length) {
    for (const k of [0, 1]) {
      let sh = 0, res = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}
// 1순위 Valhalla (오르막·산길 회피 설정 가능), 2순위 OSRM
const VH = { bike: 'bicycle', foot: 'pedestrian', car: 'auto' };
const VH_OPT = { bicycle: { bicycle_type: 'City', use_hills: 0.05, use_roads: 0.4, avoid_bad_surfaces: 0.9 }, pedestrian: { use_hills: 0.1 }, auto: {} };
async function valhalla(profile, a, b, alts) {
  const c = VH[profile];
  const body = { locations: [{ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }], costing: c, costing_options: { [c]: VH_OPT[c] }, units: 'kilometers', ...(alts ? { alternates: 2 } : {}) };
  const r = await fetch('https://valhalla1.openstreetmap.de/route?json=' + encodeURIComponent(JSON.stringify(body)), { signal: AbortSignal.timeout(9000) });
  const j = await r.json();
  if (!j.trip) throw new Error('no route');
  const conv = (t) => ({ geo: { type: 'LineString', coordinates: decode6(t.legs[0].shape) }, exact: true, steps: t.legs[0].maneuvers.map((m) => ({ name: (m.street_names || [])[0] || '', km: m.length })) });
  return [j.trip, ...(j.alternates || []).map((x) => x.trip)].map(conv);
}
async function osrmRaw(profile, a, b, alts) {
  const r = await fetch(`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=true${alts ? '&alternatives=3' : ''}`, { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (!j.routes?.length) throw new Error('no route');
  return j.routes.map((x) => ({ geo: x.geometry, exact: true, steps: x.legs.flatMap((lg) => lg.steps.map((st) => ({ name: st.name || '', km: st.distance / 1000 }))) }));
}
function osrm(profile, a, b, alts = false) {
  const k = `${profile}|${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}|${alts}`;
  if (ROUTE_CACHE.has(k)) return ROUTE_CACHE.get(k);
  const p = (async () => {
    await slot();
    try {
      for (const fn of [valhalla, osrmRaw, valhalla]) {
        try { return await fn(profile, a, b, alts); } catch { /* 다음 서버로 */ }
      }
    } finally { release(); }
    ROUTE_CACHE.delete(k); // 실패한 결과는 기억하지 않음
    return [{ geo: line(a, b), exact: false }];
  })();
  ROUTE_CACHE.set(k, p);
  return p;
}

// 자전거 구간: 대안 경로 여러 개 중 선택한 기준(혼잡 회피 / 자전거길 우선 / 최단 거리)으로 가장 좋은 것
async function bikeLeg(a, b, band, mode, label) {
  // 후보: 자전거길 위주 경로(bike) + 도로 경로(car) + 생활도로 경로(foot) — 타슈는 차도·자전거길 모두 달릴 수 있음
  const [bk, car, foot] = await Promise.all([osrm('bike', a, b, true), osrm('car', a, b), osrm('foot', a, b)]);
  let alts = [...bk.map((r) => ({ ...r, prof: 'bike' })), ...car.map((r) => ({ ...r, prof: 'car' })), ...foot.map((r) => ({ ...r, prof: 'foot' }))].filter((r, i, arr) => r.exact || arr.every((x) => !x.exact));
  alts = dropTrails(alts);
  const scored = alts.map((r) => ({ ...r, ...analyze(r, band) }));
  const minKm = Math.min(...scored.map((r) => r.km));
  const ok = scored.filter((r) => r.km <= minKm * (mode === 'bike' ? 2.2 : 1.4)); // 너무 먼 우회로는 제외
  // 자전거길 우선: 자전거길을 따라가는 경로(OSM 자전거 프로필)를 먼저 고름
  const pool = mode === 'bike' && ok.some((r) => r.prof === 'bike' && r.exact) ? ok.filter((r) => r.prof === 'bike') : ok;
  const best = pool.sort((x, y) => x.cost[mode] - y.cost[mode])[0];
  return { mode: 'bike', geo: best.geo, km: best.km, min: Math.max(1, Math.round(best.bikeMin)), congKm: best.congKm, bikewayKm: best.bikewayKm, exact: best.exact, label };
}
// 산길(등산로) 지름길 걸러내기: 자동차 도로 경로보다 15% 넘게 짧거나 산길 이름(산공원로·등산로·숲길 등)이 들어간 자전거·도보 경로는 산이나 공원 숲길을
// 가로지른 것으로 보고 뺌 (타슈는 생활자전거라 산길을 못 탐)
const geoKm = (g) => { const c = g.coordinates; let k = 0; for (let i = 1; i < c.length; i++) k += dist([c[i - 1][1], c[i - 1][0]], [c[i][1], c[i][0]]); return k; };
const TRAIL_NAME = /산공원|등산|숲길|둘레길|임도|산책로|오솔길/;
function dropTrails(alts) {
  const roads = alts.filter((r) => r.exact && r.prof === 'car');
  if (!roads.length) return alts;
  const roadKm = Math.min(...roads.map((r) => geoKm(r.geo)));
  const trail = (r) => (r.steps || []).some((st) => TRAIL_NAME.test(st.name));
  const kept = alts.filter((r) => !r.exact || r.prof === 'car' || (geoKm(r.geo) >= roadKm * 0.85 && !trail(r)));
  return kept.length ? kept : roads;
}
// 걷기 구간도 실제 길을 따라 그림 (직선으로 산·하천을 가로지르지 않게)
async function walkLeg(a, b, label) {
  const d0 = dist(a, b);
  if (d0 < 0.08) return { mode: 'walk', geo: line(a, b), km: d0, min: Math.max(1, mins(d0, WALK)), label };
  const [foot, car] = await Promise.all([osrm('foot', a, b), osrm('car', a, b)]);
  const alts = dropTrails([...foot.map((r) => ({ ...r, prof: 'foot' })), ...car.map((r) => ({ ...r, prof: 'car' }))]);
  const exact = alts.filter((r) => r.exact);
  const best = (exact.length ? exact : alts).sort((x, y) => geoKm(x.geo) - geoKm(y.geo))[0];
  const km = best.exact ? geoKm(best.geo) : d0 * 1.3;
  return { mode: 'walk', geo: best.geo, km, min: Math.max(1, mins(km, WALK)), exact: best.exact, label };
}
// 대전 도시철도 1호선 실제 선로 모양 (OpenStreetMap railway=subway, 판암→반석 20.6km)
const SUBWAY_TRACK = [[36.3168,127.45784],[36.31683,127.45669],[36.31696,127.45508],[36.31715,127.45417],[36.31758,127.45296],[36.31956,127.44893],[36.31962,127.44879],[36.32052,127.44709],[36.32137,127.44559],[36.32178,127.44517],[36.32222,127.44504],[36.3226,127.44506],[36.32296,127.44512],[36.32388,127.44528],[36.32419,127.44533],[36.32541,127.44513],[36.3283,127.44345],[36.32938,127.44289],[36.32941,127.44286],[36.32962,127.44265],[36.3313,127.44069],[36.33166,127.43996],[36.33216,127.43904],[36.33247,127.43808],[36.33256,127.43776],[36.33255,127.43714],[36.33252,127.43673],[36.33234,127.4362],[36.33212,127.4356],[36.33132,127.43338],[36.33111,127.4328],[36.32955,127.42847],[36.32926,127.42778],[36.32857,127.42592],[36.32827,127.42511],[36.32715,127.42241],[36.32699,127.42216],[36.32609,127.42124],[36.32497,127.41985],[36.32476,127.41961],[36.32326,127.41785],[36.32234,127.41682],[36.32186,127.4161],[36.32172,127.41586],[36.32155,127.41543],[36.32148,127.41519],[36.32142,127.4149],[36.32138,127.4147],[36.3214,127.41435],[36.32144,127.41401],[36.32153,127.4137],[36.32159,127.41354],[36.32161,127.41351],[36.32163,127.41347],[36.32171,127.41335],[36.32192,127.41309],[36.32205,127.41291],[36.32215,127.41278],[36.32237,127.41249],[36.32288,127.41183],[36.32425,127.41008],[36.32769,127.40587],[36.32837,127.40503],[36.32878,127.40452],[36.33019,127.40277],[36.33315,127.39927],[36.33525,127.39666],[36.33819,127.3932],[36.33821,127.39317],[36.34018,127.39078],[36.34157,127.3889],[36.34206,127.38775],[36.3427,127.38584],[36.34299,127.38508],[36.34314,127.38485],[36.3433,127.38474],[36.34349,127.38469],[36.3437,127.38464],[36.34545,127.38463],[36.34597,127.38461],[36.34639,127.38459],[36.34692,127.38456],[36.34721,127.38463],[36.34748,127.38481],[36.34784,127.38516],[36.34829,127.38566],[36.34883,127.38619],[36.34912,127.38643],[36.34946,127.38651],[36.35025,127.38655],[36.35146,127.38655],[36.35343,127.38651],[36.35411,127.38647],[36.35549,127.38623],[36.35593,127.38605],[36.35647,127.38584],[36.35684,127.38555],[36.35708,127.38524],[36.35732,127.3847],[36.35742,127.3842],[36.35755,127.38358],[36.35757,127.38268],[36.35758,127.38161],[36.3576,127.37981],[36.35762,127.37713],[36.35762,127.37279],[36.35762,127.37252],[36.35763,127.37069],[36.35787,127.36784],[36.35822,127.36512],[36.3583,127.36457],[36.35842,127.36372],[36.35854,127.36273],[36.35854,127.36213],[36.35841,127.36098],[36.35818,127.36022],[36.35761,127.35907],[36.35658,127.3575],[36.35539,127.35582],[36.35452,127.35459],[36.35417,127.35409],[36.3536,127.35364],[36.35289,127.35281],[36.35259,127.35234],[36.35225,127.35189],[36.35206,127.35145],[36.35193,127.35106],[36.35179,127.35049],[36.35171,127.35018],[36.35167,127.34977],[36.35171,127.34929],[36.35176,127.34877],[36.35185,127.34819],[36.35205,127.3474],[36.35238,127.34626],[36.35335,127.34276],[36.35369,127.34168],[36.35397,127.34051],[36.35544,127.33508],[36.35639,127.33171],[36.35669,127.33064],[36.35687,127.32997],[36.35766,127.32732],[36.35895,127.32286],[36.35939,127.32141],[36.35952,127.32078],[36.35971,127.31944],[36.35976,127.31911],[36.35983,127.31885],[36.35995,127.31863],[36.36007,127.31842],[36.36021,127.31826],[36.36038,127.31809],[36.36056,127.31798],[36.36075,127.31792],[36.36098,127.31786],[36.36127,127.31781],[36.36149,127.31777],[36.36178,127.31779],[36.36529,127.31783],[36.36666,127.31785],[36.36679,127.31785],[36.36804,127.31785],[36.37322,127.31783],[36.37412,127.31785],[36.375,127.31786],[36.37822,127.31784],[36.37944,127.31789],[36.37998,127.31796],[36.38059,127.3182],[36.38192,127.31895],[36.38278,127.31937],[36.38327,127.31953],[36.38377,127.31953],[36.38443,127.31947],[36.38487,127.31939],[36.38542,127.31915],[36.38673,127.31846],[36.38794,127.31771],[36.39,127.31621],[36.39149,127.31512],[36.39206,127.31469]];
// 역마다 선로 위 가장 가까운 점
const TRACK_IDX = SUBWAY.map((st) => SUBWAY_TRACK.reduce((b, p, i) => (dist(p, st.pos) < dist(SUBWAY_TRACK[b], st.pos) ? i : b), 0));
const subwayLeg = (s1, s2) => {
  const stops = Math.abs(s1.idx - s2.idx);
  const seq = SUBWAY.slice(Math.min(s1.idx, s2.idx), Math.max(s1.idx, s2.idx) + 1);
  if (s1.idx > s2.idx) seq.reverse();
  const i1 = TRACK_IDX[s1.idx], i2 = TRACK_IDX[s2.idx];
  let pts = SUBWAY_TRACK.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
  if (i1 > i2) pts = pts.slice().reverse();
  pts = [s1.pos, ...pts, s2.pos];
  let km = 0; for (let i = 1; i < pts.length; i++) km += dist(pts[i - 1], pts[i]);
  return { mode: 'subway', geo: { type: 'LineString', coordinates: pts.map((q) => [q[1], q[0]]) }, stations: seq.map((x) => x.pos), km, min: stops * MIN_PER_STATION + SUBWAY_WAIT, wait: SUBWAY_WAIT, stops, from: s1, to: s2, label: `${s1.name} 승차 → ${s2.name} 하차 (${stops}정거장)` };
};

function finish(p, band) {
  p.min = p.legs.reduce((a, l) => a + l.min, 0);
  p.arrive = new Date(Date.now() + p.min * 60000);
  const ride = p.legs.filter((l) => l.mode !== 'walk');
  p.transfers = Math.max(0, ride.length - 1);
  p.walkM = Math.round(p.legs.filter((l) => l.mode === 'walk').reduce((a, l) => a + l.km, 0) * 1000);
  p.bikeKm = p.legs.filter((l) => l.mode === 'bike').reduce((a, l) => a + l.km, 0);
  p.co2 = Math.round(p.bikeKm * CO2_G_PER_KM);
  p.kcal = Math.round(p.bikeKm * KCAL_PER_KM);
  p.congKm = p.legs.reduce((a, l) => a + (l.congKm || 0), 0);
  p.band = band;
  p.approx = p.legs.some((l) => l.exact === false && l.km > 0.15);
  return p;
}

// 출발 쪽·도착 쪽 타슈 구간을 붙인 타슈 경로 (대여소까지 걷기 → 타슈 → 반납 대여소에서 걷기)
async function tashuTrip(a, b, band, mode) {
  const r = bestTashuNear(a), d = bestTashuNear(b);
  const legs = [];
  if (r.d > 0.03) legs.push(await walkLeg(a, r.pos, `${r.name} 대여소까지 걷기`));
  legs.push(await bikeLeg(r.pos, d.pos, band, mode, `${r.name}에서 대여 → ${d.name}에 반납`));
  legs[legs.length - 1].rent = r; legs[legs.length - 1].ret = d;
  if (d.d > 0.03) legs.push(await walkLeg(d.pos, b, '목적지까지 걷기'));
  return legs;
}

export async function planAll(a, b, band, bikeMode) {
  const s1 = nearest(SUBWAY, a), s2 = nearest(SUBWAY, b);
  const subwayOk = s1.name !== s2.name && Math.abs(s1.idx - s2.idx) >= 1;
  const t1 = subwayOk ? TRANSFER[s1.idx].list[0] : null, t2 = subwayOk ? TRANSFER[s2.idx].list[0] : null;
  const usePre = !!t1 && s1.d > 0.15, usePost = !!t2 && s2.d > 0.15; // 역이 바로 앞(150m 안)일 때만 타슈 생략
  const sumMin = (legs) => legs.reduce((x, l) => x + l.min, 0);

  // 서로 상관없는 경로들을 한꺼번에 계산
  const [tashuLegs, roadRes, pre, post] = await Promise.all([
    tashuTrip(a, b, band, bikeMode),
    osrm('car', a, b),
    usePre ? tashuTrip(a, t1.pos, band, bikeMode) : null,
    usePost ? tashuTrip(t2.pos, b, band, bikeMode) : null,
  ]);

  // ③ 타슈
  const tashu = finish({ key: 'tashu', title: '타슈', legs: tashuLegs }, band);

  // ② 대중교통: 지하철(걸어서 역까지) 또는 시내버스 중 빠른 것
  const road = roadRes[0];
  const ra = analyze(road, band);
  const wait = band < 2 ? 12 : 8;
  const busLeg = (geo, km, min, label) => ({ mode: 'bus', geo, km, min: Math.round(min) + wait, wait, congKm: ra.congKm * (km / (ra.km || 1)), exact: road.exact, label });
  const transitOpts = [];
  if (subwayOk) transitOpts.push(await Promise.all([walkLeg(a, s1.pos, `${s1.name}까지 걷기`), subwayLeg(s1, s2), walkLeg(s2.pos, b, '목적지까지 걷기')]));
  transitOpts.push([
    { mode: 'walk', geo: line(a, a), km: 0.3, min: 4, label: '가까운 버스정류장까지 걷기 (약 300m)' },
    busLeg(road.geo, ra.km, ra.busMin, `시내버스 약 ${Math.round(ra.busMin)}분 (대기 ${wait}분 별도, 도로 혼잡도로 추정)`),
    { mode: 'walk', geo: line(b, b), km: 0.3, min: 4, label: '정류장에서 목적지까지 걷기 (약 300m)' },
  ]);
  const transit = finish({ key: 'transit', title: '대중교통', legs: transitOpts.sort((x, y) => sumMin(x) - sumMin(y))[0] }, band);

  // ① 대중교통 + 타슈 — 항상 예측해서 가장 빠른 조합을 보여 줌
  const cand = [];
  if (pre) { // 타슈로 역까지 → 지하철
    const bk = pre.find((l) => l.mode === 'bike'); bk.label = `${bk.rent.name}에서 대여 → ${t1.name}(${s1.name} 환승 대여소)에 반납`;
    cand.push(await Promise.all([...pre.filter((l) => l.mode === 'bike' || l.label.includes('대여소까지')), walkLeg(t1.pos, s1.pos, `${s1.name} 개찰구까지`), subwayLeg(s1, s2), walkLeg(s2.pos, b, '목적지까지 걷기')]));
  }
  if (post) { // 지하철 → 환승 대여소에서 타슈
    cand.push(await Promise.all([walkLeg(a, s1.pos, `${s1.name}까지 걷기`), subwayLeg(s1, s2), walkLeg(s2.pos, t2.pos, `${t2.name} 환승 대여소까지`), ...post.filter((l) => !l.label.includes('대여소까지'))]));
  }
  if (pre && post) { // 타슈 → 지하철 → 타슈
    cand.push(await Promise.all([...cand[0].slice(0, -1), walkLeg(s2.pos, t2.pos, `${t2.name} 환승 대여소까지`), ...post.filter((l) => !l.label.includes('대여소까지'))]));
  }
  // 버스로 가다가 목적지 약 1.5km 앞 대여소에서 타슈로 갈아타기
  if (road.exact && ra.km > 2) {
    const pts = road.geo.coordinates.map(([lon, lat]) => [lat, lon]);
    const target = Math.max(0.8, ra.km - Math.min(1.5, ra.km * 0.4));
    let acc = 0, cut = pts.length - 1;
    for (let i = 1; i < pts.length; i++) { acc += dist(pts[i - 1], pts[i]); if (acc >= target) { cut = i; break; } }
    const split = pts[cut];
    const xfer = bestTashuNear(split, 0.4);
    const after = await tashuTrip(xfer.pos, b, band, bikeMode);
    const frac = acc / (ra.km || 1);
    cand.push([
      { mode: 'walk', geo: line(a, a), km: 0.3, min: 4, label: '가까운 버스정류장까지 걷기 (약 300m)' },
      busLeg({ type: 'LineString', coordinates: road.geo.coordinates.slice(0, cut + 1) }, acc, ra.busMin * frac, `시내버스 약 ${Math.round(ra.busMin * frac)}분 → ${xfer.name} 부근 하차 (도로 혼잡도로 추정)`),
      await walkLeg(split, xfer.pos, `${xfer.name} 대여소까지`),
      ...after.filter((l) => !l.label.includes('대여소까지')),
    ]);
  }
  const best = cand.sort((x, y) => sumMin(x) - sumMin(y))[0];
  const combo = best ? finish({ key: 'combo', title: '대중교통+타슈', legs: best }, band)
    : { key: 'combo', title: '대중교통+타슈', none: true, why: '두 곳이 너무 가까워서 대중교통으로 갈아탈 구간이 없어요. 타슈만 타는 게 가장 좋아요.' };

  const plans = [combo, transit, tashu];
  const real = plans.filter((p) => !p.none);
  const fastest = real.reduce((x, y) => (y.min < x.min ? y : x));
  const greenest = real.reduce((x, y) => (y.co2 > x.co2 ? y : x));
  fastest.fastest = true;
  if (greenest.co2 > 0) greenest.greenest = true;
  return plans;
}
