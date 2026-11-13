// 노랑 · 검정 · 흰색 3색만 쓰는 지도 스타일 (명도/채도 단계만 다르게)
export const C = {
  Y: '#FFD200',   // 노랑 (진함) - 가장 중요한 것
  Y2: '#FFE45C',  // 노랑 (중간)
  Y3: '#FFF4BF',  // 노랑 (옅음)
  K: '#111111',   // 검정
  K2: '#444444',
  K3: '#8C8C8C',
  K4: '#D6D6D6',
  K5: '#EBEBEB',
  W: '#FFFFFF',
  W2: '#F7F7F5',
};

const name = ['coalesce', ['get', 'name:ko'], ['get', 'name']];
const cls = (...v) => ['match', ['get', 'class'], v, true, false];

export const mapStyle = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': C.W2 } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.Y3, 'fill-opacity': 0.6 } },
    { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'grass'), paint: { 'fill-color': C.Y3, 'fill-opacity': 0.4 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.K5 } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': C.K5, 'line-width': 2 } },
    { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 15, paint: { 'fill-color': C.K5, 'fill-opacity': 0.7 } },

    // 도로: 작은 길은 흰색, 큰 길은 흰색+회색 테두리, 간선도로는 옅은 노랑
    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('minor', 'service'), minzoom: 13,
      paint: { 'line-color': C.W, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, 10] } },
    { id: 'road-major-case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('primary', 'secondary', 'tertiary', 'trunk'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.K4, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 18, 20] } },
    { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('primary', 'secondary', 'tertiary', 'trunk'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.W, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 18, 17] } },
    { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('motorway'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.Y2, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 18, 18] } },
    // 자전거길 / 보행로 (타슈와 연관) - 노랑 점선
    { id: 'cycleway', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'subclass'], 'cycleway'], minzoom: 14,
      paint: { 'line-color': C.Y, 'line-width': 2, 'line-dasharray': [2, 1.5] } },
    // 철도 / 지하철 노선 - 검정
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('rail', 'transit'),
      paint: { 'line-color': C.K3, 'line-width': 1.5, 'line-dasharray': [3, 2] } },

    // 글자: 동 이름 > 큰 도로 이름 > 하천 이름 (크기·진하기로 중요도 구분)
    { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
      layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
      paint: { 'text-color': C.K3, 'text-halo-color': C.W, 'text-halo-width': 1.5 } },
    { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
      filter: cls('primary', 'secondary', 'tertiary', 'trunk', 'motorway'),
      layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
      paint: { 'text-color': C.K2, 'text-halo-color': C.W, 'text-halo-width': 2 } },
    { id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: cls('neighbourhood', 'quarter', 'suburb', 'village', 'hamlet'),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 14] },
      paint: { 'text-color': C.K3, 'text-halo-color': C.W, 'text-halo-width': 2 } },
    { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: cls('city', 'town'),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': 16 },
      paint: { 'text-color': C.K2, 'text-halo-color': C.W, 'text-halo-width': 2 } },
  ],
};
