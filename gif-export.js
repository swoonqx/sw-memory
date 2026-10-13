/*!
 * gif-export — shared "animated GIF export" module for the swoonqx maker sites.
 *
 * Self-contained: GIF encoder (global median-cut palette + Bayer dither + LZW,
 * identical frames are merged) + a settings / progress / download panel.
 * The panel reuses the host page's maker-site CSS classes (.box, .row,
 * .toggle-group, .check-row, .hint, .primary, .full, --accent ...), so it inherits
 * the turquoise UI. Languages: ko / en / ja / zh.
 *
 * Usage:
 *   GifExport.mount(document.getElementById('gifBox'), {      // gifBox is <div class="box">
 *     getLang: () => 'ko',                // current UI language
 *     getSize: () => ({ w, h }) | null,   // source size (null = nothing loaded yet)
 *     renderFrame: (ctx, w, h, p, i, n) => {},  // draw frame; p = 0..1 (i / (n-1))
 *     onDone: ({ blob, url, w, h, frames, bytes }) => {},
 *     filename: 'name.gif',
 *     defaults: { size: 480, fps: 15, dur: 3 }  // optional
 *   });  // -> { refresh() }   call refresh() after a language / source change
 *
 *   GifExport.encode({ w, h, n, fps, render(ctx,i,n), dither, onProgress(done,total), isCancelled() }) -> Promise<Blob>
 */
