import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@maplibre/maplibre-gl-leaflet';
import { mapStyle, C } from './mapStyle.js';
import { CONG, COURSES, SUBWAY_LOAD } from './data.js';
import { ART } from './art.js';
import { bikeSvg, myLocationHtml, trainSvg, personSvg, busSvg, walkSvg, qrSvg, searchSvg, medalSvg } from './rider.js';
import { planAll, SUBWAY, TASHU, TRANSFER, nearest, dist, KCAL_PER_KM, CO2_G_PER_KM } from './plan.js';

const DAEJEON_CENTER = [36.3504, 127.3845]; // 대전시청
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const PLACES = [
  { name: '대전역', pos: [36.3326, 127.4342], kind: '명소' },
  { name: '엑스포과학공원', pos: [36.3758, 127.3866], kind: '명소' },
  { name: '한밭수목원', pos: [36.3687, 127.388], kind: '명소' },
  { name: '대전시청', pos: [36.3504, 127.3845], kind: '명소' },
  { name: '충남대학교', pos: [36.3663, 127.3443], kind: '명소' },
  { name: 'KAIST', pos: [36.3721, 127.3604], kind: '명소' },
  { name: '서대전역', pos: [36.3227, 127.4038], kind: '명소' },
  { name: '대전월드컵경기장', pos: [36.3653, 127.3253], kind: '명소' },
  ...SUBWAY.map((s) => ({ name: s.name, pos: s.pos, kind: '도시철도' })),
  ...TASHU.map((t) => ({ name: t.name, pos: t.pos, kind: `타슈 대여소 · ${t.dong}` })),
];
const MODE_ICON = { bike: bikeSvg, subway: trainSvg, bus: busSvg, walk: walkSvg };
const MODE_NM = { bike: '타슈', subway: '지하철', bus: '버스', walk: '걷기' };
const Icon = ({ svg, size = 20, className = '' }) => <span className={`ico ${className}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } } };

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
const CONG_STYLE = { 2: { color: C.Y2, weight: 5 }, 3: { color: C.K, weight: 6 } }; // 혼잡 = 중간 주황, 정체 = 진한 주황

function useCongestion(mapRef, band, dim = false, show = true) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !show) return;
    const g = L.layerGroup().addTo(map);
    for (const [a, b, name, lv] of CONG) {
      const l = lv[band];
      if (l < 2) continue;
      L.polyline([a, b], { color: C.W, weight: CONG_STYLE[l].weight + 4, opacity: dim ? 0.4 : 0.9, interactive: false }).addTo(g);
      L.polyline([a, b], { ...CONG_STYLE[l], opacity: dim ? 0.35 : 0.9, lineCap: 'round' })
        .bindTooltip(`${name} · ${l === 3 ? '정체' : '혼잡'}`, { sticky: true }).addTo(g);
    }
    return () => g.remove();
  }, [mapRef, band, dim, show]);
}

// 자전거 경로가 혼잡·정체 도로를 얼마나 지나는지 (35m 이내를 같은 도로로 봄)
function BandBar({ band, setBand, compact, legend }) {
  return (
    <div className={compact ? 'band-bar compact' : 'band-bar'}>
      <div className="band-seg">
        {BANDS.map((b, i) => (
          <button key={b.key} aria-pressed={band === i} onClick={() => setBand(i)}>{b.nm}<small>{b.sub}</small></button>
        ))}
      </div>
      {legend !== false && <div className="band-legend"><span><i className="lg-2" />혼잡</span><span><i className="lg-3" />정체</span></div>}
    </div>
  );
}

// ---------- 배지 ----------
const loadBadges = () => { try { return JSON.parse(localStorage.getItem('tashu-badges') || '{}'); } catch { return {}; } };
const saveBadge = (id) => { const b = loadBadges(); b[id] = b[id] || Date.now(); try { localStorage.setItem('tashu-badges', JSON.stringify(b)); } catch { /* 저장 불가 */ } return b; };
const ANIMAL = { dog: '강아지', cat: '고양이', heart: '하트', fish: '물고기', rabbit: '토끼', star: '별' };

function Medal({ id, got, size = 96 }) {
  const fill = got ? C.L : C.K5, ring = got ? C.K : C.K4, ink = got ? C.K : C.K4, rib = got ? C.K : C.K4;
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
        <h3 className="crs-title">오늘은 어떤 경로로 자전거를 타볼까?</h3>
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
    const glMap = gl.getMaplibreMap();
    const okNow = () => { ok = true; box()?.classList.remove('map-failed'); };
    glMap.once('load', okNow); glMap.on('sourcedata', (e) => { if (e.isSourceLoaded) okNow(); });
    // 도시철도역을 지도 글자와 같은 층에 그려서 역 이름과 지명이 서로 겹치지 않게 함
    const addSubway = () => {
      if (glMap.getSource('subway')) return;
      glMap.addSource('subway', { type: 'geojson', data: { type: 'FeatureCollection', features: SUBWAY.map((st) => ({ type: 'Feature', properties: { name: st.name }, geometry: { type: 'Point', coordinates: [st.pos[1], st.pos[0]] } })) } });
      glMap.addLayer({ id: 'subway-dot', type: 'circle', source: 'subway', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 15, 13], 'circle-color': C.K, 'circle-stroke-color': C.W, 'circle-stroke-width': 2.5 } });
      // 동그라미 안에 지하철 아이콘
      const img = new Image(48, 48);
      img.onload = () => {
        try {
          if (!glMap.hasImage('train')) glMap.addImage('train', img, { pixelRatio: 2 });
          if (!glMap.getLayer('subway-icon')) glMap.addLayer({ id: 'subway-icon', type: 'symbol', source: 'subway', layout: { 'icon-image': 'train', 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.45, 15, 0.95], 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, 'subway-name');
        } catch { /* 지도 준비 전이면 다음에 */ }
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(trainSvg('#DDF159').replace('<svg ', '<svg width="48" height="48" '));
      glMap.addLayer({ id: 'subway-name', type: 'symbol', source: 'subway', minzoom: 12,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 13, 16, 16], 'text-variable-anchor': ['top', 'bottom', 'right', 'left'], 'text-radial-offset': 1.1, 'text-padding': 6, 'symbol-sort-key': 0 },
        paint: { 'text-color': C.K, 'text-halo-color': C.W, 'text-halo-width': 3 } });
    };
    const tryAdd = () => { try { if (glMap.isStyleLoaded()) addSubway(); } catch { /* 다음 기회에 다시 */ } };
    tryAdd(); glMap.on('load', tryAdd); glMap.on('styledata', tryAdd); glMap.on('idle', tryAdd);
    setTimeout(() => { if (!ok && !glMap.loaded()) box()?.classList.add('map-failed'); }, 30000);
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
      <b>지도를 불러오는 중이에요</b>
      <p>지도 서버가 느리면 조금 걸릴 수 있어요.<br/>계속 안 보이면 인터넷 연결을 확인하고 새로고침해 주세요.</p>
    </div>
  );
}


// ---------- 지도 표시: 도시철도역 > 환승 대여소 > 일반 대여소 > 버스정류장 ----------
async function loadBus(center) {
  const [lat, lon] = center;
  const q = `[out:json][timeout:20];node["highway"="bus_stop"](around:900,${lat},${lon});out body;`;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(9000) });
      const t = await r.text();
      if (t.startsWith('{')) return JSON.parse(t).elements.map((e) => ({ name: e.tags.name || '버스정류장', pos: [e.lat, e.lon] }));
    } catch { /* 다음 서버 */ }
  }
  throw new Error('bus unavailable');
}
function useBus(center) {
  const key = `${center[0].toFixed(3)},${center[1].toFixed(3)}`;
  const [bus, setBus] = useState({ list: [], loaded: false, failed: false });
  useEffect(() => {
    let alive = true;
    loadBus(key.split(',').map(Number)).then((list) => alive && setBus({ list, loaded: true })).catch(() => alive && setBus({ list: [], loaded: true, failed: true }));
    return () => { alive = false; };
  }, [key]);
  return bus;
}

const TRANSFER_IDS = new Set(TRANSFER.flatMap((t) => t.list.slice(0, 1).map((s) => s.id)));
const peakName = (r) => { const per = [r[0] / 2, r[1] / 2, r[2] / 20]; const i = per.indexOf(Math.max(...per)); return ['출근 07–09시', '퇴근 17–19시', '평시'][i]; };
const stationPopup = (t) => `
  <div class="pop">
    <b>${t.name}</b>
    <div class="pop-row">${t.addr || '주소 정보 없음'} · ${t.dong}</div>
    <div class="pop-row">좌표 ${t.pos[0].toFixed(6)}, ${t.pos[1].toFixed(6)}</div>
    <div class="pop-row">대여 ${t.total.toLocaleString()}건 (8개월) · 시간당 가장 많은 때: <b>${peakName(t.rents)}</b></div>
    <div class="pop-row small">출근 ${t.rents[0].toLocaleString()} · 퇴근 ${t.rents[1].toLocaleString()} · 평시 ${t.rents[2].toLocaleString()}건</div>
    <div class="pop-btns"><button data-act="from" data-id="${t.id}">출발지로</button><button data-act="to" data-id="${t.id}">목적지로</button></div>
  </div>`;

function useStationLayers(mapRef, bus, onPick) {
  const pickRef = useRef(onPick); pickRef.current = onPick;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const g = L.layerGroup().addTo(map);
    // 버스정류장: 확대했을 때만 지름 14px
    const busG = L.layerGroup();
    bus.forEach((b) => L.marker(b.pos, { icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="mk mk-bus"></div>' }) }).bindTooltip(b.name, { direction: 'top' }).addTo(busG));
    const zoomCheck = () => { if (map.getZoom() >= 16) busG.addTo(g); else busG.remove(); map.getContainer().classList.toggle('z-sub-lbl', map.getZoom() >= 14); map.getContainer().classList.toggle('z-bus-lbl', map.getZoom() >= 17); };
    zoomCheck(); map.on('zoomend', zoomCheck);
    const onPop = (e) => {
      e.popup.getElement()?.querySelectorAll('button[data-act]').forEach((btn) => btn.addEventListener('click', () => {
        const t = TASHU.find((x) => x.id === btn.dataset.id);
        map.closePopup();
        pickRef.current?.(btn.dataset.act, { name: t.name, pos: t.pos });
      }));
    };
    map.on('popupopen', onPop);
    return () => { map.off('zoomend', zoomCheck); map.off('popupopen', onPop); g.remove(); };
  }, [mapRef, bus, mapRef.current]); // eslint-disable-line react-hooks/exhaustive-deps
}

// 고른 대여소 하나만 지도에 표시
function useSelectedStation(mapRef, sel) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sel) return;
    const m = L.marker(sel.pos, { zIndexOffset: 1200, icon: L.divIcon({ className: '', iconSize: [36, 44], iconAnchor: [18, 42], html: `<div class="st-pin">${bikeSvg('#15273E')}</div>` }) })
      .bindPopup(stationPopup(sel), { maxWidth: 260, offset: [0, -36], autoPanPaddingTopLeft: [20, 230], autoPanPaddingBottomRight: [20, 120] }).addTo(map);
    map.setView(sel.pos, Math.max(map.getZoom(), 16));
    setTimeout(() => m.openPopup(), 300);
    return () => m.remove();
  }, [mapRef, sel]);
}

// 대여소 목록: 가까운 순 + 이름 검색. 고르면 그 대여소만 지도에 표시
function StationPicker({ center, onClose, onSelect }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const k = q.trim();
    const base = k ? TASHU.filter((t) => t.name.includes(k) || t.dong.includes(k)) : TASHU.filter((t) => Math.abs(t.pos[0] - center[0]) < 0.02 && Math.abs(t.pos[1] - center[1]) < 0.025);
    return base.map((t) => ({ ...t, d: dist(center, t.pos), xfer: TRANSFER_IDS.has(t.id) })).sort((a, b) => a.d - b.d).slice(0, 40);
  }, [q, center]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal station-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>타슈 대여소</b><button className="x" onClick={onClose} aria-label="닫기">×</button></div>
        <input className="st-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="대여소 이름이나 동 이름으로 찾기" />
        <small className="note">{q ? `검색 결과 ${list.length}곳` : '가까운 대여소부터 보여 드려요'} · 대전 전체 {TASHU.length.toLocaleString()}곳</small>
        <div className="st-list">
          {list.map((t) => (
            <button key={t.id} className="ret-row" onClick={() => onSelect(t)}>
              <span><b>{t.name}{t.xfer && <i className="xf-tag">환승</i>}</b><small>{t.dong} · {t.d < 1 ? `${Math.round(t.d * 1000)}m` : `${t.d.toFixed(1)}km`}</small></span><em>지도에서 보기</em>
            </button>
          ))}
          {!list.length && <p className="note">찾는 대여소가 없어요.</p>}
        </div>
      </div>
    </div>
  );
}

// ---------- 타슈 대여 (QR · 자전거 번호, 무료 59분) ----------
const FREE_MIN = 59;
function useRental() {
  const [rental, setRental] = useState(() => store.get('tashu-rental', null));
  const [history, setHistory] = useState(() => store.get('tashu-history', []));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!rental) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [rental]);
  const left = rental ? FREE_MIN * 60 - Math.floor((now - rental.start) / 1000) : 0;
  const warnedRef = useRef({});
  useEffect(() => {
    if (!rental) return;
    const notify = (msg) => { try { if (Notification?.permission === 'granted') new Notification('타슈 내비', { body: msg }); } catch { /* 알림 불가 */ } navigator.vibrate?.(300); };
    if (left <= 300 && left > 0 && !warnedRef.current.five) { warnedRef.current.five = true; notify('무료 이용 시간이 5분 남았어요. 가까운 대여소에 반납해 주세요.'); }
    if (left <= 0 && !warnedRef.current.over) { warnedRef.current.over = true; notify('무료 59분이 지났어요. 추가 요금이 붙을 수 있어요.'); }
  }, [left, rental]);
  const start = (bike) => {
    const r = { bike, start: Date.now() };
    warnedRef.current = {};
    store.set('tashu-rental', r); setRental(r);
    try { Notification?.requestPermission?.(); } catch { /* 알림 불가 */ }
  };
  const finish = (station) => {
    const h = [{ bike: rental.bike, start: rental.start, end: Date.now(), station: station.name }, ...history].slice(0, 30);
    store.set('tashu-history', h); setHistory(h);
    store.set('tashu-rental', null); setRental(null);
  };
  return { rental, left, start, finish, history };
}
const fmtLeft = (s) => { const a = Math.abs(s); return `${s < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };

function RentTimer({ rent, onReturn }) {
  if (!rent.rental) return null;
  const cls = rent.left <= 0 ? 'timer over' : rent.left <= 300 ? 'timer warn' : 'timer';
  return (
    <button className={cls} onClick={onReturn}>
      <Icon svg={bikeSvg('currentColor')} size={20} />
      <span><small>{rent.rental.bike} · {rent.left <= 0 ? '무료 시간 초과' : '무료 남은 시간'}</small><b>{fmtLeft(rent.left)}</b></span>
      <em>반납</em>
    </button>
  );
}

function RentModal({ onClose, onStart }) {
  const [tab, setTab] = useState('qr');
  const [num, setNum] = useState('');
  const [err, setErr] = useState('');
  const videoRef = useRef(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  useEffect(() => {
    if (tab !== 'qr' || !supported) return;
    let stream, timer, alive = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!alive) return;
        videoRef.current.srcObject = stream; await videoRef.current.play();
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async () => {
          const codes = await det.detect(videoRef.current).catch(() => []);
          if (codes[0]) {
            const m = codes[0].rawValue.match(/[A-Z]{2}\d-?\d{3,5}/i);
            clearInterval(timer);
            onStart(m ? m[0].toUpperCase() : codes[0].rawValue.slice(0, 20));
          }
        }, 500);
      } catch { setErr('카메라를 쓸 수 없어요. 자전거 번호를 입력해 주세요.'); setTab('num'); }
    })();
    return () => { alive = false; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [tab, supported, onStart]);
  const submit = (e) => {
    e.preventDefault();
    const v = num.trim().toUpperCase();
    if (!/^[A-Z]{2}\d-?\d{3,5}$/.test(v)) { setErr('자전거 번호 형식을 확인해 주세요 (예: DJ3-5015)'); return; }
    onStart(v.includes('-') ? v : `${v.slice(0, 3)}-${v.slice(3)}`);
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>타슈 대여하기</b><button className="x" onClick={onClose} aria-label="닫기">×</button></div>
        <div className="seg2">
          <button aria-pressed={tab === 'qr'} onClick={() => setTab('qr')}>QR 스캔</button>
          <button aria-pressed={tab === 'num'} onClick={() => setTab('num')}>번호 입력</button>
        </div>
        {tab === 'qr' ? (
          supported ? <div className="qr-box"><video ref={videoRef} playsInline muted /><i /><small>자전거 핸들의 QR 코드를 네모 안에 맞춰 주세요</small></div>
            : <p className="note">이 브라우저는 QR 읽기를 지원하지 않아요. 번호 입력을 이용해 주세요.</p>
        ) : (
          <form onSubmit={submit} className="num-form">
            <input value={num} onChange={(e) => { setNum(e.target.value); setErr(''); }} placeholder="DJ3-5015" autoFocus inputMode="text" />
            <button type="submit">대여 시작</button>
          </form>
        )}
        {err && <p className="err">{err}</p>}
        <p className="note">대여하면 무료 59분 타이머가 시작돼요. 5분 남으면 알려 드려요.<br />※ 앱 시연판이라 실제 자전거 잠금은 풀리지 않아요.</p>
      </div>
    </div>
  );
}

