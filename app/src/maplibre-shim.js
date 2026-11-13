// maplibre-gl은 CDN 스크립트(전역 maplibregl)로 불러옴 — 번들 안에서는 워커가 깨지기 때문
const m = window.maplibregl;
export default m;
export const Map = m.Map;
