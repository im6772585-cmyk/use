// 길찾기: ① 대중교통+타슈 ② 대중교통 ③ 타슈 — 세 경로를 같은 형식으로 계산
import L from 'leaflet';
import { STATIONS } from './data.js';
import { ROAD_LV } from './congestion.js';
import { BUS } from './busstops.js';
import { BUS_ROUTES } from './busroutes.js';

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
    segs,
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
async function valhalla(profile, a, b, alts, vopt) {
  const c = VH[profile];
  const body = { locations: [{ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }], costing: c, costing_options: { [c]: { ...VH_OPT[c], ...(vopt || {}) } }, units: 'kilometers', ...(alts ? { alternates: 2 } : {}) };
  const r = await fetch('https://valhalla1.openstreetmap.de/route?json=' + encodeURIComponent(JSON.stringify(body)), { signal: AbortSignal.timeout(9000) });
  const j = await r.json();
  if (!j.trip) throw new Error('no route');
  const conv = (t) => ({ geo: { type: 'LineString', coordinates: decode6(t.legs[0].shape) }, exact: true, vh: true, steps: t.legs[0].maneuvers.map((m) => ({ name: (m.street_names || [])[0] || '', km: m.length })) });
  return [j.trip, ...(j.alternates || []).map((x) => x.trip)].map(conv);
}
async function osrmRaw(profile, a, b, alts) {
  const r = await fetch(`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=true${alts ? '&alternatives=3' : ''}`, { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (!j.routes?.length) throw new Error('no route');
  return j.routes.map((x) => ({ geo: x.geometry, exact: true, steps: x.legs.flatMap((lg) => lg.steps.map((st) => ({ name: st.name || '', km: st.distance / 1000 }))) }));
}
function osrm(profile, a, b, alts = false, vopt = null) {
  const k = `${profile}|${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}|${alts}|${JSON.stringify(vopt)}`;
  if (ROUTE_CACHE.has(k)) return ROUTE_CACHE.get(k);
  const p = (async () => {
    await slot();
    try {
      for (const fn of [valhalla, osrmRaw, valhalla]) {
        try { return await fn(profile, a, b, alts, vopt); } catch { /* 다음 서버로 */ }
      }
    } finally { release(); }
    ROUTE_CACHE.delete(k); // 실패한 결과는 기억하지 않음
    return [{ geo: line(a, b), exact: false }];
  })();
  ROUTE_CACHE.set(k, p);
  return p;
}

// 자전거 구간: 대안 경로 여러 개 중 선택한 기준(혼잡 회피 / 자전거길 우선 / 최단 거리)으로 가장 좋은 것
// 사용자 길 취향 (기본값)
export const DEFAULT_PREFS = { bikeway: true, bigRoad: false, slope: 'balance', avoidCong: true, minTransfer: false, walk: 'balance', bikeRange: 'balance' };
const HILLS = { avoid: 0, balance: 0.35, ok: 0.9 };            // Valhalla 오르막 회피 정도 (0 = 최대한 피함)
const WALK_MAX = { less: 0.4, balance: 0.6, more: 1.0 };      // 정류장·역까지 걸어갈 최대 거리(km)
const WALK_TOTAL = { less: 0.9, balance: 1.6, more: 3 };      // 한 경로에서 걷는 총 거리 한도(km)
const BIKE_MAX = { short: 2.5, balance: 4.5, long: 8 };       // 연계 경로에서 타슈로 탈 최대 거리(km)
async function bikeLeg(a, b, band, prefs, label) {
  // 후보: 자전거 프로필(경사로·큰길 취향 반영) + 자동차 도로 + 생활도로 — 타슈는 차도·자전거길 모두 달릴 수 있음
  const vopt = { use_hills: HILLS[prefs.slope], use_roads: prefs.bigRoad ? 0.85 : prefs.bikeway ? 0.15 : 0.4 };
  const [bk, car, foot] = await Promise.all([osrm('bike', a, b, true, vopt), osrm('car', a, b), prefs.bigRoad ? [] : osrm('foot', a, b)]);
  let alts = [...bk.map((r) => ({ ...r, prof: 'bike' })), ...car.map((r) => ({ ...r, prof: 'car' })), ...foot.map((r) => ({ ...r, prof: 'foot' }))].filter((r, i, arr) => r.exact || arr.every((x) => !x.exact));
  alts = dropTrails(alts);
  const scored = alts.map((r) => ({ ...r, ...analyze(r, band) }));
  const minKm = Math.min(...scored.map((r) => r.km));
  const limit = 1.35 + (prefs.bikeway ? 0.35 : 0) + (prefs.slope === 'avoid' ? 0.45 : 0);
  const ok = scored.filter((r) => r.km <= minKm * limit); // 너무 먼 우회로는 제외
  const cost = (r) => {
    let c = r.segs.reduce((t, sg) => t + (sg.l / (sg.bike ? 16 : 13)) * (prefs.avoidCong ? 1 + PEN[sg.lv] : 1) * (sg.bike && prefs.bikeway ? 0.6 : 1), 0);
    if (prefs.bigRoad && r.prof === 'car') c *= 0.85;
    if (prefs.slope === 'avoid' && !(r.prof === 'bike' && r.vh)) c *= 1.3;   // 경사로를 피한 경로는 자전거 프로필(오르막 회피)에서만 나옴
    if (prefs.slope === 'ok' && r.prof !== 'bike') c *= 0.95;
    return c;
  };
  const best = ok.sort((x, y) => cost(x) - cost(y))[0];
  const quickest = Math.min(...ok.map((r) => r.bikeMin));
  return { mode: 'bike', geo: best.geo, km: best.km, min: Math.max(1, Math.round(best.bikeMin)), congKm: best.congKm, bikewayKm: best.bikewayKm, exact: best.exact, label,
    slopeAvoided: prefs.slope === 'avoid' && best.prof === 'bike' && !!best.vh, extraMin: Math.max(0, Math.round(best.bikeMin - quickest)) };
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
async function tashuTrip(a, b, band, prefs) {
  const r = bestTashuNear(a), d = bestTashuNear(b);
  const legs = [];
  if (r.d > 0.03) legs.push(await walkLeg(a, r.pos, `${r.name} 대여소까지 걷기`));
  legs.push(await bikeLeg(r.pos, d.pos, band, prefs, `${r.name}에서 대여 → ${d.name}에 반납`));
  legs[legs.length - 1].rent = r; legs[legs.length - 1].ret = d;
  if (d.d > 0.03) legs.push(await walkLeg(d.pos, b, '목적지까지 걷기'));
  return legs;
}

// ---- 시내버스: 제공받은 노선별 운행 경로(124개 노선)와 정류장으로 계산
const BUS_KMH = [15, 14, 19];   // 시간대별 버스 평균 운행속도 (정차 포함, 출근·퇴근·평시)
const BUS_WAIT = [7, 7, 8];     // 평균 대기 (배차 간격의 절반 정도)
function decode5(str) {
  let i = 0, lat = 0, lon = 0; const out = [];
  while (i < str.length) {
    for (const k of [0, 1]) {
      let sh = 0, res = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}
let ROUTES = null;
function routes() {
  if (ROUTES) return ROUTES;
  ROUTES = BUS_ROUTES.map(([name, enc, st]) => {
    const pts = decode5(enc); const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const stops = []; for (let i = 0; i < st.length; i += 2) stops.push({ b: BUS[st[i]], km: st[i + 1] / 1000 });
    return { name: name.replace(/\(.*$/, ''), full: name, pts, cum, stops };
  });
  return ROUTES;
}
// 노선 경로에서 km1~km2 구간 잘라내기
function sliceRoute(r, k1, k2) {
  const out = [];
  const at = (k) => { let i = r.cum.findIndex((c) => c >= k); if (i <= 0) return r.pts[Math.max(0, i)]; const f = (k - r.cum[i - 1]) / ((r.cum[i] - r.cum[i - 1]) || 1); return [r.pts[i - 1][0] + f * (r.pts[i][0] - r.pts[i - 1][0]), r.pts[i - 1][1] + f * (r.pts[i][1] - r.pts[i - 1][1])]; };
  out.push(at(k1));
  r.pts.forEach((p, i) => { if (r.cum[i] > k1 && r.cum[i] < k2) out.push(p); });
  out.push(at(k2));
  return { type: 'LineString', coordinates: out.map((q) => [q[1], q[0]]) };
}
const nearStops = (p, km) => BUS.filter((s) => Math.abs(s.pos[0] - p[0]) < km / 111 && Math.abs(s.pos[1] - p[1]) < km / 89).map((s) => ({ s, d: dist(p, s.pos) })).filter((x) => x.d <= km);
const walkMin = (km) => (km * 1.3 / WALK) * 60;
// 한 노선으로 가는 버스 후보 (출발 쪽 정류장 → 도착 쪽 정류장, 같은 노선에서 순서가 맞는 것만)
function busCandidates(fromP, toList, band, walkKm = 0.6) {
  const O = new Map(nearStops(fromP, walkKm).map((x) => [x.s.id, x.d]));
  const out = [];
  for (const r of routes()) {
    for (const o of r.stops) {
      const wo = O.get(o.b.id); if (wo == null) continue;
      for (const d of r.stops) {
        if (d.km <= o.km + 0.2) continue;
        const ride = d.km - o.km;
        if (ride > 25) continue;
        const rideMin = (ride / BUS_KMH[band]) * 60;
        for (const t of toList(d)) out.push({ r, o, d, wo, ride, rideMin, est: walkMin(wo) + BUS_WAIT[band] + rideMin + t.cost, tail: t });
      }
    }
  }
  return out.sort((x, y) => x.est - y.est);
}
function busLegOf(c, band) {
  const stops = c.r.stops.filter((x) => x.km >= c.o.km && x.km <= c.d.km).length - 1;
  return { mode: 'bus', geo: sliceRoute(c.r, c.o.km, c.d.km), km: c.ride, min: Math.round(c.rideMin) + BUS_WAIT[band], wait: BUS_WAIT[band], route: c.r.name, stops, from: c.o.b, to: c.d.b, exact: true,
    label: `${c.r.name} 버스 · ${c.o.b.name} 승차 → ${c.d.b.name} 하차 (${stops}정거장)` };
}

export async function planAll(a, b, band, prefsIn) {
  const prefs = { ...DEFAULT_PREFS, ...(prefsIn || {}) };
  const wMax = WALK_MAX[prefs.walk], bMax = BIKE_MAX[prefs.bikeRange];
  const s1 = nearest(SUBWAY, a), s2 = nearest(SUBWAY, b);
  const subwayOk = s1.name !== s2.name && Math.abs(s1.idx - s2.idx) >= 1;
  const t1 = subwayOk ? TRANSFER[s1.idx].list[0] : null, t2 = subwayOk ? TRANSFER[s2.idx].list[0] : null;
  const usePre = !!t1 && s1.d > 0.15 && s1.d <= bMax, usePost = !!t2 && s2.d > 0.15 && s2.d <= bMax;
  const direct = dist(a, b);
  const D = new Map(nearStops(b, wMax).map((x) => [x.s.id, x.d]));

  // 버스만: 노선이 다른 상위 2개
  const busList = direct > 0.8 ? busCandidates(a, (d) => (D.has(d.b.id) ? [{ cost: walkMin(D.get(d.b.id)) }] : []), band, wMax) : [];
  const busPicks = [];
  for (const c of busList) { if (!busPicks.some((x) => x.r.name === c.r.name)) busPicks.push(c); if (busPicks.length >= 2) break; }
  // 버스 → 타슈
  const busThenBike = direct > 2 ? busCandidates(a, (d) => {
    const left = dist(d.b.pos, b);
    if (left < 0.6 || left > bMax || left > direct * 0.8) return [];
    return [{ cost: walkMin(0.15) + 2 + (left * 1.3 / 13) * 60 + walkMin(0.15) }];
  }, band, wMax)[0] : null;
  // 타슈 → 버스
  let bikeThenBus = null;
  if (direct > 2) {
    const firsts = [];
    for (const r of routes()) for (const d of r.stops) {
      const wd = D.get(d.b.id); if (wd == null) continue;
      for (const o of r.stops) {
        if (o.km >= d.km - 0.2) break;
        const lead = dist(a, o.b.pos);
        if (lead < 0.6 || lead > bMax || lead > direct * 0.8) continue;
        const rideMin = ((d.km - o.km) / BUS_KMH[band]) * 60;
        firsts.push({ r, o, d, ride: d.km - o.km, rideMin, wd, est: walkMin(0.15) + 2 + (lead * 1.3 / 13) * 60 + BUS_WAIT[band] + rideMin + walkMin(wd) });
      }
    }
    bikeThenBus = firsts.sort((x, y) => x.est - y.est)[0] || null;
  }

  const busLegs = (c) => Promise.all([walkLeg(a, c.o.b.pos, `${c.o.b.name} 정류장까지 걷기`), busLegOf(c, band), walkLeg(c.d.b.pos, b, '목적지까지 걷기')]);
  const [tashuLegs, pre, post, busA, busB, bus2, bus3, subwayLegs] = await Promise.all([
    tashuTrip(a, b, band, prefs),
    usePre ? tashuTrip(a, t1.pos, band, prefs) : null,
    usePost ? tashuTrip(t2.pos, b, band, prefs) : null,
    busPicks[0] ? busLegs(busPicks[0]) : null,
    busPicks[1] ? busLegs(busPicks[1]) : null,
    busThenBike ? Promise.all([walkLeg(a, busThenBike.o.b.pos, `${busThenBike.o.b.name} 정류장까지 걷기`), busLegOf(busThenBike, band), tashuTrip(busThenBike.d.b.pos, b, band, prefs)]).then(([w, bl, t]) => [w, bl, ...t]) : null,
    bikeThenBus ? Promise.all([tashuTrip(a, bikeThenBus.o.b.pos, band, prefs), busLegOf(bikeThenBus, band), walkLeg(bikeThenBus.d.b.pos, b, '목적지까지 걷기')]).then(([t, bl, w]) => { const last = t[t.length - 1]; if (last.mode === 'walk') last.label = `${bikeThenBus.o.b.name} 정류장까지 걷기`; return [...t, bl, w]; }) : null,
    subwayOk ? Promise.all([walkLeg(a, s1.pos, `${s1.name}까지 걷기`), subwayLeg(s1, s2), walkLeg(s2.pos, b, '목적지까지 걷기')]) : null,
  ]);
  const sub = [];
  if (pre) {
    const bk = pre.find((l) => l.mode === 'bike'); bk.label = `${bk.rent.name}에서 대여 → ${t1.name}(${s1.name} 환승 대여소)에 반납`;
    sub.push(await Promise.all([...pre.filter((l) => l.mode === 'bike' || l.label.includes('대여소까지')), walkLeg(t1.pos, s1.pos, `${s1.name} 개찰구까지`), subwayLeg(s1, s2), walkLeg(s2.pos, b, '목적지까지 걷기')]));
  }
  if (post) sub.push(await Promise.all([walkLeg(a, s1.pos, `${s1.name}까지 걷기`), subwayLeg(s1, s2), walkLeg(s2.pos, t2.pos, `${t2.name} 환승 대여소까지`), ...post.filter((l) => !l.label.includes('대여소까지'))]));
  if (pre && post) sub.push(await Promise.all([...sub[0].slice(0, -1), walkLeg(s2.pos, t2.pos, `${t2.name} 환승 대여소까지`), ...post.filter((l) => !l.label.includes('대여소까지'))]));

  // 모든 경로를 한 목록으로
  const list = [];
  const add = (cat, vname, legs) => { if (legs) list.push(finish({ key: `${cat}-${list.length}`, cat, vname, title: vname, legs }, band)); };
  add('tashu', '타슈', tashuLegs);
  add('transit', '지하철', subwayLegs);
  add('transit', '버스', busA);
  add('transit', '버스', busB);
  sub.forEach((lg) => add('combo', '지하철+타슈', lg));
  add('combo', '버스+타슈', bus2);
  add('combo', '버스+타슈', bus3);

  // 걷기 취향: 너무 많이 걷는 대중교통 경로는 뺌 (타슈만 타는 경로는 항상 남김)
  const walkOk = list.filter((p) => p.cat === 'tashu' || p.walkM / 1000 <= WALK_TOTAL[prefs.walk]);
  const kept = walkOk.length > 1 ? walkOk : list;
  // 추천 점수: 시간 + 취향 (환승·걷기·혼잡·자전거길)
  const walkW = { less: 0.6, balance: 0.15, more: 0 }[prefs.walk];
  kept.forEach((p) => {
    const walkMinAll = p.legs.filter((l) => l.mode === 'walk').reduce((t, l) => t + l.min, 0);
    const bikeway = p.legs.reduce((t, l) => t + (l.bikewayKm || 0), 0);
    p.bikewayKm = bikeway;
    p.slopeAvoided = p.legs.some((l) => l.slopeAvoided);
    p.extraMin = p.legs.reduce((t, l) => t + (l.slopeAvoided ? l.extraMin || 0 : 0), 0);
    p.score = p.min + walkMinAll * walkW + p.transfers * (prefs.minTransfer ? 9 : 1.5) + (prefs.avoidCong ? p.congKm * 2 : 0) - (prefs.bikeway ? bikeway * 0.8 : 0);
    const tags = [];
    if (p.slopeAvoided) tags.push('경사로 회피');
    if (prefs.bigRoad && p.bikeKm > 0) tags.push('큰길 위주');
    if (bikeway >= 0.3) tags.push(`자전거길 ${bikeway.toFixed(1)}km`);
    if (p.bikeKm > 0 && p.congKm < 0.05) tags.push('혼잡 도로 없음');
    if (p.cat !== 'tashu' && p.transfers === 0) tags.push('환승 없음');
    if (p.walkM <= 300) tags.push('걷기 적음');
    p.tags = tags.slice(0, 2);
  });
  kept.sort((x, y) => x.score - y.score);
  kept[0].rec = true;
  kept.reduce((x, y) => (y.min < x.min ? y : x)).fastest = true;
  const g = kept.reduce((x, y) => (y.co2 > x.co2 ? y : x)); if (g.co2 > 0) g.greenest = true;
  return kept;
}