function ReturnModal({ loc, rent, onClose }) {
  const near = useMemo(() => TASHU.map((t) => ({ ...t, d: dist(loc.pos, t.pos) })).sort((a, b) => a.d - b.d).slice(0, 4), [loc.pos]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>가까운 대여소에 반납</b><button className="x" onClick={onClose} aria-label="닫기">×</button></div>
        <p className="note">{rent.rental.bike} · 이용 {Math.max(1, Math.round((FREE_MIN * 60 - rent.left) / 60))}분</p>
        {near.map((t) => (
          <button key={t.id} className="ret-row" onClick={() => { rent.finish(t); onClose(); }}>
            <span><b>{t.name}</b><small>{t.dong} · {Math.round(t.d * 1000)}m</small></span><em>여기에 반납</em>
          </button>
        ))}
      </div>
    </div>
  );
}


// ---------- 시작 화면 ----------
function Splash({ onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="splash" onClick={onDone}>
      <div className="splash-icon" dangerouslySetInnerHTML={{ __html: bikeSvg('#FFFFFF') }} />
      <h1>올라타슈 내려타슈</h1>
    </div>
  );
}

// ---------- 홈 (지도) ----------
function Home({ loc, go, band, setBand, rent, openReturn, pick }) {
  const el = useRef(null);
  const mapRef = useMap(el, loc.pos);
  const [follow, setFollow] = useState(true);
  const bus = useBus(loc.pos);
  useMeMarker(mapRef, loc.pos, follow);
  const [showCong, setShowCong] = useState(false);
  useCongestion(mapRef, band, false, showCong);
  useStationLayers(mapRef, bus.list, pick);
  const [picker, setPicker] = useState(false);
  const [sel, setSel] = useState(null);
  const [hideToast, setHideToast] = useState(false);
  const [target, setTarget] = useState(null);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const onClick = (e) => {
      const pos = [e.latlng.lat, e.latlng.lng];
      const st = nearest(TASHU, pos), sb = nearest(SUBWAY, pos);
      const name = sb.d < 0.3 ? `${sb.name} 부근` : st.d < 0.15 ? `${st.name} 부근` : `${st.dong} 부근`;
      setTarget({ name, pos, st, sb }); setFollow(false);
    };
    map.on('click', onClick); return () => map.off('click', onClick);
  }, [mapRef, mapRef.current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current; if (!map || !target) return;
    const m = L.marker(target.pos, { zIndexOffset: 1300, icon: L.divIcon({ className: '', html: '<div class="dest-pin"></div>', iconSize: [30, 30], iconAnchor: [15, 28] }) }).addTo(map);
    return () => m.remove();
  }, [mapRef, target]);
  useEffect(() => { const t = setTimeout(() => setHideToast(true), 6000); return () => clearTimeout(t); }, []);
  useSelectedStation(mapRef, sel);
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    const off = () => setFollow(false);
    m.on('dragstart', off); return () => m.off('dragstart', off);
  }, [mapRef, mapRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const sub = nearest(SUBWAY, loc.pos);
  const xfer = TRANSFER[sub.idx].list[0];
  return (
    <div className="screen">
      <div ref={el} className="map" /><MapFail />
      <div className="home-top">
        <button className="search" onClick={() => go('route')}>
          <span className="search-modes"><Icon svg={bikeSvg('#15273E')} size={24} /></span>
          <span className="search-ph">어디로 갈까요?</span>
          <Icon svg={searchSvg()} size={22} />
        </button>
        <div className="home-sub">
          <WeatherChip pos={loc.pos} />
          <button className={showCong ? 'cong-toggle on' : 'cong-toggle'} onClick={() => setShowCong((v) => !v)} aria-pressed={showCong}>{showCong ? '혼잡 구역 끄기' : '혼잡 구역 보기'}</button>
        </div>
        {showCong && <BandBar band={band} setBand={setBand} compact />}
        <RentTimer rent={rent} onReturn={openReturn} />
      </div>
      {loc.error && !hideToast && <div className="toast">{loc.error}</div>}
      <button className="recenter" onClick={() => { setFollow(true); mapRef.current?.setView(loc.pos, 16); }} aria-label="내 위치로">⊙</button>

      <button className="st-fab" onClick={() => { setFollow(false); setPicker(true); }} aria-label="대여소 보기"><Icon svg={bikeSvg('#15273E')} size={22} /><small>대여소</small></button>
      {sel && <button className="st-clear" onClick={() => setSel(null)}>{sel.name} ✕</button>}
      {target ? (
        <div className="target-card">
          <div className="tc-txt"><b>{target.name}</b><small>가까운 대여소 {target.st.name} · {Math.round(target.st.d * 1000)}m</small></div>
          <button className="tc-go" onClick={() => pick('to', { name: target.name, pos: target.pos })}>여기로 길찾기</button>
          <button className="tc-x" onClick={() => setTarget(null)} aria-label="선택 취소">✕</button>
        </div>
      ) : (
      <button className="near-chip" onClick={() => { setFollow(false); if (xfer) setSel(xfer); else mapRef.current?.setView(sub.pos, 17); }}>
        <span className="lc-ico subway" dangerouslySetInnerHTML={{ __html: trainSvg() }} />
        <b>{sub.name}</b><span>{sub.d < 1 ? `${Math.round(sub.d * 1000)}m` : `${sub.d.toFixed(1)}km`}</span>
        {xfer && <em>환승 대여소 ›</em>}
      </button>
      )}
      {picker && <StationPicker center={loc.pos} onClose={() => setPicker(false)} onSelect={(t) => { setSel(t); setPicker(false); }} />}

      <nav className="bottom-bar">
        <button className="side-btn" onClick={() => go('badges')}><Icon svg={medalSvg()} size={24} /><small>배지</small></button>
        <button className="nav-btn" onClick={() => go('route')} aria-label="길찾기">
          <span className="nav-arrow">➤</span><small>길찾기</small>
        </button>
        <button className="side-btn" onClick={() => go('my')}><Icon svg={personSvg()} size={24} /><small>MY</small></button>
      </nav>
    </div>
  );
}

