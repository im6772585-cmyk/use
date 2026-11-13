import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { bikeSvg, myLocationHtml } from './rider.js';

const DAEJEON_CENTER = [36.3504, 127.3845]; // 대전시청
const DAEJEON_BBOX = '36.20,127.25,36.50,127.50';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const DESTINATIONS = [
  { name: '대전역', pos: [36.3326, 127.4342] },
  { name: '엑스포과학공원', pos: [36.3758, 127.3866] },
  { name: '한밭수목원', pos: [36.3687, 127.388] },
  { name: '대전시청', pos: [36.3504, 127.3845] },
  { name: '충남대학교', pos: [36.3663, 127.3443] },
  { name: 'KAIST', pos: [36.3721, 127.3604] },
  { name: '유성온천역', pos: [36.3538, 127.3418] },
];

const SPEED = { bike: 15, walk: 4.5, subway: 33 }; // km/h
const SUBWAY_WAIT_MIN = 4;
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
      <span>{emoji}</span><b>{Math.round(w.temperature_2m)}°</b><span className="w-l">{label}</span>
      {warn && <span className="w-warn">{warn}</span>}
    </div>
  );
}

// ---------- 대중교통 + 타슈 데이터 (OpenStreetMap) ----------
const allSubwayCache = { p: null };
function loadAllSubway() {
  if (!allSubwayCache.p) {
    const q = `[out:json][timeout:25];(node["railway"="station"]["station"="subway"](${DAEJEON_BBOX});node["public_transport"="station"]["subway"="yes"](${DAEJEON_BBOX}););out body;`;
    allSubwayCache.p = fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q) })
      .then((r) => r.json())
      .then((j) => dedupe(j.elements.map((e) => ({ name: (e.tags.name || '역').replace(/역$/, '') + '역', pos: [e.lat, e.lon] }))))
      .catch(() => { allSubwayCache.p = null; return []; });
  }
  return allSubwayCache.p;
}
function dedupe(list) {
  const seen = new Map();
  for (const s of list) if (!seen.has(s.name)) seen.set(s.name, s);
  return [...seen.values()];
}
async function loadNearby(center) {
  const [lat, lon] = center;
  const q = `[out:json][timeout:20];(node["amenity"="bicycle_rental"](around:1500,${lat},${lon});node["highway"="bus_stop"](around:900,${lat},${lon}););out body;`;
  const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q) });
  const j = await r.json();
  const tashu = [], bus = [];
  for (const e of j.elements) {
    const item = { name: e.tags.name || (e.tags.amenity ? '타슈 대여소' : '버스정류장'), pos: [e.lat, e.lon] };
    (e.tags.amenity === 'bicycle_rental' ? tashu : bus).push(item);
  }
  return { tashu, bus };
}
const nearest = (list, p) => list.reduce((best, s) => { const d = dist(p, s.pos); return !best || d < best.d ? { ...s, d } : best; }, null);

function useTransit(center) {
  const [data, setData] = useState({ subway: [], tashu: [], bus: [], loaded: false, failed: false });
  const key = `${center[0].toFixed(3)},${center[1].toFixed(3)}`;
  useEffect(() => {
    let alive = true;
    const [lat, lon] = key.split(',').map(Number);
    Promise.all([loadAllSubway(), loadNearby([lat, lon])])
      .then(([subway, n]) => alive && setData({ subway, ...n, loaded: true, failed: false }))
      .catch(() => alive && setData((d) => ({ ...d, loaded: true, failed: true })));
    return () => { alive = false; };
  }, [key]);
  return data;
}

// 크기 = 중요도: 지하철 > 타슈 대여소 > 버스정류장
const icons = {
  subway: (name) => L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
    html: `<div class="mk mk-subway">🚇</div><div class="lbl lbl-subway">${name}</div>` }),
  tashu: (name) => L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
    html: `<div class="mk mk-tashu">${bikeSvg('#ffffff')}</div><div class="lbl lbl-tashu">${name}</div>` }),
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
      el.classList.toggle('z-tashu-lbl', z >= 15);
    };
    zoomClass(); map.on('zoomend', zoomClass);
    return () => { map.off('zoomend', zoomClass); g.remove(); };
  }, [mapRef, transit, center]);
}

