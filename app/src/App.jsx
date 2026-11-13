import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@maplibre/maplibre-gl-leaflet';
import { mapStyle, C } from './mapStyle.js';
import { CONG, COURSES, STATIONS } from './data.js';
import { ART } from './art.js';
import { bikeSvg, myLocationHtml, trainSvg, personSvg } from './rider.js';

const DAEJEON_CENTER = [36.3504, 127.3845]; // 대전시청
const DAEJEON_BBOX = '36.20,127.25,36.50,127.50';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const DESTINATIONS = [
  { name: '대전역', pos: [36.3326, 127.4342] },
  { name: '엑스포과학공원', pos: [36.3758, 127.3866] },
  { name: '한밭수목원', pos: [36.3687, 127.388] },
  { name: '대전시청', pos: [36.3504, 127.3845] },
  { name: '충남대학교', pos: [36.3663, 127.3443] },
  { name: 'KAIST', pos: [36.3721, 127.3604] },
  { name: '유성온천역', pos: [36.3538, 127.3418] },
];

const SPEED = { bike: 15, walk: 4.5 }; // km/h
const SUBWAY_WAIT_MIN = 4;
const MIN_PER_STATION = 2;
// 대전 도시철도 1호선 (판암 → 반석 순서). 좌표 출처: Wikidata
const SUBWAY = [
  ['판암역', 36.3169, 127.458], ['신흥역', 36.3196, 127.449], ['대동역', 36.3295, 127.443], ['대전역', 36.3313, 127.433],
  ['중앙로역', 36.3286, 127.426], ['중구청역', 36.3249, 127.42], ['서대전네거리역', 36.3224, 127.413], ['오룡역', 36.3283, 127.405],
  ['용문역', 36.3382, 127.393], ['탄방역', 36.3454, 127.385], ['시청역', 36.3514, 127.387], ['정부청사역', 36.3577, 127.381],
  ['갈마역', 36.3575, 127.373], ['월평역', 36.3583, 127.364], ['갑천역', 36.3542, 127.355], ['유성온천역', 36.3537, 127.341],
  ['구암역', 36.3566, 127.331], ['현충원역', 36.359, 127.321], ['월드컵경기장역', 36.3669, 127.318], ['노은역', 36.3741, 127.318],
  ['지족역', 36.3841, 127.32], ['반석역', 36.3921, 127.315],
].map(([name, lat, lon], i) => ({ name, pos: [lat, lon], idx: i }));
const dist = (a, b) => L.latLng(a).distanceTo(L.latLng(b)) / 1000; // km
const mins = (km, kmh) => Math.max(1, Math.round((km / kmh) * 60));

