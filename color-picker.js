/*!
 * color-picker — shared Pickr/Monolith-style colour picker for the swoonqx maker sites.
 * Ported from polaroid-maker so every maker site picks colours the same way:
 * saturation/brightness field, hue bar, HEX input, EyeDropper, recent colours, Apply button.
 *
 * Usage:  ColorPicker.attach(document.getElementById('myColor'), { getLang: () => 'ko' });
 * The <input type="color"> stays in the page as the swatch button; clicking it opens this sheet instead of the
 * native dialog, and an 'input' event fires on every change (Esc / backdrop click restores the original colour).
 * Languages: ko / en / ja / zh. Self-contained: injects its own CSS and markup.
 */
(function (root) {
  'use strict';
  const LANGS = ['ko', 'en', 'ja', 'zh'];
  const STR = {
    title: ['색상 선택', 'Choose Color', '色を選択', '选择颜色'],
    apply: ['적용', 'Apply', '適用', '应用'],
    eyedropper: ['스포이드', 'Eyedropper', 'スポイト', '吸管'],
    recent: ['최근 사용한 색상', 'Recent colors', '最近使った色', '最近使用的颜色'],
    help: ['색상 영역을 움직여 색을 선택하고 적용 버튼을 누르세요.', 'Move in the colour area to pick a colour, then press Apply.', '色の領域を動かして色を選び、適用を押してください。', '在色彩区域中移动选色，然后点击应用。'],
    sv: ['채도와 밝기', 'Saturation and brightness', '彩度と明度', '饱和度与亮度'],
    hue: ['색상', 'Hue', '色相', '色相'],
    hex: ['HEX 색상', 'HEX color', 'HEXカラー', 'HEX 颜色']
  };
  const CSS = `
  body.cp-open { overflow: hidden; }
  .cp-backdrop { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15,18,20,.32); backdrop-filter: blur(2px); }
  .cp-backdrop[hidden] { display: none !important; }
  .cp-sheet { width: min(324px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; background: #fff; border: 1px solid rgba(0,0,0,.09); border-radius: 4px; padding: 18px; box-shadow: 0 14px 38px rgba(0,0,0,.22); touch-action: manipulation; font-family: inherit; }
  .cp-preview { height: 24px; border-radius: 3px; margin-bottom: 12px; border: 1px solid rgba(0,0,0,.08); background: #323232; }
  .cp-sv-wrap { position: relative; width: 100%; aspect-ratio: 1.36 / 1; margin-bottom: 14px; touch-action: none; }
  .cp-sv { width: 100%; height: 100%; display: block; border-radius: 4px; cursor: crosshair; touch-action: none; }
  .cp-knob { position: absolute; width: 22px; height: 22px; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.65), 0 1px 3px rgba(0,0,0,.35); transform: translate(-50%,-50%); pointer-events: none; }
  .cp-hue-wrap { position: relative; height: 14px; margin: 0 0 28px; touch-action: none; }
  .cp-hue { width: 100%; height: 14px; display: block; border-radius: 999px; cursor: pointer; touch-action: none; background: linear-gradient(90deg,#f00 0%,#ff0 16.66%,#0f0 33.33%,#0ff 50%,#00f 66.66%,#f0f 83.33%,#f00 100%); }
  .cp-hue-knob { position: absolute; top: 50%; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.48), 0 1px 3px rgba(0,0,0,.28); transform: translate(-50%,-50%); pointer-events: none; background: #f00; }
  .cp-recent { margin: 0 0 14px; }
  .cp-recent[hidden] { display: none !important; }
  .cp-recent-label { font-size: 11px; color: #8a9199; margin-bottom: 7px; font-weight: 600; }
  .cp-recent-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .cp-recent-row button { width: 24px; height: 24px; min-height: 0; padding: 0; border-radius: 50%; border: 2px solid rgba(0,0,0,.08); cursor: pointer; }
  .cp-recent-row button:hover { border-color: var(--accent, #14b8a6); }
  .cp-controls { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; align-items: center; }
  .cp-hex { width: 100%; min-width: 0; height: 41px; padding: 8px 10px; border: 0; border-radius: 2px; background: #f0f1f2; color: #747980; font: 16px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; text-transform: uppercase; box-sizing: border-box; }
  .cp-hex:focus { outline: 2px solid rgba(20,184,166,.35); background: #f7f8f9; }
  .cp-apply { height: 41px; min-height: 0; padding: 0 14px; border-radius: 2px; border: 0; background: var(--accent, #14b8a6); color: var(--accent-ink, #05201d); font: 700 14px inherit; cursor: pointer; }
  .cp-apply:hover { filter: brightness(1.06); }
  .cp-eye { width: 100%; min-height: 42px; margin-top: 10px; border-radius: 8px; border: 1px solid rgba(20,184,166,.45); background: rgba(20,184,166,.1); color: var(--accent-strong, #0d9488); display: flex; align-items: center; justify-content: center; gap: 8px; font: 600 15px inherit; cursor: pointer; }
  .cp-eye[hidden] { display: none !important; }
  .cp-sr { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0,0,0,0) !important; white-space: nowrap !important; border: 0 !important; }
  @media (max-width: 600px) { .cp-backdrop { padding: 10px; } .cp-sheet { width: min(344px, calc(100vw - 20px)); padding: 16px; } }
  `;
  const HTML = `
  <section class="cp-sheet" role="dialog" aria-modal="true">
    <div class="cp-preview" aria-hidden="true"></div>
    <div class="cp-sv-wrap"><canvas class="cp-sv" width="576" height="424"></canvas><span class="cp-knob" aria-hidden="true"></span></div>
    <div class="cp-hue-wrap"><div class="cp-hue" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="360" aria-valuenow="0"></div><span class="cp-hue-knob" aria-hidden="true"></span></div>
    <div class="cp-recent" hidden><div class="cp-recent-label"></div><div class="cp-recent-row"></div></div>
    <div class="cp-controls"><input type="text" class="cp-hex" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" value="#323232"><button type="button" class="cp-apply"></button></div>
    <button type="button" class="cp-eye" hidden><span aria-hidden="true">⌕</span><span class="cp-eye-label"></span></button>
    <span class="cp-sr"></span>
  </section>`;

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function hexToRgb(hex) {
    const clean = String(hex).replace('#', '').trim();
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(n => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')).join('');
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  const hsvToHex = (h, s, v) => { const c = hsvToRgb(h, s, v); return rgbToHex(c.r, c.g, c.b); };

  let ui = null, active = null, original = '#000000', hsv = { h: 0, s: 0, v: 0.2 }, getLang = () => 'ko';
  let recent = [], svDrag = false, hueDrag = false;
  const RKEY = 'swoonqx-recent-colors', RMAX = 12;
  const T = k => { const e = STR[k], i = LANGS.indexOf(getLang()); return e[i < 0 ? 1 : i]; };

  function build() {
    if (ui) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const bd = document.createElement('div'); bd.className = 'cp-backdrop'; bd.hidden = true; bd.innerHTML = HTML; document.body.appendChild(bd);
    const q = s => bd.querySelector(s);
    ui = { bd, sheet: q('.cp-sheet'), preview: q('.cp-preview'), sv: q('.cp-sv'), svKnob: q('.cp-knob'), hue: q('.cp-hue'), hueKnob: q('.cp-hue-knob'),
      recentWrap: q('.cp-recent'), recentLabel: q('.cp-recent-label'), recentRow: q('.cp-recent-row'), hex: q('.cp-hex'), apply: q('.cp-apply'),
      eye: q('.cp-eye'), eyeLabel: q('.cp-eye-label'), help: q('.cp-sr') };
    try { recent = JSON.parse(localStorage.getItem(RKEY) || '[]').filter(h => hexToRgb(h)); } catch (_) {}

    ui.sv.addEventListener('pointerdown', e => { svDrag = true; try { ui.sv.setPointerCapture(e.pointerId); } catch (_) {} setSV(e); });
    ui.sv.addEventListener('pointermove', e => { if (svDrag) setSV(e); });
    ['pointerup', 'pointercancel'].forEach(n => ui.sv.addEventListener(n, () => { svDrag = false; }));
    ui.hue.addEventListener('pointerdown', e => { hueDrag = true; try { ui.hue.setPointerCapture(e.pointerId); } catch (_) {} setHue(e); });
    ui.hue.addEventListener('pointermove', e => { if (hueDrag) setHue(e); });
    ['pointerup', 'pointercancel'].forEach(n => ui.hue.addEventListener(n, () => { hueDrag = false; }));
    ui.hue.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); hsv.h = (hsv.h + (e.key === 'ArrowRight' ? 2 : -2) + 360) % 360; refresh(true);
    });
    ui.hex.addEventListener('input', () => { const rgb = hexToRgb(ui.hex.value); if (!rgb) return; hsv = rgbToHsv(rgb.r, rgb.g, rgb.b); refresh(true); });
    ui.hex.addEventListener('blur', () => refresh(false));
    ui.hex.addEventListener('keydown', e => { if (e.key === 'Enter') close(true); });
    ui.apply.addEventListener('click', () => close(true));
    ui.bd.addEventListener('click', e => { if (e.target === ui.bd) close(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ui.bd.hidden) close(false); });
    if ('EyeDropper' in window) {
      ui.eye.hidden = false;
      ui.eye.addEventListener('click', async () => {
        try { const r = await new EyeDropper().open(), rgb = hexToRgb(r.sRGBHex); if (!rgb) return; hsv = rgbToHsv(rgb.r, rgb.g, rgb.b); refresh(true); } catch (_) {}
      });
    }
  }
  function texts() {
    ui.sheet.setAttribute('aria-label', T('title')); ui.apply.textContent = T('apply'); ui.eyeLabel.textContent = T('eyedropper');
    ui.recentLabel.textContent = T('recent'); ui.help.textContent = T('help');
    ui.sv.setAttribute('aria-label', T('sv')); ui.hue.setAttribute('aria-label', T('hue')); ui.hex.setAttribute('aria-label', T('hex'));
  }
  function drawSV() {
    const c = ui.sv, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = hsvToHex(hsv.h, 1, 1); g.fillRect(0, 0, c.width, c.height);
    const w = g.createLinearGradient(0, 0, c.width, 0); w.addColorStop(0, '#fff'); w.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = w; g.fillRect(0, 0, c.width, c.height);
    const b = g.createLinearGradient(0, 0, 0, c.height); b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(1, '#000');
    g.fillStyle = b; g.fillRect(0, 0, c.width, c.height);
  }
  function push(hex) {
    if (!active) return;
    active.value = hex;
    active.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function refresh(pushIt) {
    const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
    ui.preview.style.background = hex; ui.hex.value = hex.toUpperCase();
    drawSV();
    ui.svKnob.style.left = hsv.s * 100 + '%'; ui.svKnob.style.top = (1 - hsv.v) * 100 + '%';
    ui.hueKnob.style.left = hsv.h / 360 * 100 + '%'; ui.hueKnob.style.background = hsvToHex(hsv.h, 1, 1);
    ui.hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    if (pushIt) push(hex);
  }
  function buildRecent() {
    if (!recent.length) { ui.recentWrap.hidden = true; return; }
    ui.recentWrap.hidden = false; ui.recentRow.innerHTML = '';
    recent.forEach(hex => {
      const b = document.createElement('button'); b.type = 'button'; b.style.background = hex; b.title = hex;
      b.addEventListener('click', () => { const rgb = hexToRgb(hex); if (!rgb) return; hsv = rgbToHsv(rgb.r, rgb.g, rgb.b); refresh(true); });
      ui.recentRow.appendChild(b);
    });
  }
  function open(input) {
    if (!input || input.disabled) return;
    build(); texts();
    active = input; original = input.value || '#000000';
    const rgb = hexToRgb(original) || { r: 0, g: 0, b: 0 };
    hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    ui.bd.hidden = false; document.body.classList.add('cp-open');
    buildRecent(); refresh(false);
    requestAnimationFrame(() => { try { ui.hex.focus({ preventScroll: true }); } catch (_) {} });
  }
  function close(commit) {
    if (!active) return;
    if (!commit) push(original);
    else {
      const hex = hsvToHex(hsv.h, hsv.s, hsv.v).toLowerCase();
      recent = [hex, ...recent.filter(c => c !== hex)].slice(0, RMAX);
      try { localStorage.setItem(RKEY, JSON.stringify(recent)); } catch (_) {}
    }
    ui.bd.hidden = true; document.body.classList.remove('cp-open');
    const back = active; active = null;
    try { back.focus({ preventScroll: true }); } catch (_) {}
  }
  function setSV(e) {
    const r = ui.sv.getBoundingClientRect();
    hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1); hsv.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
    refresh(true);
  }
  function setHue(e) {
    const r = ui.hue.getBoundingClientRect();
    hsv.h = clamp((e.clientX - r.left) / r.width, 0, 1) * 360; if (hsv.h >= 360) hsv.h = 359.999;
    refresh(true);
  }

  function attach(input, opts) {
    if (!input) return;
    if (opts && opts.getLang) getLang = opts.getLang;
    input.setAttribute('aria-haspopup', 'dialog');
    input.addEventListener('click', e => { e.preventDefault(); open(input); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(input); } });
  }
  root.ColorPicker = { attach };
})(typeof window !== 'undefined' ? window : this);