// ---------- 지도 ----------
function useMap(ref, center) {
  const mapRef = useRef(null);
  const [, force] = useState(0);
  useEffect(() => {
    const map = L.map(ref.current, { zoomControl: false }).setView(center, 16);
    // 밝고 차분한 지도 스타일 (CARTO Voyager)
    // 1순위 CARTO Voyager, 실패하면 OpenStreetMap 기본 지도로 자동 전환
    let errors = 0, loaded = 0, switched = false;
    const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap · © CARTO',
    }).addTo(map);
    const showFail = () => ref.current?.parentElement?.classList.add('map-failed');
    carto.on('tileload', () => { loaded++; ref.current?.parentElement?.classList.remove('map-failed'); });
    carto.on('tileerror', () => {
      if (++errors < 4 || loaded || switched) return;
      switched = true; carto.remove();
      const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      let ok = false; osm.on('tileload', () => { ok = true; ref.current?.parentElement?.classList.remove('map-failed'); });
      setTimeout(() => { if (!ok) showFail(); }, 5000);
    });
    setTimeout(() => { if (!loaded && !switched) showFail(); }, 8000);
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
      <div className="splash-icon" dangerouslySetInnerHTML={{ __html: bikeSvg('#2fa84f') }} />
      <h1>타슈 내비</h1>
      <p>대중교통 + 타슈, 한 번에</p>
    </div>
  );
}