// ---------- 길찾기: 세 경로 비교 + 안내 ----------
const LEG_STYLE = {
  bike: { color: C.Y2, weight: 6 },
  subway: { color: C.K, weight: 6 },
  bus: { color: C.K2, weight: 6 },
  walk: { color: C.Y, weight: 4, dashArray: '1 8', lineCap: 'round' },
};
function ModeBar({ legs }) {
  const total = legs.reduce((a, l) => a + l.min, 0);
  return (
    <div className="modebar">
      {legs.map((l, i) => (
        <div key={i} className={`mb-seg mb-${l.mode}`} style={{ flexGrow: Math.max(l.min, total * 0.08) }}>
          <span className="mb-ico"><Icon svg={MODE_ICON[l.mode]('#15273E')} size={20} />{l.min / total >= 0.15 && <small>{l.min}분</small>}</span>
          <i />
          {i < legs.length - 1 && l.mode !== 'walk' && legs[i + 1].mode !== 'walk' && <em className="mb-x">⇄</em>}
        </div>
      ))}
    </div>
  );
}
function stepsOf(p) {
  const s = [];
  const m = (km) => (km < 1 ? `${Math.round(km * 100) * 10}m` : `${km.toFixed(1)}km`);
  for (const l of p.legs) {
    if (l.mode === 'walk') {
      const tgt = l.label.replace(/까지 걷기.*$/, '').replace(/ 개찰구까지$/, '').replace(/ 환승 대여소까지$/, '');
      s.push({ mode: 'walk', title: l.label.includes('목적지') ? '목적지까지 걷기' : `${tgt}까지 걷기`, sub: `${l.min}분${l.km > 0.05 ? ` · ${m(l.km)}` : ''}`, to: l.geo.coordinates.at(-1) });
    }
    if (l.mode === 'subway') {
      s.push({ mode: 'subway', title: `${l.from.name} 승차`, sub: `${l.to.idx < l.from.idx ? '판암' : '반석'} 방면 · 대기 약 ${l.wait}분`, to: [l.from.pos[1], l.from.pos[0]] });
      s.push({ mode: 'subway', title: `${l.to.name} 하차`, sub: `${l.stops}정거장 · ${l.min - l.wait}분`, to: [l.to.pos[1], l.to.pos[0]] });
    }
    if (l.mode === 'bus') s.push({ mode: 'bus', title: `시내버스 ${l.min - l.wait}분`, sub: `정류장 대기 약 ${l.wait}분 · 도로 혼잡도로 추정한 시간`, to: l.geo.coordinates.at(-1) });
    if (l.mode === 'bike') {
      if (l.rent) s.push({ mode: 'bike', title: '타슈 대여', sub: l.rent.name, to: [l.rent.pos[1], l.rent.pos[0]] });
      s.push({ mode: 'bike', title: `타슈 주행 ${l.min}분`, sub: `${m(l.km)}${l.congKm >= 0.05 ? ` · 혼잡 도로 ${m(l.congKm)} 지남` : ' · 혼잡 도로 없음'}`, to: l.geo.coordinates.at(-1) });
      if (l.ret) s.push({ mode: 'bike', title: '타슈 반납', sub: l.ret.name, to: [l.ret.pos[1], l.ret.pos[0]] });
    }
  }
  return s.map((x) => ({ ...x, text: `${x.title} · ${x.sub}` }));
}

