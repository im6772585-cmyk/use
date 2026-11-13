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