// ---------- 실시간 위치 ----------
function useLocation() {
  const [loc, setLoc] = useState({ pos: DAEJEON_CENTER, live: false, error: null });
  useEffect(() => {
    if (!navigator.geolocation) {
      setLoc((l) => ({ ...l, error: '이 기기는 위치 기능을 지원하지 않아요' }));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setLoc({ pos: [p.coords.latitude, p.coords.longitude], live: true, error: null }),
      () => setLoc((l) => ({ ...l, error: '위치 권한이 없어 대전시청 기준으로 보여드려요' })),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return loc;
}

// ---------- 실시간 날씨 (Open-Meteo, 10분마다) ----------
const WEATHER = {
  0: ['☀️', '맑음'], 1: ['🌤️', '대체로 맑음'], 2: ['⛅', '구름 조금'], 3: ['☁️', '흐림'],
  45: ['🌫️', '안개'], 48: ['🌫️', '안개'], 51: ['🌦️', '이슬비'], 53: ['🌦️', '이슬비'], 55: ['🌦️', '이슬비'],
  61: ['🌧️', '비'], 63: ['🌧️', '비'], 65: ['🌧️', '강한 비'], 71: ['🌨️', '눈'], 73: ['🌨️', '눈'],
  75: ['❄️', '강한 눈'], 80: ['🌦️', '소나기'], 81: ['🌧️', '소나기'], 82: ['⛈️', '강한 소나기'],
  95: ['⛈️', '뇌우'], 96: ['⛈️', '뇌우'], 99: ['⛈️', '뇌우'],
};
function useWeather(pos) {
  const [w, setW] = useState(null);
  const key = `${pos[0].toFixed(2)},${pos[1].toFixed(2)}`;
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [lat, lon] = key.split(',');
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FSeoul`);
        const d = await r.json();
        if (alive) setW(d.current);
      } catch {
        if (alive) setW((p) => p ?? { failed: true });
      }
    };
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [key]);
  return w;
}
function WeatherChip({ pos }) {
  const w = useWeather(pos);
  if (!w) return <div className="weather">…</div>;
  if (w.failed) return <div className="weather">날씨 –</div>;
  const [emoji, label] = WEATHER[w.weather_code] ?? ['🌡️', ''];
  const warn = w.weather_code >= 51 ? '라이딩 주의' : w.wind_speed_10m > 30 ? '강풍' : null;
  return (
    <div className="weather">
      <b>{Math.round(w.temperature_2m)}°</b><span className="w-l">{label}</span>
      {warn && <span className="w-warn">{warn}</span>}
    </div>
  );
}

// ---------- 대중교통 + 타슈 데이터 (OpenStreetMap) ----------
function dedupe(list) {
  const seen = new Map();
  for (const s of list) if (!seen.has(s.name)) seen.set(s.name, s);
  return [...seen.values()];
}
async function loadNearby(center) {
  const [lat, lon] = center;
  const q = `[out:json][timeout:20];node["highway"="bus_stop"](around:900,${lat},${lon});out body;`;
  let j = null;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(9000) });
      const t = await r.text();
      if (t.startsWith('{')) { j = JSON.parse(t); break; }
    } catch { /* 다음 서버 시도 */ }
  }
  if (!j) throw new Error('overpass unavailable');
  return { bus: j.elements.map((e) => ({ name: e.tags.name || '버스정류장', pos: [e.lat, e.lon] })) };
}
const nearest = (list, p) => list.reduce((best, s) => { const d = dist(p, s.pos); return !best || d < best.d ? { ...s, d } : best; }, null);

// 타슈 대여소 1,414곳 (대여이력의 실제 좌표) 중 반경 1.5km 안
const TASHU = STATIONS.map(([name, lat, lon, rides]) => ({ name, pos: [lat, lon], rides }));
const tashuNear = (c) => TASHU.filter((s) => Math.abs(s.pos[0] - c[0]) < 0.015 && Math.abs(s.pos[1] - c[1]) < 0.018 && dist(c, s.pos) < 1.5);

function useTransit(center) {
  const key = `${center[0].toFixed(3)},${center[1].toFixed(3)}`;
  const [data, setData] = useState({ subway: SUBWAY, tashu: tashuNear(center), bus: [], loaded: false, failed: false });
  useEffect(() => {
    let alive = true;
    const c = key.split(',').map(Number);
    setData((d) => ({ ...d, tashu: tashuNear(c) }));
    loadNearby(c)
      .then((n) => alive && setData((d) => ({ ...d, ...n, loaded: true, failed: false })))
      .catch(() => alive && setData((d) => ({ ...d, loaded: true, failed: true })));
    return () => { alive = false; };
  }, [key]);
  return data;
}

// 크기 = 중요도: 지하철 > 타슈 대여소 > 버스정류장
const icons = {
  subway: (name) => L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
    html: `<div class="mk mk-subway">${trainSvg()}</div><div class="lbl lbl-subway">${name}</div>` }),
  tashu: (name) => L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
    html: `<div class="mk mk-tashu">${bikeSvg('#111111')}</div><div class="lbl lbl-tashu">${name}</div>` }),
  bus: (name) => L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6],
    html: `<div class="mk mk-bus"></div><div class="lbl lbl-bus">${name}</div>` }),
};

function useTransitLayer(mapRef, transit, center) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const g = L.layerGroup().addTo(map);
    transit.bus.forEach((s) => L.marker(s.pos, { icon: icons.bus(s.name), zIndexOffset: 100 }).addTo(g));
    transit.tashu.forEach((s) => L.marker(s.pos, { icon: icons.tashu(s.name), zIndexOffset: 400 }).addTo(g));
    transit.subway.filter((s) => dist(center, s.pos) < 6).forEach((s) => L.marker(s.pos, { icon: icons.subway(s.name), zIndexOffset: 700 }).addTo(g));
    const zoomClass = () => {
      const el = map.getContainer(); const z = map.getZoom();
      el.classList.toggle('z-bus-lbl', z >= 17);
      el.classList.toggle('z-tashu-lbl', z >= 18);
    };
    zoomClass(); map.on('zoomend', zoomClass);
    return () => { map.off('zoomend', zoomClass); g.remove(); };
  }, [mapRef, transit, center]);
}


// ---------- 시간대 (출근 · 퇴근 · 평시) + 혼잡 구간 ----------
const BANDS = [
  { key: 'am', nm: '출근', sub: '07–09시' },
  { key: 'pm', nm: '퇴근', sub: '17–19시' },
  { key: 'off', nm: '평시', sub: '그 외' },
];
const defaultBand = () => {
  const d = new Date(), h = d.getHours(), wd = d.getDay() >= 1 && d.getDay() <= 5;
  return wd && h >= 7 && h < 9 ? 0 : wd && h >= 17 && h < 19 ? 1 : 2;
};
const CONG_STYLE = { 2: { color: C.K3, weight: 5 }, 3: { color: C.K, weight: 6 } }; // 혼잡 = 회색, 정체 = 검정

function useCongestion(mapRef, band, dim = false) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const g = L.layerGroup().addTo(map);
    for (const [a, b, name, lv] of CONG) {
      const l = lv[band];
      if (l < 2) continue;
      L.polyline([a, b], { color: C.W, weight: CONG_STYLE[l].weight + 4, opacity: dim ? 0.4 : 0.9, interactive: false }).addTo(g);
      L.polyline([a, b], { ...CONG_STYLE[l], opacity: dim ? 0.35 : 0.9, lineCap: 'round' })
        .bindTooltip(`${name} · ${l === 3 ? '정체' : '혼잡'}`, { sticky: true }).addTo(g);
    }
    return () => g.remove();
  }, [mapRef, band, dim]);
}

// 자전거 경로가 혼잡·정체 도로를 얼마나 지나는지 (35m 이내를 같은 도로로 봄)
function congestedKm(geo, band) {
  const segs = CONG.filter((c) => c[3][band] >= 2);
  if (!segs.length) return 0;
  const k = 111000, kx = 111000 * Math.cos(36.35 * Math.PI / 180);
  const xy = ([lat, lon]) => [lon * kx, lat * k];
  const segXY = segs.map(([a, b]) => [xy(a), xy(b)]);
  const near = (p) => segXY.some(([a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < 35;
  });
  const pts = geo.coordinates.map(([lon, lat]) => [lat, lon]);
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    const mid = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
    if (near(xy(mid))) m += dist(pts[i - 1], pts[i]);
  }
  return m;
}

function BandBar({ band, setBand }) {
  return (
    <div className="band-bar">
      <div className="band-seg">
        {BANDS.map((b, i) => (
          <button key={b.key} aria-pressed={band === i} onClick={() => setBand(i)}>{b.nm}<small>{b.sub}</small></button>
        ))}
      </div>
      <div className="band-legend"><span><i className="lg-2" />혼잡</span><span><i className="lg-3" />정체</span></div>
    </div>
  );
}

// ---------- 배지 ----------
const loadBadges = () => { try { return JSON.parse(localStorage.getItem('tashu-badges') || '{}'); } catch { return {}; } };
const saveBadge = (id) => { const b = loadBadges(); b[id] = b[id] || Date.now(); try { localStorage.setItem('tashu-badges', JSON.stringify(b)); } catch { /* 저장 불가 */ } return b; };
const ANIMAL = { dog: '강아지', cat: '고양이', heart: '하트', fish: '물고기', rabbit: '토끼', star: '별' };

function Medal({ id, got, size = 96 }) {
  const fill = got ? C.Y : C.K5, ring = got ? C.K : C.K4, ink = got ? C.K : C.K4, rib = got ? C.K : C.K4;
  return (
    <svg width={size} height={size * 1.12} viewBox="0 0 100 112" aria-hidden="true">
      <path d="M31 78 L22 110 L36 102 L44 112 L50 84Z" fill={rib} />
      <path d="M69 78 L78 110 L64 102 L56 112 L50 84Z" fill={got ? C.K2 : C.K4} />
      <circle cx="50" cy="48" r="44" fill={fill} stroke={ring} strokeWidth="3" />
      <circle cx="50" cy="48" r="38" fill="none" stroke={C.W} strokeWidth="1.6" strokeDasharray="2 3" />
      <g transform="translate(50 48) scale(.56) translate(-50 -50)">
        <path d={ART[id]} fill="none" stroke={C.W} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
        <path d={ART[id]} fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function CourseThumb({ c, size = 64 }) {
  const xs = c.pts.map((p) => p[1]), ys = c.pts.map((p) => -p[0]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, sc = 72 / Math.max(w, h);
  const ox = 14 + (72 - w * sc) / 2, oy = 14 + (72 - h * sc) / 2;
  const d = c.pts.map((p, i) => `${i ? 'L' : 'M'}${((p[1] - x0) * sc + ox).toFixed(1)} ${((-p[0] - y0) * sc + oy).toFixed(1)}`).join(' ');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="18" fill={C.Y3} />
      <path d={d} fill="none" stroke={C.W} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={C.K} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BadgeScreen({ back, openCourse }) {
  const got = loadBadges();
  const n = COURSES.filter((c) => got[c.id]).length;
  return (
    <div className="screen info">
      <header className="info-head"><button className="back" onClick={back}>←</button><b style={{ flex: 1 }}>코스 배지</b><span className="bdg-count">배지 {n}/6</span></header>
      <div className="info-body">
        <section className="card">
          <h3>코스 배지 {n}/6</h3>
          <div className="bdg-progress"><b>{n}/6</b><div className="pass-bar"><div style={{ width: `${(n / 6) * 100}%` }} /></div></div>
          <p className="bdg-desc">길안내의 "오늘은 어떤 경로로 자전거를 타볼까?"에서 동물 모양 코스를 끝까지 달리면 그 모양의 배지를 받아요. 배지를 누르면 그 코스로 바로 가요.</p>
        </section>
        <div className="bdg-grid">
          {COURSES.map((c) => (
            <button key={c.id} className={got[c.id] ? 'bdg on' : 'bdg'} onClick={() => openCourse(c.id)}>
              <Medal id={c.id} got={!!got[c.id]} />
              <b>{c.badge}</b>
              <small>{c.nm} · {c.km}km</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- 지도 ----------
function useMap(ref, center) {
  const mapRef = useRef(null);
  const [, force] = useState(0);
  useEffect(() => {
    const map = L.map(ref.current, { zoomControl: false }).setView(center, 16);
    // 밝고 차분한 지도 스타일 (CARTO Voyager)
    // 노랑·검정·흰색 3색 벡터 지도 (OpenFreeMap, 한글 지명)
    const box = () => ref.current?.parentElement;
    const gl = L.maplibreGL({ style: mapStyle, attribution: '© OpenFreeMap © OpenStreetMap', localIdeographFontFamily: "'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif" }).addTo(map);
    let ok = false;
    gl.getMaplibreMap().once('idle', () => { ok = true; box()?.classList.remove('map-failed'); });
    setTimeout(() => { if (!ok) box()?.classList.add('map-failed'); }, 12000);
    mapRef.current = map; force((n) => n + 1);
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mapRef;
}
function useMeMarker(mapRef, pos, follow) {
  const m = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!m.current) m.current = L.marker(pos, { icon: L.divIcon({ className: '', html: myLocationHtml(44), iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: 1000 }).addTo(map);
    else m.current.setLatLng(pos);
    if (follow) map.panTo(pos);
  }, [mapRef, pos, follow]);
}

function MapFail() {
  return (
    <div className="map-fail">
      <b>지도를 불러오지 못했어요</b>
      <p>인터넷 연결을 확인해 주세요.<br/>채팅 미리보기 창에서는 지도가 막혀 있어요.<br/>파일을 내려받아 <b>크롬</b>에서 열어 주세요.</p>
    </div>
  );
}

// ---------- 스플래시 ----------
function Splash({ onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="splash" onClick={onDone}>
      <div className="splash-icon" dangerouslySetInnerHTML={{ __html: bikeSvg('#111111') }} />
      <h1>타슈 내비</h1>
      <p>대중교통 + 타슈, 한 번에</p>
    </div>
  );
}

// ---------- 메인 지도 ----------
function Home({ loc, go, band, setBand }) {
  const el = useRef(null);
  const mapRef = useMap(el, loc.pos);
  const [follow, setFollow] = useState(true);
  const transit = useTransit(loc.pos);
  useMeMarker(mapRef, loc.pos, follow);
  useTransitLayer(mapRef, transit, loc.pos);
  useCongestion(mapRef, band);
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    const off = () => setFollow(false);
    m.on('dragstart', off); return () => m.off('dragstart', off);
  }, [mapRef]);

  const sub = nearest(transit.subway, loc.pos);
  const tashu = nearest(transit.tashu, loc.pos);
  const bus = nearest(transit.bus, loc.pos);
  const focus = (s) => s && mapRef.current?.setView(s.pos, 17);

  return (
    <div className="screen">
      <div ref={el} className="map" /><MapFail />
      <WeatherChip pos={loc.pos} />
      <BandBar band={band} setBand={setBand} />
      {loc.error && <div className="toast">{loc.error}</div>}
      <button className="badge-fab" onClick={() => go('badges')}><Medal id="star" got size={30} /><small>배지</small></button>
      <button className="recenter" onClick={() => { setFollow(true); mapRef.current?.setView(loc.pos, 16); }} aria-label="내 위치로">⊙</button>

      {/* 연계 카드: 지하철(가장 크게) > 타슈 > 버스 */}
      <div className="link-card">
        {(
          <>
            <button className="lc-main" onClick={() => focus(sub)}>
              <span className="lc-ico subway" dangerouslySetInnerHTML={{ __html: trainSvg() }} />
              <div><small>가까운 지하철</small><b>{sub ? sub.name : '없음'}</b></div>
              {sub && <div className="lc-time"><b>타슈 {mins(sub.d, SPEED.bike)}분</b><small>{sub.d.toFixed(1)}km</small></div>}
            </button>
            <div className="lc-row">
              <button className="lc-sub" onClick={() => focus(tashu)}>
                <span className="lc-ico tashu" dangerouslySetInnerHTML={{ __html: bikeSvg('#111111') }} />
                <div><small>{tashu ? `타슈 · ${tashu.name}` : '타슈 대여소'}</small><b>{tashu ? `도보 ${mins(tashu.d * 1.2, SPEED.walk)}분` : '1.5km 안에 없음'}</b></div>
              </button>
              <button className="lc-mini" onClick={() => focus(bus)}>
                <span className="lc-ico bus" />
                <div><small>버스</small><b>{bus ? `${Math.round(bus.d * 1000)}m` : !transit.loaded ? '…' : transit.failed ? '정보 없음' : '–'}</b></div>
              </button>
            </div>
          </>
        )}
      </div>

      <nav className="bottom-bar">
        <button className="side-btn" onClick={() => go('left')}><span dangerouslySetInnerHTML={{ __html: bikeSvg('#111111') }} /><small>대여소</small></button>
        <button className="nav-btn" onClick={() => go('route')} aria-label="최적 경로 길찾기"><span>➤</span><small>길찾기</small></button>
        <button className="side-btn" onClick={() => go('right')}><span dangerouslySetInnerHTML={{ __html: personSvg() }} /><small>내 정보</small></button>
      </nav>
    </div>
  );
}

// ---------- 최적 경로 (타슈 + 지하철 연계) ----------
async function bikeRoute(a, b) {
  try {
    const r = await fetch(`https://routing.openstreetmap.de/routed-bike/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`);
    const j = await r.json();
    const rt = j.routes[0];
    return { geo: rt.geometry, km: rt.distance / 1000, exact: true };
  } catch {
    return { geo: { type: 'LineString', coordinates: [[a[1], a[0]], [b[1], b[0]]] }, km: dist(a, b) * 1.3, exact: false };
  }
}

function RouteScreen({ loc, back, band, setBand, initialCourse }) {
  const el = useRef(null);
  const mapRef = useMap(el, loc.pos);
  const layerRef = useRef(null);
  const transit = useTransit(loc.pos);
  const [dest, setDest] = useState(null);
  const [plans, setPlans] = useState(null);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [course, setCourse] = useState(null);
  const [riding, setRiding] = useState(false);
  const [visited, setVisited] = useState(() => new Set());
  const [won, setWon] = useState(null);
  useMeMarker(mapRef, loc.pos, riding);
  useTransitLayer(mapRef, transit, loc.pos);
  useCongestion(mapRef, band, !!plans || !!course);

  const draw = useCallback((plan) => {
    const map = mapRef.current;
    if (layerRef.current) layerRef.current.remove();
    const g = L.layerGroup().addTo(map); layerRef.current = g;
    const all = [];
    for (const leg of plan.legs) {
      const style = leg.mode === 'subway' ? { color: C.K, weight: 6 }
        : leg.mode === 'walk' ? { color: C.K3, weight: 5, dashArray: '1 9', lineCap: 'round' }
        : { color: C.Y, weight: 8 };
      const line = L.geoJSON(leg.geo, { style }).addTo(g); all.push(line);
    }
    L.marker(plan.dest, { icon: L.divIcon({ className: '', html: '<div class="dest-pin"></div>', iconSize: [32, 32], iconAnchor: [16, 30] }) }).addTo(g);
    map.fitBounds(L.featureGroup(all).getBounds(), { padding: [60, 60], paddingBottomRight: [40, 300] });
  }, [mapRef]);

  const find = async (d) => {
    setDest(d); setLoading(true); setPlans(null); setCourse(null); setRiding(false);
    const me = loc.pos;
    const bikeOnly = await bikeRoute(me, d.pos);
    const options = [{
      title: '타슈만 타기', exact: bikeOnly.exact, dest: d.pos,
      legs: [{ mode: 'bike', geo: bikeOnly.geo, min: mins(bikeOnly.km, SPEED.bike), label: `타슈 ${bikeOnly.km.toFixed(1)}km` }],
    }];
    const s1 = nearest(SUBWAY, me), s2 = nearest(SUBWAY, d.pos);
    if (s1 && s2 && s1.name !== s2.name && s1.d < 3 && s2.d < 1.5) {
      const b1 = await bikeRoute(me, s1.pos);
      const stops = Math.abs(s1.idx - s2.idx);
      const lineCoords = SUBWAY.slice(Math.min(s1.idx, s2.idx), Math.max(s1.idx, s2.idx) + 1).map((s) => [s.pos[1], s.pos[0]]);
      options.push({
        title: '타슈 + 지하철', exact: b1.exact, dest: d.pos,
        legs: [
          { mode: 'bike', geo: b1.geo, min: mins(b1.km, SPEED.bike), label: `타슈 → ${s1.name}` },
          { mode: 'subway', geo: { type: 'LineString', coordinates: lineCoords }, min: stops * MIN_PER_STATION + SUBWAY_WAIT_MIN, label: `지하철 ${s1.name} → ${s2.name} (${stops}정거장)` },
          { mode: 'walk', geo: { type: 'LineString', coordinates: [[s2.pos[1], s2.pos[0]], [d.pos[1], d.pos[0]]] }, min: mins(s2.d * 1.25, SPEED.walk), label: `도보 → ${d.name}` },
        ],
      });
    }
    options.forEach((o) => {
      o.total = o.legs.reduce((a, l) => a + l.min, 0);
      o.congKm = o.legs.filter((l) => l.mode === 'bike').reduce((a, l) => a + congestedKm(l.geo, band), 0);
    });
    options.sort((a, b) => a.total - b.total);
    setPlans(options); setSel(0); draw(options[0]); setLoading(false);
  };

  const pick = (i) => { setSel(i); draw(plans[i]); };

  // ----- 동물 모양 코스 -----
  const showCourse = useCallback((c) => {
    const map = mapRef.current; if (!map) return;
    setCourse(c); setPlans(null); setDest(null); setRiding(false); setVisited(new Set()); setWon(null);
    if (layerRef.current) layerRef.current.remove();
    const g = L.layerGroup().addTo(map); layerRef.current = g;
    L.polyline(c.pts, { color: C.K, weight: 10, opacity: 1, lineJoin: 'round' }).addTo(g);
    const line = L.polyline(c.pts, { color: C.Y, weight: 6, lineJoin: 'round' }).addTo(g);
    c.pts.forEach((p, i) => L.circleMarker(p, { radius: 3, color: C.K, weight: 1.5, fillColor: C.W, fillOpacity: 1 }).bindTooltip(c.names[i] || '', { direction: 'top' }).addTo(g));
    L.marker(c.pts[0], { icon: L.divIcon({ className: '', html: '<div class="start-pin">출발</div>', iconSize: [40, 22], iconAnchor: [20, 30] }) }).addTo(g);
    map.fitBounds(line.getBounds(), { paddingTopLeft: [30, 150], paddingBottomRight: [30, 430] });
  }, [mapRef]);
  useEffect(() => {
    if (initialCourse && mapRef.current) showCourse(COURSES.find((c) => c.id === initialCourse));
  }, [initialCourse, mapRef, showCourse, mapRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // 코스 달리는 중: 실시간 위치가 코스의 대여소 지점 60m 안에 들어오면 지나간 것으로 표시
  useEffect(() => {
    if (!riding || !course || !loc.live) return;
    setVisited((v) => {
      const n = new Set(v);
      course.pts.forEach((p, i) => { if (dist(loc.pos, p) < 0.06) n.add(i); });
      return n;
    });
  }, [riding, course, loc.pos, loc.live]);
  useEffect(() => {
    if (!riding || !course || won) return;
    if (visited.size >= Math.ceil(course.pts.length * 0.9)) { saveBadge(course.id); setWon(course); setRiding(false); }
  }, [visited, riding, course, won]);
  const MODE = { bike: '타슈', subway: '지하철', walk: '도보' };

  return (
    <div className="screen">
      <div ref={el} className="map" /><MapFail />
      <header className="route-head">
        <button className="back" onClick={back}>←</button>
        <div><b>최적 경로 길찾기</b><small>출발: 현재 위치 {loc.live ? '(실시간)' : '(대전시청 기준)'}</small></div>
      </header>
      <div className="route-band"><BandBar band={band} setBand={setBand} /></div>
      <div className="sheet">
        {won && (
          <div className="won"><Medal id={won.id} got size={70} /><div><b>완주! {won.badge}를 받았어요</b><small>배지 보관함에서 볼 수 있어요.</small></div></div>
        )}
        {course && !won && (() => {
          const got = loadBadges()[course.id];
          const pct = Math.round((visited.size / course.pts.length) * 100);
          return (
            <div className="course-card">
              <div className="cc-head"><CourseThumb c={course} size={58} /><div><b>{course.nm}</b><small>{course.area} · 대여소 {course.stops}곳 · 실제 이용 구간 {course.ridden}%</small></div></div>
              <div className="cc-sum"><span className="big">{Math.round(course.km / 12 * 60)}분</span><span>{course.km}km · 혼잡 도로 0m</span><span className="badge">{got ? '배지 받음' : `완주하면 ${course.badge}`}</span></div>
              {riding ? (
                <div className="cc-ride">
                  <div className="pass-bar"><div style={{ width: `${pct}%` }} /></div>
                  <small>{loc.live ? `코스 지점 ${visited.size}/${course.pts.length} 지남 · 90% 지나면 완주` : '실시간 위치를 켜야 완주를 확인할 수 있어요'}</small>
                  <button className="cc-btn ghost" onClick={() => setRiding(false)}>그만 달리기</button>
                </div>
              ) : (
                <button className="cc-btn" onClick={() => { setRiding(true); mapRef.current?.setView(course.pts[0], 16); }}>코스 시작하기</button>
              )}
            </div>
          );
        })()}
        {!plans && !course && <div className="route-info"><b>{loading ? '타슈·지하철 연계 경로 찾는 중…' : '어디로 갈까요?'}</b></div>}
        {plans && plans.map((p, i) => (
          <button key={p.title} className={`plan ${i === 0 ? 'best' : 'alt'} ${sel === i ? 'on' : ''}`} onClick={() => pick(i)}>
            <div className="plan-top">
              {i === 0 && <span className="badge">추천</span>}
              <span className="plan-title">{p.title}</span>
              <span className="plan-total">{p.total}분</span>
            </div>
            <div className="legs">
              {p.legs.map((l, k) => (
                <span key={k} className={`leg ${l.mode}`} style={{ flexGrow: l.min }} title={l.label}>{MODE[l.mode]} {l.min}분</span>
              ))}
            </div>
            {i === 0 && <small className="plan-desc">{p.legs.map((l) => l.label).join(' · ')}{p.legs.some((l) => l.mode === 'subway') ? ' (지하철 시간은 예상치)' : ''}</small>}
            <small className="plan-cong">{BANDS[band].nm} 기준 · {p.congKm >= 0.05 ? `혼잡 도로 ${p.congKm.toFixed(1)}km 지나요` : '혼잡 도로를 지나지 않아요'}</small>
          </button>
        ))}
        <div className="chips">
          {DESTINATIONS.map((d) => (
            <button key={d.name} className={dest?.name === d.name ? 'chip on' : 'chip'} onClick={() => find(d)}>{d.name}</button>
          ))}
        </div>
        <div className="crs-title">오늘은 어떤 경로로 자전거를 타볼까?</div>
        <div className="crs-row">
          {COURSES.map((c) => (
            <button key={c.id} className={course?.id === c.id ? 'crs on' : 'crs'} onClick={() => showCourse(c)}>
              <CourseThumb c={c} size={64} />
              <b>{c.nm}</b><small>{c.km}km{loadBadges()[c.id] ? ' · 배지 ✓' : ''}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Placeholder({ title, icon, desc, back }) {
  return (
    <div className="screen plain">
      <header className="route-head static"><button className="back" onClick={back}>←</button><b>{title}</b></header>
      <div className="placeholder">
        <div className="ph-ico" dangerouslySetInnerHTML={{ __html: icon }} />
        <p>{desc}</p>
        <small>이 화면에 들어갈 기능을 알려주시면 채워 넣을게요.</small>
      </div>
    </div>
  );
}

// ---------- 내 정보 ----------
const PASS = { start: '2026-06-01', end: '2027-05-31' };
const MONTH_STATS = { label: '10월 라이딩', km: 42.6, count: 14, co2: 6.1 };
const HISTORY = [
  { route: '둔산동 목련아파트 → 엑스포과학공원', date: '10.27', km: 3.1 },
  { route: '탄방동 한사랑병원 → 갑천 자전거길', date: '10.24', km: 2.4 },
  { route: '대전역 → 중앙로역', date: '10.20', km: 1.6 },
];
const DATA_SOURCES = [
  '대전광역시 도로별 택시 평균 통행량 및 속도 (2025년 1–12월, 도로 링크 9,615개)',
  '대전 도시철도 1호선 역별 시간대 승하차 (2026년 1–9월 평일)',
  '대전시 행정구역별 일반택시 승하차 통계 (2025년)',
  '타슈 대여소 현황 (2026.06.24, 1,377곳)',
  '타슈 대여이력 (2025.08–2026.03, 3,978,584건) — 대여소 실제 좌표, 시간대별 대여량, 많이 타는 구간',
  '행정동 경계: 통계청 SGIS 자료를 가공한 vuski/admdongkor (2026.10.01, CC BY 4.0)',
];
const SETTINGS = [
  ['voice', '음성 안내'],
  ['avoid', '혼잡 구간 자동 회피'],
  ['returnAlert', '반납 알림 (50분 경과 시)'],
];
function loadSettings() {
  try { return { voice: true, avoid: true, returnAlert: true, ...JSON.parse(localStorage.getItem('tashu-settings') || '{}') }; }
  catch { return { voice: true, avoid: true, returnAlert: true }; }
}

function MyInfo({ back }) {
  const [set, setSet] = useState(loadSettings);
  const toggle = (k) => setSet((s) => {
    const n = { ...s, [k]: !s[k] };
    try { localStorage.setItem('tashu-settings', JSON.stringify(n)); } catch { /* 저장 불가 환경 */ }
    return n;
  });
  const day = 86400000;
  const today = new Date(new Date().toDateString());
  const start = new Date(PASS.start), end = new Date(PASS.end);
  const left = Math.max(0, Math.ceil((end - today) / day));
  const progress = Math.min(1, Math.max(0, (today - start) / (end - start)));
  const fmt = (d) => d.replaceAll('-', '.');

  return (
    <div className="screen info">
      <header className="info-head"><button className="back" onClick={back}>←</button><b>내 정보</b></header>
      <div className="info-body">
        <section className="card icon-card">
          <div className="app-icon" dangerouslySetInnerHTML={{ __html: bikeSvg('#111111') }} />
          <div>
            <b>타슈 네비 앱 아이콘</b>
            <p>휴대폰 브라우저에서 이 페이지를 연 뒤 공유 → <b>홈 화면에 추가</b>를 누르면 타슈 아이콘으로 바탕화면에 생겨요.</p>
          </div>
        </section>

        <section className="card pass-card">
          <div className="pass-top"><b>1년 이용권</b><span>D-{left}</span></div>
          <div className="pass-bar"><div style={{ width: `${progress * 100}%` }} /></div>
          <small>{fmt(PASS.start)} ~ {fmt(PASS.end)} · 1회 최대 60분</small>
        </section>

        <section className="card">
          <h3>{MONTH_STATS.label}</h3>
          <div className="stats">
            <div><b>{MONTH_STATS.km}</b><small>km</small></div>
            <div><b>{MONTH_STATS.count}</b><small>회 이용</small></div>
            <div><b>{MONTH_STATS.co2}</b><small>kg CO₂ 절감</small></div>
          </div>
        </section>

        <section className="card">
          <h3>최근 이용 기록</h3>
          {HISTORY.map((h) => (
            <div className="hist" key={h.route + h.date}><span>{h.route}</span><small>{h.date} · {h.km}km</small></div>
          ))}
        </section>

        <section className="card">
          <h3>설정</h3>
          {SETTINGS.map(([k, label]) => (
            <label className="setting" key={k}>
              <span>{label}</span>
              <button role="switch" aria-checked={set[k]} className={set[k] ? 'sw on' : 'sw'} onClick={() => toggle(k)}><i /></button>
            </label>
          ))}
        </section>

        <section className="card data-card">
          <h3>사용한 데이터</h3>
          {DATA_SOURCES.map((d) => <p key={d}>· {d}</p>)}
          <p>대여소 1,408곳은 대여이력의 실제 좌표, 나머지 6곳은 동 경계 안 근사 위치예요. 도로·하천은 대략 좌표예요.</p>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('splash');
  const loc = useLocation();
  const home = useCallback(() => setScreen('home'), []);
  const [band, setBand] = useState(defaultBand);
  const [courseId, setCourseId] = useState(null);
  const go = useCallback((sc) => { setCourseId(null); setScreen(sc); }, []);
  const openCourse = useCallback((id) => { setCourseId(id); setScreen('route'); }, []);
  return (
    <div className="phone">
      {screen === 'splash' && <Splash onDone={home} />}
      {screen === 'home' && <Home loc={loc} go={go} band={band} setBand={setBand} />}
      {screen === 'route' && <RouteScreen loc={loc} back={home} band={band} setBand={setBand} initialCourse={courseId} />}
      {screen === 'badges' && <BadgeScreen back={home} openCourse={openCourse} />}
      {screen === 'left' && <Placeholder title="대여소" icon={bikeSvg('#111111')} desc="왼쪽 아래 버튼 화면 (예: 주변 타슈 대여소)" back={home} />}
      {screen === 'right' && <MyInfo back={home} />}
    </div>
  );
}
