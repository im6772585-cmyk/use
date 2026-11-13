// 타슈 자전거 아이콘 (캐릭터 없음)
export const bikeSvg = (color = '#111111') => `
<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <circle cx="13" cy="31" r="8" fill="none" stroke="${color}" stroke-width="3.2"/>
  <circle cx="35" cy="31" r="8" fill="none" stroke="${color}" stroke-width="3.2"/>
  <path d="M13 31 L20 19 L31 19 L35 31 M20 19 L24 31 L31 19 M18 15 L23 15 M29 14 L33 14 L31 19" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// 내 위치 마커: 흰 원 + 초록 테두리 + 자전거
export const myLocationHtml = (size = 44) => `
<div class="me" style="width:${size}px;height:${size}px">
  <div class="me-pulse"></div>
  <div class="me-dot">${bikeSvg('#111111')}</div>
</div>`;

export const trainSvg = (c = '#FFD200') => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="3" width="14" height="14" rx="3" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M5 10 H19" stroke="${c}" stroke-width="2.2"/><circle cx="9" cy="13.5" r="1.3" fill="${c}"/><circle cx="15" cy="13.5" r="1.3" fill="${c}"/><path d="M8 17 L6 21 M16 17 L18 21" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
export const personSvg = (c = '#111111') => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="4" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M4 21 C4 16 8 14 12 14 S20 16 20 21" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
