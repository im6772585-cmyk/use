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

export const busSvg = (c = '#111111') => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="3" width="16" height="15" rx="3" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M4 11 H20" stroke="${c}" stroke-width="2.2"/><circle cx="8" cy="14.5" r="1.2" fill="${c}"/><circle cx="16" cy="14.5" r="1.2" fill="${c}"/><path d="M7 18 V21 M17 18 V21" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
export const walkSvg = (c = '#111111') => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="4.5" r="2" fill="${c}"/><path d="M10 21 L12 15 L15 17 L15 22 M12 15 L12.5 9 L9 11 L8 14 M12.5 9 L16 12 L18 12" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const qrSvg = (c = '#111111') => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="none" stroke="${c}" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="none" stroke="${c}" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1.5" fill="none" stroke="${c}" stroke-width="2"/><path d="M14 14 H17 V17 M21 14 V21 H17 M14 21 V18" fill="none" stroke="${c}" stroke-width="2"/></svg>`;
export const searchSvg = (c = '#111111') => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M15.5 15.5 L21 21" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/></svg>`;
export const medalSvg = (c = '#111111') => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8 14 L6 22 L9.5 20 L11 23 L12 16 M16 14 L18 22 L14.5 20 L13 23 L12 16" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9" r="7" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M12 5.5 L13 8 L15.5 8.2 L13.6 9.8 L14.2 12.3 L12 11 L9.8 12.3 L10.4 9.8 L8.5 8.2 L11 8 Z" fill="${c}"/></svg>`;
