// 파란색 한 가지의 명도·채도 단계만 쓰는 지도 스타일 (남색 글자로 가독성 확보)
export const C = {
  Y: '#1E5AA8',   // 파랑 (진함) - 가장 중요한 것
  Y2: '#6C9BD8',  // 파랑 (중간)
  Y3: '#DCE8F8',  // 파랑 (옅음)
  K: '#0B2545',   // 남색 (가장 어두움) - 글자
  K2: '#24497E',
  K3: '#6F86A6',
  K4: '#C5D6EE',
  K5: '#E8EFF9',
  W: '#FFFFFF',
  W2: '#F7FAFE',
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
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.K4 } },
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
      layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-padding': 8 },
      paint: { 'text-color': C.K3, 'text-halo-color': C.W, 'text-halo-width': 1.5 } },
    { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15,
      filter: cls('primary', 'secondary', 'tertiary', 'trunk', 'motorway'),
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-padding': 24, 'text-max-angle': 30 },
      paint: { 'text-color': C.K2, 'text-halo-color': C.W, 'text-halo-width': 2 } },
    { id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 13, filter: cls('suburb', 'quarter', 'neighbourhood'),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 12, 16, 14], 'text-padding': 16 },
      paint: { 'text-color': C.K3, 'text-halo-color': C.W, 'text-halo-width': 2 } },
    { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: cls('city', 'town'),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': 16, 'text-padding': 20 }, maxzoom: 13,
      paint: { 'text-color': C.K2, 'text-halo-color': C.W, 'text-halo-width': 2 } },
  ],
};