// ---------- 메인 지도 ----------
function Home({ loc, go }) {
  const el = useRef(null);
  const mapRef = useMap(el, loc.pos);
  const [follow, setFollow] = useState(true);
  const transit = useTransit(loc.pos);
  useMeMarker(mapRef, loc.pos, follow);
  useTransitLayer(mapRef, transit, loc.pos);
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
      {loc.error && <div className="toast">{loc.error}</div>}
      <button className="recenter" onClick={() => { setFollow(true); mapRef.current?.setView(loc.pos, 16); }} aria-label="내 위치로">◎</button>

      {/* 연계 카드: 지하철(가장 크게) > 타슈 > 버스 */}
      <div className="link-card">
        {!transit.loaded ? <div className="lc-loading">주변 대중교통·타슈 찾는 중…</div> : transit.failed ? <div className="lc-loading">주변 정보를 불러오지 못했어요</div> : (
          <>
            <button className="lc-main" onClick={() => focus(sub)}>
              <span className="lc-ico subway">🚇</span>
              <div><small>가까운 지하철</small><b>{sub ? sub.name : '없음'}</b></div>
              {sub && <div className="lc-time"><b>🚲 {mins(sub.d, SPEED.bike)}분</b><small>{sub.d.toFixed(1)}km</small></div>}
            </button>
            <div className="lc-row">
              <button className="lc-sub" onClick={() => focus(tashu)}>
                <span className="lc-ico tashu" dangerouslySetInnerHTML={{ __html: bikeSvg('#fff') }} />
                <div><small>타슈 대여소</small><b>{tashu ? `도보 ${mins(tashu.d, SPEED.walk)}분` : '정보 없음'}</b></div>
              </button>
              <button className="lc-mini" onClick={() => focus(bus)}>
                <span className="lc-ico bus" />
                <div><small>버스</small><b>{bus ? `${Math.round(bus.d * 1000)}m` : '–'}</b></div>
              </button>
            </div>
          </>
        )}
      </div>

      <nav className="bottom-bar">
        <button className="side-btn" onClick={() => go('left')}><span dangerouslySetInnerHTML={{ __html: bikeSvg('#1f3b2d') }} /><small>대여소</small></button>
        <button className="nav-btn" onClick={() => go('route')} aria-label="최적 경로 길찾기"><span>➤</span><small>길찾기</small></button>
        <button className="side-btn" onClick={() => go('right')}><span>👤</span><small>내 정보</small></button>
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

function RouteScreen({ loc, back }) {
  const el = useRef(null);
  const mapRef = useMap(el, loc.pos);
  const layerRef = useRef(null);
  const transit = useTransit(loc.pos);
  const [dest, setDest] = useState(null);
  const [plans, setPlans] = useState(null);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  useMeMarker(mapRef, loc.pos, false);
  useTransitLayer(mapRef, transit, loc.pos);

  const draw = useCallback((plan) => {
    const map = mapRef.current;
    if (layerRef.current) layerRef.current.remove();
    const g = L.layerGroup().addTo(map); layerRef.current = g;
    const all = [];
    for (const leg of plan.legs) {
      const style = leg.mode === 'subway' ? { color: '#1f6f4a', weight: 6, dashArray: '2 10', lineCap: 'round' }
        : leg.mode === 'walk' ? { color: '#8a8f98', weight: 5, dashArray: '1 8', lineCap: 'round' }
        : { color: '#2fa84f', weight: 7 };
      const line = L.geoJSON(leg.geo, { style }).addTo(g); all.push(line);
    }
    L.marker(plan.dest, { icon: L.divIcon({ className: '', html: '<div class="dest-pin">🏁</div>', iconSize: [32, 32], iconAnchor: [16, 30] }) }).addTo(g);
    map.fitBounds(L.featureGroup(all).getBounds(), { padding: [60, 60], paddingBottomRight: [40, 300] });
  }, [mapRef]);

  const find = async (d) => {
    setDest(d); setLoading(true); setPlans(null);
    const me = loc.pos;
    const bikeOnly = await bikeRoute(me, d.pos);
    const options = [{
      title: '타슈만 타기', exact: bikeOnly.exact, dest: d.pos,
      legs: [{ mode: 'bike', geo: bikeOnly.geo, min: mins(bikeOnly.km, SPEED.bike), label: `타슈 ${bikeOnly.km.toFixed(1)}km` }],
    }];
    const subway = transit.subway.length ? transit.subway : await loadAllSubway();
    const s1 = nearest(subway, me), s2 = nearest(subway, d.pos);
    if (s1 && s2 && s1.name !== s2.name && s1.d < 3 && s2.d < 1.5) {
      const b1 = await bikeRoute(me, s1.pos);
      const subKm = dist(s1.pos, s2.pos) * 1.15;
      options.push({
        title: '타슈 + 지하철', exact: b1.exact, dest: d.pos,
        legs: [
          { mode: 'bike', geo: b1.geo, min: mins(b1.km, SPEED.bike), label: `타슈 → ${s1.name}` },
          { mode: 'subway', geo: { type: 'LineString', coordinates: [[s1.pos[1], s1.pos[0]], [s2.pos[1], s2.pos[0]]] }, min: mins(subKm, SPEED.subway) + SUBWAY_WAIT_MIN, label: `지하철 ${s1.name} → ${s2.name}` },
          { mode: 'walk', geo: { type: 'LineString', coordinates: [[s2.pos[1], s2.pos[0]], [d.pos[1], d.pos[0]]] }, min: mins(s2.d * 1.25, SPEED.walk), label: `도보 → ${d.name}` },
        ],
      });
    }
    options.forEach((o) => { o.total = o.legs.reduce((a, l) => a + l.min, 0); });
    options.sort((a, b) => a.total - b.total);
    setPlans(options); setSel(0); draw(options[0]); setLoading(false);
  };

  const pick = (i) => { setSel(i); draw(plans[i]); };
  const MODE = { bike: '🚲', subway: '🚇', walk: '🚶' };

  return (
    <div className="screen">
      <div ref={el} className="map" /><MapFail />
      <header className="route-head">
        <button className="back" onClick={back}>←</button>
        <div><b>최적 경로 길찾기</b><small>출발: 현재 위치 {loc.live ? '(실시간)' : '(대전시청 기준)'}</small></div>
      </header>
      <div className="sheet">
        {!plans && <div className="route-info"><b>{loading ? '타슈·지하철 연계 경로 찾는 중…' : '어디로 갈까요?'}</b></div>}
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
          </button>
        ))}
        <div className="chips">
          {DESTINATIONS.map((d) => (
            <button key={d.name} className={dest?.name === d.name ? 'chip on' : 'chip'} onClick={() => find(d)}>{d.name}</button>
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

export default function App() {
  const [screen, setScreen] = useState('splash');
  const loc = useLocation();
  const home = useCallback(() => setScreen('home'), []);
  return (
    <div className="phone">
      {screen === 'splash' && <Splash onDone={home} />}
      {screen === 'home' && <Home loc={loc} go={setScreen} />}
      {screen === 'route' && <RouteScreen loc={loc} back={home} />}
      {screen === 'left' && <Placeholder title="대여소" icon={bikeSvg('#2fa84f')} desc="왼쪽 아래 버튼 화면 (예: 주변 타슈 대여소)" back={home} />}
      {screen === 'right' && <Placeholder title="내 정보" icon="<span style='font-size:56px'>👤</span>" desc="오른쪽 아래 버튼 화면 (예: 이용 기록·설정)" back={home} />}
    </div>
  );
}
