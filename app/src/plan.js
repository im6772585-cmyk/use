// 길찾기: ① 대중교통+타슈 ② 대중교통 ③ 타슈 — 세 경로를 같은 형식으로 계산
import L from 'leaflet';
import { CONG, STATIONS, BIKEWAYS } from './data.js';

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

// ---- 도로 혼잡 단계 / 자전거길 판정 (35m 이내 같은 도로로 봄)
const K = 111000, KX = 111000 * Math.cos(36.35 * Math.PI / 180);
const xy = ([lat, lon]) => [lon * KX, lat * K];
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const CONG_XY = CONG.map(([a, b, , lv]) => ({ a: xy(a), b: xy(b), lv }));
const BIKE_XY = BIKEWAYS.map(([a, b]) => ({ a: xy(a), b: xy(b) }));
const levelAt = (p, band) => { let l = 0; for (const s of CONG_XY) if (s.lv[band] > l && segDist(p, s.a, s.b) < 35) l = s.lv[band]; return l; };
const onBikeway = (p) => BIKE_XY.some((s) => segDist(p, s.a, s.b) < 40);

// 경로선을 구간별로 나눠 혼잡 단계·자전거길 여부를 붙임
function analyze(geo, band) {
  const pts = geo.coordinates.map(([lon, lat]) => [lat, lon]);
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (l < 0.001) continue;
    const mid = xy([(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2]);
    segs.push({ l, lv: levelAt(mid, band), bike: onBikeway(mid) });
  }
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

const line = (a, b) => ({ type: 'LineString', coordinates: [[a[1], a[0]], [b[1], b[0]]] });
async function osrm(profile, a, b, alts = false) {
  try {
    const r = await fetch(`https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson${alts ? '&alternatives=3' : ''}`, { signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    if (!j.routes?.length) throw new Error('no route');
    return j.routes.map((x) => ({ geo: x.geometry, exact: true }));
  } catch {
    return [{ geo: line(a, b), exact: false }];
  }
}

// 자전거 구간: 대안 경로 여러 개 중 선택한 기준(혼잡 회피 / 자전거길 우선 / 최단 거리)으로 가장 좋은 것
async function bikeLeg(a, b, band, mode, label) {
  const alts = await osrm('bike', a, b, true);
  const scored = alts.map((r) => ({ ...r, ...analyze(r.geo, band) }));
  const best = scored.sort((x, y) => x.cost[mode] - y.cost[mode])[0];
  return { mode: 'bike', geo: best.geo, km: best.km, min: Math.max(1, Math.round(best.bikeMin)), congKm: best.congKm, bikewayKm: best.bikewayKm, exact: best.exact, label };
}
const walkLeg = (a, b, label) => { const km = dist(a, b) * 1.25; return { mode: 'walk', geo: line(a, b), km, min: mins(km, WALK), label }; };
const subwayLeg = (s1, s2) => {
  const stops = Math.abs(s1.idx - s2.idx);
  const seq = SUBWAY.slice(Math.min(s1.idx, s2.idx), Math.max(s1.idx, s2.idx) + 1);
  if (s1.idx > s2.idx) seq.reverse();
  return { mode: 'subway', geo: { type: 'LineString', coordinates: seq.map((s) => [s.pos[1], s.pos[0]]) }, stations: seq.map((s) => s.pos), km: stops * 1.1, min: stops * MIN_PER_STATION + SUBWAY_WAIT, wait: SUBWAY_WAIT, stops, from: s1, to: s2, label: `${s1.name} 승차 → ${s2.name} 하차 (${stops}정거장)` };
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
  return p;
}

// 출발 쪽·도착 쪽 타슈 구간을 붙인 타슈 경로 (대여소까지 걷기 → 타슈 → 반납 대여소에서 걷기)
async function tashuTrip(a, b, band, mode) {
  const r = bestTashuNear(a), d = bestTashuNear(b);
  const legs = [];
  if (r.d > 0.03) legs.push(walkLeg(a, r.pos, `${r.name} 대여소까지 걷기`));
  legs.push(await bikeLeg(r.pos, d.pos, band, mode, `${r.name}에서 대여 → ${d.name}에 반납`));
  legs[legs.length - 1].rent = r; legs[legs.length - 1].ret = d;
  if (d.d > 0.03) legs.push(walkLeg(d.pos, b, '목적지까지 걷기'));
  return legs;
}

export async function planAll(a, b, band, bikeMode) {
  const s1 = nearest(SUBWAY, a), s2 = nearest(SUBWAY, b);
  const subwayOk = s1.name !== s2.name && Math.abs(s1.idx - s2.idx) >= 1;

  // ③ 타슈
  const tashu = finish({ key: 'tashu', title: '타슈', legs: await tashuTrip(a, b, band, bikeMode) }, band);

  // ② 대중교통: 지하철(걸어서 역까지) 또는 시내버스 중 빠른 것
  const transitOpts = [];
  if (subwayOk) transitOpts.push([walkLeg(a, s1.pos, `${s1.name}까지 걷기`), subwayLeg(s1, s2), walkLeg(s2.pos, b, '목적지까지 걷기')]);
  const road = (await osrm('car', a, b))[0];
  const ra = analyze(road.geo, band);
  const wait = band < 2 ? 12 : 8;
  transitOpts.push([
    { mode: 'walk', geo: line(a, a), km: 0.3, min: 4, label: '가까운 버스정류장까지 걷기 (약 300m)' },
    { mode: 'bus', geo: road.geo, km: ra.km, min: Math.round(ra.busMin) + wait, wait, congKm: ra.congKm, exact: road.exact, label: `시내버스 약 ${Math.round(ra.busMin)}분 (대기 ${wait}분 별도, 도로 혼잡도로 추정)` },
    { mode: 'walk', geo: line(b, b), km: 0.3, min: 4, label: '정류장에서 목적지까지 걷기 (약 300m)' },
  ]);
  const transit = finish({ key: 'transit', title: '대중교통', legs: transitOpts.map((l) => l).sort((x, y) => x.reduce((s, l) => s + l.min, 0) - y.reduce((s, l) => s + l.min, 0))[0] }, band);

  // ① 대중교통 + 타슈: 타슈→지하철 / 지하철→타슈 / 타슈→지하철→타슈 중 가장 빠른 것
  let combo = null;
  if (subwayOk) {
    const t1 = TRANSFER[s1.idx].list[0], t2 = TRANSFER[s2.idx].list[0];
    const cand = [];
    if (t1 && s1.d > 0.35) {
      const pre = await tashuTrip(a, t1.pos, band, bikeMode);
      const bk = pre.find((l) => l.mode === 'bike'); bk.label = `${bk.rent.name}에서 대여 → ${t1.name}(${s1.name} 환승 대여소)에 반납`;
      cand.push([...pre.filter((l) => l.mode === 'bike' || l.label.includes('대여소까지')), walkLeg(t1.pos, s1.pos, `${s1.name} 개찰구까지`), subwayLeg(s1, s2), walkLeg(s2.pos, b, '목적지까지 걷기')]);
    }
    if (t2 && s2.d > 0.35) {
      const post = await tashuTrip(t2.pos, b, band, bikeMode);
      cand.push([walkLeg(a, s1.pos, `${s1.name}까지 걷기`), subwayLeg(s1, s2), walkLeg(s2.pos, t2.pos, `${t2.name} 환승 대여소까지`), ...post.filter((l) => !l.label.includes('대여소까지'))]);
    }
    if (cand.length) combo = finish({ key: 'combo', title: '대중교통+타슈', legs: cand.sort((x, y) => x.reduce((s, l) => s + l.min, 0) - y.reduce((s, l) => s + l.min, 0))[0] }, band);
  }
  if (!combo) combo = { key: 'combo', title: '대중교통+타슈', none: true, why: subwayOk ? '출발지와 도착지가 모두 역 가까이에 있어 타슈로 갈아탈 필요가 없어요.' : '두 곳 사이에 도시철도로 이어지는 구간이 없어요.' };

  const plans = [combo, transit, tashu];
  const real = plans.filter((p) => !p.none);
  const fastest = real.reduce((x, y) => (y.min < x.min ? y : x));
  const greenest = real.reduce((x, y) => (y.co2 > x.co2 ? y : x));
  fastest.fastest = true;
  if (greenest.co2 > 0) greenest.greenest = true;
  return plans;
}