(function (root) {
  'use strict';

  /* ============================== encoder ============================== */
  /* 6 bits per channel histogram (the old 5-bit one flattened smooth gradients into visible bands),
     weighted median-cut palette, lazily-filled nearest-colour table, 8x8 ordered dither. */
  const BITS = 6, NB = 1 << BITS, SHIFT = 8 - BITS, MASK = NB - 1;
  function buildPalette(samples) {
    const size = NB * NB * NB;
    const hist = new Uint32Array(size), sr = new Float64Array(size), sg = new Float64Array(size), sb = new Float64Array(size);
    let total = 0;
    for (const d of samples) for (let i = 0; i < d.length; i += 8) {
      const r = d[i], g = d[i + 1], b = d[i + 2], k = (r >> SHIFT) << (2 * BITS) | (g >> SHIFT) << BITS | (b >> SHIFT);
      hist[k]++; sr[k] += r; sg[k] += g; sb[k] += b; total++;
    }
    const keys = []; for (let k = 0; k < size; k++) if (hist[k]) keys.push(k);
    const boxes = [{ k: keys, n: total }];
    const comp = (k, a) => a === 0 ? (k >> (2 * BITS)) & MASK : a === 1 ? (k >> BITS) & MASK : k & MASK, W3 = [0.9, 1.2, 0.7];
    while (boxes.length < 256) {
      let bi = -1, bn = 0;
      for (let i = 0; i < boxes.length; i++) if (boxes[i].k.length > 1 && boxes[i].n > bn) { bn = boxes[i].n; bi = i; }
      if (bi < 0) break;
      const b = boxes[bi]; let axis = 0, best = -1;
      for (let a = 0; a < 3; a++) { let mn = 999, mx = -1; for (const k of b.k) { const v = comp(k, a); if (v < mn) mn = v; if (v > mx) mx = v; } const rg = (mx - mn) * W3[a]; if (rg > best) { best = rg; axis = a; } }
      b.k.sort((x, y) => comp(x, axis) - comp(y, axis));
      let acc = 0, cut = 1; const half = b.n / 2;
      for (let i = 0; i < b.k.length - 1; i++) { acc += hist[b.k[i]]; cut = i + 1; if (acc >= half) break; }
      const k1 = b.k.slice(0, cut), k2 = b.k.slice(cut); let n1 = 0; for (const k of k1) n1 += hist[k];
      boxes[bi] = { k: k1, n: n1 }; boxes.push({ k: k2, n: b.n - n1 });
    }
    const pal = new Uint8Array(768);
    boxes.forEach((b, i) => { let r = 0, g = 0, bl = 0, n = 0; for (const k of b.k) { r += sr[k]; g += sg[k]; bl += sb[k]; n += hist[k]; } n = n || 1; pal[i * 3] = Math.round(r / n); pal[i * 3 + 1] = Math.round(g / n); pal[i * 3 + 2] = Math.round(bl / n); });
    return { pal, cnt: boxes.length, lut: new Int16Array(size).fill(-1) };
  }
  function nearestPal(P, r, g, b) {
    let bd = 1e12, bi = 0; const pal = P.pal;
    for (let i = 0; i < P.cnt; i++) { const dr = r - pal[i * 3], dg = g - pal[i * 3 + 1], db = b - pal[i * 3 + 2], dd = dr * dr * .9 + dg * dg * 1.2 + db * db * .7; if (dd < bd) { bd = dd; bi = i; } }
    return bi;
  }
  const B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  const DITHER_AMP = 5;
  function quantize(data, w, h, P, dith) {
    const out = new Uint8Array(w * h), lut = P.lut; let i = 0, p = 0;
    const half = (1 << SHIFT) / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, p += 4) {
      let r = data[p], g = data[p + 1], b = data[p + 2];
      if (dith) { const o = ((B8[(y & 7) << 3 | (x & 7)] + 0.5) / 64 - 0.5) * DITHER_AMP; r += o; g += o; b += o; r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b; }
      r |= 0; g |= 0; b |= 0;
      const k = (r >> SHIFT) << (2 * BITS) | (g >> SHIFT) << BITS | (b >> SHIFT);
      let v = lut[k];
      if (v < 0) { v = nearestPal(P, ((r >> SHIFT) << SHIFT) + half, ((g >> SHIFT) << SHIFT) + half, ((b >> SHIFT) << SHIFT) + half); lut[k] = v; }
      out[i++] = v;
    }
    return out;
  }
  const HS = 1 << 14, HM = HS - 1, hKey = new Int32Array(HS), hVal = new Int32Array(HS);
  function lzwEncode(px) {
    const buf = new Uint8Array(px.length * 2 + 1024); let bp = 0, cur = 0, nb = 0;
    let nbits = 9, maxcode = 511, free = 258, clearFlag = false;
    hKey.fill(-1);
    const emit = code => {
      cur |= code << nb; nb += nbits;
      while (nb >= 8) { buf[bp++] = cur & 255; cur >>>= 8; nb -= 8; }
      if (free > maxcode || clearFlag) {
        if (clearFlag) { nbits = 9; maxcode = 511; clearFlag = false; }
        else { nbits++; maxcode = nbits === 12 ? 4096 : (1 << nbits) - 1; }
      }
    };
    let ent = px[0]; emit(256);
    for (let i = 1; i < px.length; i++) {
      const c = px[i], key = c << 12 | ent;
      let h = ((c << 6) ^ ent) & HM, found = -1;
      while (hKey[h] !== -1) { if (hKey[h] === key) { found = hVal[h]; break; } h = (h + 1) & HM; }
      if (found >= 0) { ent = found; continue; }
      emit(ent); ent = c;
      if (free < 4096) { hKey[h] = key; hVal[h] = free++; }
      else { hKey.fill(-1); free = 258; clearFlag = true; emit(256); }
    }
    emit(ent); emit(257);
    if (nb > 0) buf[bp++] = cur & 255;
    return buf.subarray(0, bp);
  }
  function subBlocks(data) {
    const n = Math.ceil(data.length / 255), out = new Uint8Array(data.length + n + 1); let o = 0;
    for (let i = 0; i < data.length; i += 255) { const len = Math.min(255, data.length - i); out[o++] = len; out.set(data.subarray(i, i + len), o); o += len; }
    out[o++] = 0; return out;
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

  async function encode(o) {
    const w = o.w, h = o.h, n = Math.max(2, o.n | 0), fps = o.fps || 15;
    const cancelled = o.isCancelled || (() => false), progress = o.onProgress || (() => {});
    const ec = document.createElement('canvas'); ec.width = w; ec.height = h;
    const ex = ec.getContext('2d', { willReadFrequently: true });
    const grab = i => { ex.setTransform(1, 0, 0, 1, 0, 0); ex.clearRect(0, 0, w, h); o.render(ex, i, n); return ex.getImageData(0, 0, w, h).data; };
    progress(0, n, 'palette'); await tick();
    const K = Math.min(n, 10), samples = [];
    for (let i = 0; i < K; i++) samples.push(grab(Math.floor(i * (n - 1) / Math.max(1, K - 1))));
    const P = buildPalette(samples); samples.length = 0;

    const parts = [], base = Math.max(2, Math.round(100 / fps));
    const hd = new Uint8Array(13 + 768 + 19);
    hd.set([71, 73, 70, 56, 57, 97, w & 255, w >> 8, h & 255, h >> 8, 0xF7, 0, 0]); hd.set(P.pal, 13);
    hd.set([0x21, 0xFF, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0], 13 + 768);
    parts.push(hd);
    let prev = null, prevDelay = 0;
    const flush = () => {
      if (!prev) return;
      const d = Math.min(prevDelay, 65535);
      parts.push(new Uint8Array([0x21, 0xF9, 4, 0x04, d & 255, d >> 8, 0, 0, 0x2C, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 8]));
      parts.push(subBlocks(lzwEncode(prev)));
    };
    for (let f = 0; f < n; f++) {
      if (cancelled()) throw new Error('cancel');
      const idx = quantize(grab(f), w, h, P, o.dither !== false);
      if (prev && same(prev, idx)) prevDelay += base;
      else { flush(); prev = idx; prevDelay = base; }
      progress(f + 1, n, 'frame');
      if (f % 2 === 1) await tick();
    }
    flush();
    parts.push(new Uint8Array([0x3B]));
    return new Blob(parts, { type: 'image/gif' });
  }

  /* ============================== panel UI ============================== */
  const LANGS = ['ko', 'en', 'ja', 'zh'];
  const STR = {
    title: ['움직이는 GIF', 'Animated GIF', '動くGIF', '动态 GIF'],
    size: ['최대 크기', 'Max size', '最大サイズ', '最大尺寸'],
    fps: ['프레임', 'FPS', 'FPS', '帧率'],
    dur: ['길이', 'Length', '長さ', '时长'],
    dither: ['디더링(그라데이션 부드럽게)', 'Dithering (smoother gradients)', 'ディザリング(グラデーションを滑らかに)', '抖动(渐变更平滑)'],
    estimate: ['예상: {f}프레임 · {w}×{h}px · 약 {s}초', 'About {f} frames · {w}×{h}px · {s}s', '約{f}フレーム・{w}×{h}px・{s}秒', '约 {f} 帧 · {w}×{h}px · {s} 秒'],
    make: ['GIF 만들기', 'Make GIF', 'GIFを作る', '生成 GIF'],
    cancel: ['취소', 'Cancel', 'キャンセル', '取消'],
    palette: ['색상 분석 중…', 'Analyzing colors…', '色を解析中…', '正在分析颜色…'],
    making: ['GIF 만드는 중… {n}/{t}', 'Making GIF… {n}/{t}', 'GIF作成中… {n}/{t}', '正在生成 GIF… {n}/{t}'],
    done: ['완성! {w}×{h}px · {f}프레임 · {s}', 'Done! {w}×{h}px · {f} frames · {s}', '完成！{w}×{h}px・{f}フレーム・{s}', '完成！{w}×{h}px · {f} 帧 · {s}'],
    download: ['GIF 다운로드', 'Download GIF', 'GIFをダウンロード', '下载 GIF'],
    canceled: ['취소했어요.', 'Canceled.', 'キャンセルしました。', '已取消。']
  };

  function mount(host, o) {
    const lang = () => { const l = o.getLang ? o.getLang() : 'ko'; return LANGS.includes(l) ? l : 'en'; };
    const T = (k, v) => {
      const e = STR[k]; let s = e[LANGS.indexOf(lang())] || e[1];
      if (v) for (const x in v) s = s.replace('{' + x + '}', v[x]);
      return s;
    };
    const d = Object.assign({ size: 480, fps: 15, dur: 3 }, o.defaults || {});
    const sizes = [320, 480, 640, 800], fpss = [10, 15, 20];
    let busy = false, cancelFlag = false, url = null, blob = null;

    host.classList.add('gx');
    host.innerHTML =
      '<h2 data-gx="title"></h2>' +
      '<div class="row"><label data-gx="size"></label><div class="toggle-group" data-gx-group="size">' + sizes.map(v => '<button type="button" data-v="' + v + '">' + v + '</button>').join('') + '</div></div>' +
      '<div class="row"><label data-gx="fps"></label><div class="toggle-group" data-gx-group="fps">' + fpss.map(v => '<button type="button" data-v="' + v + '">' + v + '</button>').join('') + '</div></div>' +
      '<div class="row"><label data-gx="dur"></label><input type="range" data-gx-dur min="1.5" max="8" step="0.5"><span class="val" data-gx-durval></span></div>' +
      '<div class="row"><label class="check-row"><input type="checkbox" data-gx-dither checked><span data-gx="dither"></span></label></div>' +
      '<p class="hint" data-gx-est></p>' +
      '<button type="button" class="primary full" data-gx-make style="margin-top:12px"></button>' +
      '<div data-gx-prog hidden style="margin-top:12px;text-align:center"><div style="height:8px;border-radius:9999px;background:rgba(11,12,13,.12);overflow:hidden"><i data-gx-bar style="display:block;height:100%;width:0;background:var(--accent);transition:width .1s"></i></div><p class="hint" data-gx-ptxt style="margin-top:6px"></p><button type="button" data-gx-cancel></button></div>' +
      '<div data-gx-res hidden style="margin-top:12px"><p class="hint" data-gx-info style="margin:0 0 8px"></p><button type="button" class="primary full" data-gx-dl></button></div>';
    const q = s => host.querySelector(s);
    const durEl = q('[data-gx-dur]'), ditherEl = q('[data-gx-dither]');
    durEl.value = d.dur;
    const setGroup = (name, v) => host.querySelectorAll('[data-gx-group="' + name + '"] button').forEach(b => b.classList.toggle('active', +b.dataset.v === v));
    setGroup('size', d.size); setGroup('fps', d.fps);
    host.querySelectorAll('[data-gx-group]').forEach(g => g.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      d[g.dataset.gxGroup] = +b.dataset.v; setGroup(g.dataset.gxGroup, d[g.dataset.gxGroup]); refresh();
    }));
    durEl.addEventListener('input', () => { d.dur = +durEl.value; refresh(); });

    function work() {
      const s = o.getSize && o.getSize(); if (!s) return null;
      const k = Math.min(1, d.size / Math.max(s.w, s.h));
      return { w: Math.max(16, Math.round(s.w * k)), h: Math.max(16, Math.round(s.h * k)) };
    }
    function refresh() {
      host.querySelectorAll('[data-gx]').forEach(el => { el.textContent = T(el.dataset.gx); });
      q('[data-gx-make]').textContent = T('make'); q('[data-gx-cancel]').textContent = T('cancel'); q('[data-gx-dl]').textContent = T('download');
      q('[data-gx-durval]').textContent = d.dur + 's';
      const w = work(); q('[data-gx-make]').disabled = busy || !w;
      q('[data-gx-est]').textContent = w ? T('estimate', { f: Math.max(2, Math.round(d.dur * d.fps)), w: w.w, h: w.h, s: d.dur }) : '';
      if (blob && lastInfo) q('[data-gx-info]').textContent = T('done', lastInfo);
    }
    let lastInfo = null;
    async function make() {
      const wk = work(); if (busy || !wk) return;
      busy = true; cancelFlag = false;
      q('[data-gx-prog]').hidden = false; q('[data-gx-res]').hidden = true; q('[data-gx-make]').disabled = true;
      const n = Math.max(2, Math.round(d.dur * d.fps));
      try {
        const b = await encode({
          w: wk.w, h: wk.h, n, fps: d.fps, dither: ditherEl.checked,
          render: (ctx, i, nn) => o.renderFrame(ctx, wk.w, wk.h, i / (nn - 1), i, nn),
          isCancelled: () => cancelFlag,
          onProgress: (done, total, phase) => {
            q('[data-gx-bar]').style.width = (phase === 'palette' ? 2 : 5 + 95 * done / total) + '%';
            q('[data-gx-ptxt]').textContent = phase === 'palette' ? T('palette') : T('making', { n: done, t: total });
          }
        });
        if (url) URL.revokeObjectURL(url);
        blob = b; url = URL.createObjectURL(b);
        const kb = b.size / 1024, size = kb > 1024 ? (kb / 1024).toFixed(2) + ' MB' : Math.round(kb) + ' KB';
        lastInfo = { w: wk.w, h: wk.h, f: n, s: size };
        q('[data-gx-res]').hidden = false;
        if (o.onDone) o.onDone({ blob: b, url, w: wk.w, h: wk.h, frames: n, bytes: b.size });
      } catch (e) {
        if (e.message !== 'cancel') { console.error(e); alert(String(e)); }
      } finally {
        busy = false; q('[data-gx-prog]').hidden = true; refresh();
      }
    }
    q('[data-gx-make]').addEventListener('click', make);
    q('[data-gx-cancel]').addEventListener('click', () => { cancelFlag = true; });
    q('[data-gx-dl]').addEventListener('click', () => {
      if (!url) return;
      const a = document.createElement('a'); a.href = url; a.download = (typeof o.filename === 'function' ? o.filename() : o.filename) || 'animation.gif';
      document.body.appendChild(a); a.click(); a.remove();
    });
    refresh();
    return { refresh, make, getUrl: () => url, invalidate() { q('[data-gx-res]').hidden = true; } };
  }

  root.GifExport = { encode, mount };
})(typeof window !== 'undefined' ? window : this);