function RouteScreen({ loc, back, band, setBand, initialCourse, trip, rent, openRent, openReturn }) {
  const el = useRef(null);
  const mapRef = useMap(el, loc.pos);
  const layerRef = useRef(null);
  const bus = useBus(loc.pos);
  const [from, setFrom] = useState(trip?.from || null); // null = 현재 위치
  const [to, setTo] = useState(trip?.to || null);
  const [editing, setEditing] = useState(trip?.to ? null : 'to');
  const [q, setQ] = useState('');
  const [bikeMode, setBikeMode] = useState('avoid');
  const [plans, setPlans] = useState(null);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [planErr, setPlanErr] = useState(false);
  const [retry, setRetry] = useState(0);
  const [guide, setGuide] = useState(null); // { steps, i, path, cum, total, plan }
  const [guideMin, setGuideMin] = useState(false);   // 위 안내 카드 접기
  const [panelOpen, setPanelOpen] = useState(false); // 아래 단계 목록 펼치기
  const [followMe, setFollowMe] = useState(true);    // 지도가 내 위치 따라가기
  const [simKm, setSimKm] = useState(null);          // 미리 따라가 보기 (위치 신호 없을 때)
  const [arrived, setArrived] = useState(false);
  const [course, setCourse] = useState(null);
  const [riding, setRiding] = useState(false);
  const [visited, setVisited] = useState(() => new Set());
  const [won, setWon] = useState(null);
  const origin = from || { name: loc.live ? '현재 위치' : '현재 위치 (대전시청 기준)', pos: loc.pos, here: true };

  const pathPoint = (g, km) => {
    if (!g) return null;
    let i = g.cum.findIndex((c) => c >= km); if (i <= 0) return g.path[Math.max(0, i)];
    const t = (km - g.cum[i - 1]) / (g.cum[i] - g.cum[i - 1] || 1);
    return [g.path[i - 1][0] + (g.path[i][0] - g.path[i - 1][0]) * t, g.path[i - 1][1] + (g.path[i][1] - g.path[i - 1][1]) * t];
  };
  const cur = guide && simKm != null ? pathPoint(guide, simKm) : loc.pos;
  useMeMarker(mapRef, cur, (!!guide && followMe) || riding);
  useCongestion(mapRef, band, true, false);
  useStationLayers(mapRef, bus.list, (act, place) => { if (act === 'from') setFrom(place); else setTo(place); setEditing(null); setSel(null); });
  const [picker, setPicker] = useState(false);
  const [sel, setSel] = useState(null);
  useSelectedStation(mapRef, sel);

  // 지도를 눌러 목적지 정하기
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const onClick = (e) => { if (guide || course) return; setTo({ name: '지도에서 고른 곳', pos: [e.latlng.lat, e.latlng.lng] }); setEditing(null); };
    map.on('click', onClick); return () => map.off('click', onClick);
  }, [mapRef, mapRef.current, guide, course]); // eslint-disable-line react-hooks/exhaustive-deps

  // 출발·도착·시간대·자전거 기준이 바뀌면 세 경로 다시 계산
  const originKey = from ? from.pos.join() : 'here';
  const tripKeyRef = useRef('');
  const userPickedRef = useRef(false); // 사용자가 직접 탭을 고른 경우에만 그 탭 유지
  useEffect(() => {
    if (!to || course) return;
    let alive = true;
    setLoading(true);
    setPlanErr(false);
    planAll(origin.pos, to.pos, band, bikeMode).catch(() => null).then((ps) => {
      if (!alive) return;
      if (!ps) { setPlanErr(true); setLoading(false); return; }
      setPlans(ps);
      const tripKey = `${originKey}|${to.pos.join()}`;
      const fastest = ps.findIndex((x) => x.fastest);
      if (tripKeyRef.current !== tripKey) userPickedRef.current = false;
      setTab((t) => (!userPickedRef.current || ps[t]?.none ? fastest : t)); // 기본은 항상 가장 빠른(추천) 경로
      tripKeyRef.current = tripKey;
      setLoading(false);
    });
    return () => { alive = false; };
  }, [to, originKey, band, bikeMode, course, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // 고른 경로만 굵게, 나머지는 흐리게
  useEffect(() => {
    const map = mapRef.current; if (!map || !plans || course) return;
    if (layerRef.current) layerRef.current.remove();
    const g = L.layerGroup().addTo(map); layerRef.current = g;
    let bounds = null;
    plans.forEach((p, i) => {
      if (p.none || i === tab) return;
      p.legs.forEach((l) => L.geoJSON(l.geo, { style: { ...LEG_STYLE[l.mode], opacity: 0.25, weight: 4 }, interactive: false }).addTo(g));
    });
    const p = plans[tab];
    if (p && !p.none) {
      p.legs.forEach((l) => {
        if (l.mode !== 'walk') L.geoJSON(l.geo, { style: { color: C.W, weight: 10, opacity: 0.9 } }).addTo(g);
        const ly = L.geoJSON(l.geo, { style: LEG_STYLE[l.mode] }).addTo(g);
        bounds = bounds ? bounds.extend(ly.getBounds()) : ly.getBounds();
        if (l.mode === 'subway') l.stations.forEach((s) => L.circleMarker(s, { radius: 3, color: C.K, weight: 1, fillColor: C.W, fillOpacity: 1 }).addTo(g));
      });
      // 환승 지점: 흰 원 + 진한 테두리 ⇄
      p.legs.slice(0, -1).forEach((l, i) => {
        const nx = p.legs[i + 1];
        if (l.mode === nx.mode || (l.mode === 'walk' && nx.mode === 'walk')) return;
        const c = l.geo.coordinates.at(-1);
        L.marker([c[1], c[0]], { zIndexOffset: 900, icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: '<div class="xfer-pt">⇄</div>' }) }).addTo(g);
      });
      L.marker(to.pos, { zIndexOffset: 950, icon: L.divIcon({ className: '', html: '<div class="dest-pin"></div>', iconSize: [30, 30], iconAnchor: [15, 28] }) }).addTo(g);
      if (bounds && !guide) map.fitBounds(bounds, { paddingTopLeft: [30, 190], paddingBottomRight: [30, 360] });
    }
  }, [plans, tab, mapRef, course]); // eslint-disable-line react-hooks/exhaustive-deps

  // 안내 중: 다음 지점 60m 안에 들어오면 다음 단계로
  useEffect(() => {
    if (!guide || (!loc.live && simKm == null)) return;
    const st = guide.steps[guide.i];
    if (st?.to && dist(cur, [st.to[1], st.to[0]]) < 0.06) next();
  }, [cur?.[0], cur?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  // 미리 따라가 보기: 실제 속도의 약 20배로 경로를 따라 이동
  useEffect(() => {
    if (!guide || simKm == null) return;
    if (simKm >= guide.total) { setSimKm(null); setGuide(null); setArrived(true); return; }
    const t = setTimeout(() => setSimKm((k) => Math.min(guide.total, k + 0.03)), 120);
    return () => clearTimeout(t);
  }, [simKm, guide]);
  // 지도를 손으로 움직이면 따라가기 잠시 멈춤
  useEffect(() => {
    const map = mapRef.current; if (!map || !guide) return;
    const off = () => setFollowMe(false);
    map.on('dragstart', off); return () => map.off('dragstart', off);
  }, [mapRef, guide]);
  // 지나온 길은 흐리게
  const progress = useMemo(() => {
    if (!guide) return null;
    let best = 0, bd = 1e9;
    guide.path.forEach((pt, i) => { const d = dist(cur, pt); if (d < bd) { bd = d; best = i; } });
    const doneKm = simKm != null ? simKm : guide.cum[best];
    const leftKm = Math.max(0, guide.total - doneKm);
    const leftMin = Math.max(1, Math.round(guide.plan.min * (leftKm / (guide.total || 1))));
    return { idx: best, leftKm, leftMin, arrive: new Date(Date.now() + leftMin * 60000), off: bd > 0.12 && loc.live && simKm == null };
  }, [guide, cur?.[0], cur?.[1], simKm]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current; if (!map || !guide || !progress) return;
    const done = L.polyline(guide.path.slice(0, progress.idx + 1), { color: '#B9C2C9', weight: 8, opacity: 0.95, interactive: false }).addTo(map);
    return () => done.remove();
  }, [mapRef, guide, progress?.idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const startGuide = (plan, steps) => {
    const path = [];
    plan.legs.forEach((l) => l.geo.coordinates.forEach(([lon, lat]) => { const pt = [lat, lon]; if (!path.length || dist(path.at(-1), pt) > 0.002) path.push(pt); }));
    const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
    setGuide({ steps, i: 0, path, cum, total: cum.at(-1) || 0.001, plan });
    setArrived(false); setFollowMe(true); setGuideMin(false); setPanelOpen(false); setSimKm(null);
    mapRef.current?.setView(loc.live ? loc.pos : path[0], 17);
  };
  const endGuide = () => { setGuide(null); setSimKm(null); };
  const next = () => setGuide((g) => {
    if (!g) return g;
    if (g.i + 1 >= g.steps.length) { setArrived(true); return null; }
    return { ...g, i: g.i + 1 };
  });

  // ----- 동물 모양 코스 -----
  const showCourse = useCallback((c) => {
    const map = mapRef.current; if (!map) return;
    setCourse(c); setPlans(null); setRiding(false); setVisited(new Set()); setWon(null);
    if (layerRef.current) layerRef.current.remove();
    const g = L.layerGroup().addTo(map); layerRef.current = g;
    L.polyline(c.pts, { color: C.K, weight: 10, lineJoin: 'round' }).addTo(g);
    const line = L.polyline(c.pts, { color: C.Y2, weight: 6, lineJoin: 'round' }).addTo(g);
    c.pts.forEach((p, i) => L.circleMarker(p, { radius: 3, color: C.K, weight: 1.5, fillColor: C.W, fillOpacity: 1 }).bindTooltip(c.names[i] || '', { direction: 'top' }).addTo(g));
    L.marker(c.pts[0], { icon: L.divIcon({ className: '', html: '<div class="start-pin">출발</div>', iconSize: [40, 22], iconAnchor: [20, 30] }) }).addTo(g);
    map.fitBounds(line.getBounds(), { paddingTopLeft: [30, 120], paddingBottomRight: [30, 330] });
  }, [mapRef]);
  useEffect(() => { if (initialCourse && mapRef.current) showCourse(COURSES.find((c) => c.id === initialCourse)); }, [initialCourse, mapRef.current, showCourse]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!riding || !course || !loc.live) return;
    setVisited((v) => { const n = new Set(v); course.pts.forEach((p, i) => { if (dist(loc.pos, p) < 0.06) n.add(i); }); return n; });
  }, [riding, course, loc.pos, loc.live]);
  useEffect(() => {
    if (riding && course && !won && visited.size >= Math.ceil(course.pts.length * 0.9)) { saveBadge(course.id); setWon(course); setRiding(false); }
  }, [visited, riding, course, won]);

  const results = q.trim() ? PLACES.filter((p) => p.name.includes(q.trim())).slice(0, 8) : PLACES.slice(0, 8);
  const choose = (p) => { const v = { name: p.name, pos: p.pos }; if (editing === 'from') setFrom(v); else setTo(v); setEditing(null); setQ(''); };
  const swap = () => { const f = from, t = to; setTo(f ? f : { name: '현재 위치', pos: loc.pos }); setFrom(t); };
  const p = plans?.[tab];
  const steps = p && !p.none ? stepsOf(p) : [];
  const curStep = guide?.steps[guide.i];
  const nearRet = arrived && to ? nearest(TASHU, to.pos) : null;

  return (
    <div className={`screen route ${guide ? 'guiding' : ''}`}>
      <div ref={el} className="map" /><MapFail />

      {guide ? (
        <div className={`guide-card g-${curStep.mode} ${guideMin ? 'min' : ''}`}>
          <Icon svg={MODE_ICON[curStep.mode](curStep.mode === 'subway' || curStep.mode === 'bus' ? '#FFFFFF' : '#15273E')} size={guideMin ? 22 : 32} />
          <div><small>{guide.i + 1}/{guide.steps.length} 단계 · {MODE_NM[curStep.mode]}</small><b>{curStep.title}</b>
            {!guideMin && <span className="g-sub">{curStep.sub}</span>}
          </div>
          <button className="g-fold" onClick={() => setGuideMin((v) => !v)} aria-label={guideMin ? '안내 펼치기' : '안내 접기'}>{guideMin ? '▾' : '▴'}</button>
        </div>
      ) : course ? (
        <header className="route-head"><button className="back" onClick={back}>←</button><div><b>오늘은 어떤 경로로 자전거를 타볼까?</b><small>동물 모양 코스 · 완주하면 배지</small></div></header>
      ) : (
        <header className="route-fields">
          <button className="back" onClick={back} aria-label="뒤로">←</button>
          <div className="fields">
            <button className={editing === 'from' ? 'fld on' : 'fld'} onClick={() => setEditing('from')}><i className="dot-from" />{origin.name}</button>
            <button className={editing === 'to' ? 'fld on' : 'fld'} onClick={() => setEditing('to')}><i className="dot-to" />{to ? to.name : '어디로 갈까요?'}</button>
          </div>
          <button className="swap" onClick={swap} aria-label="출발지와 도착지 바꾸기">⇅</button>
        </header>
      )}
      {!guide && !course && !editing && <div className="route-band"><BandBar band={band} setBand={setBand} compact legend={false} /></div>}
      {!guide && <div className="route-timer"><RentTimer rent={rent} onReturn={openReturn} /></div>}
      {!guide && !editing && !course && <button className="st-fab route-st" onClick={() => setPicker(true)} aria-label="대여소 보기"><Icon svg={bikeSvg('#15273E')} size={22} /><small>대여소</small></button>}
      {picker && <StationPicker center={to ? to.pos : origin.pos} onClose={() => setPicker(false)} onSelect={(t) => { setSel(t); setPicker(false); }} />}

      {editing && !guide && (
        <div className="search-sheet">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={editing === 'from' ? '출발지 검색 (역·대여소·명소)' : '도착지 검색 (역·대여소·명소)'} />
          {editing === 'from' && <button className="res" onClick={() => { setFrom(null); setEditing(null); }}><b>현재 위치</b><small>내 위치에서 출발</small></button>}
          {results.map((r) => <button key={r.kind + r.name} className="res" onClick={() => choose(r)}><b>{r.name}</b><small>{r.kind}</small></button>)}
          <p className="note">지도를 눌러서 도착지를 정하거나, 대여소를 눌러 출발지로·목적지로를 고를 수도 있어요.</p>
          <button className="res close" onClick={() => setEditing(null)}>닫기</button>
        </div>
      )}

      {guide && progress && (
        <div className={`guide-panel ${panelOpen ? 'open' : ''}`}>
          <button className="gp-handle" onClick={() => setPanelOpen((v) => !v)} aria-label={panelOpen ? '단계 목록 내리기' : '단계 목록 올리기'}><i /><span>{panelOpen ? '내리기' : '전체 단계 보기'}</span></button>
          <div className="gp-sum">
            <div><b>{progress.leftKm < 1 ? `${Math.round(progress.leftKm * 1000)}m` : `${progress.leftKm.toFixed(1)}km`}</b><small>남은 거리</small></div>
            <div><b>{progress.leftMin}분</b><small>남은 시간</small></div>
            <div><b>{hhmm(progress.arrive)}</b><small>도착 예정</small></div>
          </div>
          {progress.off && <p className="gp-warn">경로에서 벗어났어요. 지도의 굵은 선을 따라 돌아가 주세요.</p>}
          {panelOpen && (
            <ol className="timeline gp-steps">{guide.steps.map((st, i) => (
              <li key={i} className={`tl-${st.mode} ${i < guide.i ? 'done' : i === guide.i ? 'now' : ''}`} onClick={() => setGuide((g) => ({ ...g, i }))}>
                <span className="tl-num">{i < guide.i ? '✓' : i + 1}</span>
                <Icon svg={MODE_ICON[st.mode]('#15273E')} size={22} className="tl-ico" />
                <span className="tl-txt"><b>{st.title}</b><small>{st.sub}</small></span>
              </li>
            ))}</ol>
          )}
          <div className="gp-btns">
            {!followMe && <button onClick={() => { setFollowMe(true); mapRef.current?.setView(cur, 17); }}>내 위치 따라가기</button>}
            {!loc.live && simKm == null && <button onClick={() => { setSimKm(0); setFollowMe(true); }}>미리 따라가 보기</button>}
            {simKm != null && <button onClick={() => setSimKm(null)}>미리보기 멈춤</button>}
            <button className="ghost" onClick={endGuide}>안내 종료</button>
          </div>
        </div>
      )}

      {!editing && !guide && (
        <div className="sheet">
          {won && <div className="won"><Medal id={won.id} got size={70} /><div><b>완주! {won.badge}를 받았어요</b><small>배지 화면에 모였어요.</small></div></div>}
          {arrived && (
            <div className="arrived">
              <b>{to?.name} 도착!</b>
              {p && <small>{p.bikeKm > 0 ? `타슈 ${p.bikeKm.toFixed(1)}km · 탄소 ${p.co2.toLocaleString()}g 감축 · ${p.kcal}kcal` : '대중교통으로 도착했어요'}</small>}
              {nearRet && <small>가까운 반납 대여소: <b>{nearRet.name}</b> ({Math.round(nearRet.d * 1000)}m)</small>}
              {rent.rental ? <button className="cc-btn" onClick={() => { rent.finish(nearRet); setArrived(false); }}>{nearRet.name}에 반납하기</button> : <button className="cc-btn ghost" onClick={() => setArrived(false)}>확인</button>}
            </div>
          )}

          {course && !won && (() => {
            const got = loadBadges()[course.id];
            const pct = Math.round((visited.size / course.pts.length) * 100);
            return (
              <div className="course-card">
                <div className="cc-head"><CourseThumb c={course} size={58} /><div><b>{course.nm}</b><small>{course.area} · 대여소 {course.stops}곳 · 실제 이용 구간 {course.ridden}%</small></div></div>
                <div className="cc-sum"><span className="big">{Math.round(course.km / 12 * 60)}분</span><span>{course.km}km · 혼잡 도로 0m · {Math.round(course.km * KCAL_PER_KM)}kcal · 탄소 {Math.round(course.km * CO2_G_PER_KM)}g 감축</span><span className="badge">{got ? '배지 받음' : `완주하면 ${course.badge}`}</span></div>
                {riding ? (
                  <div className="cc-ride">
                    <div className="pass-bar"><div style={{ width: `${pct}%` }} /></div>
                    <small>{loc.live ? `코스 지점 ${visited.size}/${course.pts.length} 지남 · 90% 지나면 완주` : '실시간 위치를 켜야 완주를 확인할 수 있어요'}</small>
                    <button className="cc-btn ghost" onClick={() => setRiding(false)}>그만 달리기</button>
                  </div>
                ) : (
                  <>
                    <button className="cc-btn" onClick={() => { setRiding(true); mapRef.current?.setView(course.pts[0], 16); }}>코스 시작하기</button>
                    <button className="cc-btn ghost" onClick={() => { setCourse(null); if (layerRef.current) layerRef.current.remove(); }}>일반 길찾기로</button>
                  </>
                )}
              </div>
            );
          })()}

          {!course && !arrived && (
            <>
              {!to && <div className="route-info"><b>어디로 갈까요?</b><small>위의 도착지를 누르거나 지도를 눌러 주세요.</small></div>}
              {to && (
                <div className="rtabs">
                  {['대중교통+타슈', '대중교통', '타슈'].map((nm, i) => {
                    const pp = plans?.[i];
                    return (
                      <button key={nm} aria-pressed={tab === i} disabled={!pp || pp.none} onClick={() => { userPickedRef.current = true; setTab(i); }}>
                        <span className="rt-name">{nm}</span>
                        <b>{loading || !pp ? '…' : pp.none ? '–' : `${pp.min}분`}</b>
                        <span className="rt-badges">{pp?.fastest && <i className="rec">추천 · 가장 빠름</i>}{pp?.greenest && !pp?.fastest && <i>탄소 최고</i>}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {to && loading && <div className="route-loading"><i /><span>세 가지 경로를 계산하고 있어요…</span></div>}
              {to && planErr && <div className="route-info"><b>경로를 불러오지 못했어요</b><button className="cc-btn" onClick={() => setRetry((r) => r + 1)}>다시 시도</button></div>}
              {to && p?.none && <div className="route-info"><small>{p.why}</small></div>}
              {to && p && !p.none && !loading && (
                <div className="plan-detail">
                  {p.key === 'tashu' && (
                    <div className="seg2 small">
                      {[['avoid', '혼잡 회피'], ['bike', '자전거길 우선'], ['short', '최단 거리']].map(([k, nm]) => <button key={k} aria-pressed={bikeMode === k} onClick={() => setBikeMode(k)}>{nm}</button>)}
                    </div>
                  )}
                  <ModeBar legs={p.legs} />
                  <div className="pd-sum"><span className="big">{p.min}분</span><span className="arrive">{hhmm(p.arrive)} 도착</span></div>
                  <div className="pd-stats">
                    <div><small>환승</small><b>{p.transfers}회</b></div>
                    <div><small>걷기</small><b>{p.walkM >= 1000 ? `${(p.walkM / 1000).toFixed(1)}km` : `${p.walkM}m`}</b></div>
                    <div><small>{['출근', '퇴근', '평시'][band]} 혼잡 도로</small><b>{p.congKm >= 0.05 ? `${p.congKm.toFixed(1)}km` : '없음'}</b></div>
                    <div><small>타슈 거리</small><b>{p.bikeKm > 0 ? `${p.bikeKm.toFixed(1)}km` : '–'}</b></div>
                    <div><small>소모 칼로리</small><b>{p.bikeKm > 0 ? `${p.kcal}kcal` : '–'}</b></div>
                    <div><small>탄소 감축</small><b>{p.co2 > 0 ? `${p.co2.toLocaleString()}g` : '–'}</b></div>
                  </div>
                  <ol className="timeline">{steps.map((st, i) => (
                    <li key={i} className={`tl-${st.mode}`}>
                      <span className="tl-num">{i + 1}</span>
                      <Icon svg={MODE_ICON[st.mode]('#15273E')} size={22} className="tl-ico" />
                      <span className="tl-txt"><b>{st.title}</b><small>{st.sub}</small></span>
                    </li>
                  ))}</ol>
                  <button className="cc-btn" onClick={() => startGuide(p, steps)}>안내 시작</button>
                  <small className="note">{p.legs.some((l) => l.exact === false) ? '일부 구간은 경로 서버에 연결하지 못해 직선으로 표시했어요. ' : ''}{p.legs.some((l) => l.mode === 'bus') ? '버스 시간은 도로 혼잡도로 추정한 값이에요. ' : ''}{p.legs.some((l) => l.mode === 'subway') ? '지하철은 한 정거장 2분 + 대기 4분으로 계산했어요.' : ''}</small>
                </div>
              )}
            </>
          )}
        </div>
      )}
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

function MyInfo({ back, rent, openRent, openReturn }) {
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
      <header className="info-head"><button className="back" onClick={back}>←</button><b>MY</b></header>
      <div className="info-body">
        <section className="card rent-card">
          <h3>대여 상태</h3>
          {rent.rental ? (
            <>
              <div className="rent-now"><b>{rent.rental.bike}</b><span className={rent.left <= 300 ? 'warn' : ''}>{rent.left <= 0 ? `무료 시간 ${fmtLeft(rent.left)} 초과` : `무료 ${fmtLeft(rent.left)} 남음`}</span></div>
              <button className="cc-btn" onClick={openReturn}>가까운 대여소에 반납</button>
            </>
          ) : (
            <p className="note">지금 빌린 타슈가 없어요.</p>
          )}
          {rent.history.length > 0 && rent.history.slice(0, 3).map((h) => (
            <div className="hist" key={h.start}><span>{h.bike} → {h.station} 반납</span><small>{new Date(h.start).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} · {Math.max(1, Math.round((h.end - h.start) / 60000))}분</small></div>
          ))}
        </section>

        <section className="card icon-card">
          <div className="app-icon" dangerouslySetInnerHTML={{ __html: bikeSvg('#15273E') }} />
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
  const [band, setBand] = useState(defaultBand);
  const [courseId, setCourseId] = useState(null);
  const [trip, setTrip] = useState(null);
  const [modal, setModal] = useState(null); // 'rent' | 'return'
  const rent = useRental();
  const home = useCallback(() => setScreen('home'), []);
  const go = useCallback((sc) => { setCourseId(null); setTrip(null); setScreen(sc); }, []);
  const openCourse = useCallback((id) => { setCourseId(id); setTrip(null); setScreen('route'); }, []);
  const pick = useCallback((act, place) => { setCourseId(null); setTrip(act === 'from' ? { from: place } : { to: place }); setScreen('route'); }, []);
  const startRent = useCallback((bike) => { rent.start(bike); setModal(null); }, [rent]);
  return (
    <div className="phone">
      {screen === 'splash' && <Splash onDone={home} />}
      {screen === 'home' && <Home loc={loc} go={go} band={band} setBand={setBand} rent={rent} openReturn={() => setModal('return')} pick={pick} />}
      {screen === 'route' && <RouteScreen key={`${courseId}-${trip?.from?.name}-${trip?.to?.name}`} loc={loc} back={home} band={band} setBand={setBand} initialCourse={courseId} trip={trip} rent={rent} openRent={() => setModal('rent')} openReturn={() => setModal('return')} />}
      {screen === 'badges' && <BadgeScreen back={home} openCourse={openCourse} />}
      {screen === 'my' && <MyInfo back={home} rent={rent} openRent={() => setModal('rent')} openReturn={() => setModal('return')} />}
      {modal === 'rent' && <RentModal onClose={() => setModal(null)} onStart={startRent} />}
      {modal === 'return' && rent.rental && <ReturnModal loc={loc} rent={rent} onClose={() => setModal(null)} />}
    </div>
  );
}
