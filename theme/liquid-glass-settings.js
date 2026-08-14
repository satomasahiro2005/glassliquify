/* GlassLiquify - Liquify with liquid glass drawn in WebGL.
 *
 * Copyright (c) 2026 nemut.ai
 * Modified from NMWplays/Liquify (upstream 69dbb54, 2026-08-10), 2026-08.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. It is distributed WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Affero General Public License for more details.
 *
 *   Licence, source and full attribution:
 *   https://github.com/satomasahiro2005/GlassLiquify
 *   Licence text: https://www.gnu.org/licenses/agpl-3.0.txt
 *
 * Parts of the glass shaders are ported from Backdrop (Copyright 2025 Kyant,
 * Apache-2.0) - see NOTICE.md in the repository above.
 */
/* Settings panel for the liquid glass extension.
 *
 * Separate file so the renderer stays about rendering. It only talks to
 * window.liquifyLG, which liquid-glass.js publishes, and persists whatever the
 * user lands on so it survives a restart.
 */
(function () {
  'use strict';

  var KEY = 'liquify-lg-settings';

  /* Japanese where the app is Japanese, English otherwise. Spotify's own
   * language is the honest source - the panel sits among its controls, so it
   * should read like them rather than like the machine's locale. */
  var EN = {
    'クリア': 'Clear', '適応': 'Adaptive', 'くもり': 'Frosted',
    '屈折の幅': 'Refraction', '屈折の量': 'Amount', '色収差': 'Dispersion',
    '角の大きさ': 'Corner size', '角の角ばり': 'Corner shape', '深さ': 'Depth',
    '彩度': 'Saturation', 'ぼかし': 'Blur', '縁の光': 'Rim', '光の角度': 'Light angle',
    '白の濃さ': 'Tint',
    'ガラス (Ctrl+Shift+G)': 'Glass (Ctrl+Shift+G)', 'Retina 表示': 'Retina scaling',
    'リセット': 'Reset', '既定に戻す': 'Restore defaults',
    '設定は次回起動時にも残ります。': 'Settings are kept between restarts.',
    '閉じる': 'Close', '拡大率': 'Zoom',
  };

  /* Asked for when it is needed, not when this file loads: Spotify sets
   * <html lang> after its own boot, so reading it at load time answered for an
   * empty string and the panel came out English in a Japanese client. */
  function isJa() {
    /* Asked each time, never cached. Spotify answers 'en' early in its own
     * boot before the user's language loads, and caching that answer left a
     * Japanese client with an English panel for the rest of the session. */
    var l = '';
    try {
      if (window.Spicetify && Spicetify.Locale && Spicetify.Locale.getLocale) {
        l = Spicetify.Locale.getLocale() || '';
      }
    } catch (e) { /* older Spicetify */ }
    if (!l) l = document.documentElement.lang || navigator.language || '';
    return /^ja/i.test(l);
  }

  function t(jp) { return isJa() ? jp : (EN[jp] || jp); }

  /* Named starting points rather than a wall of sliders.
   *
   * clear    - nothing between you and the wallpaper but the lens. no blur, no
   *            adaptation, the faintest tint. what the notification centre looks
   *            like on the way down.
   * adaptive - the material reads the luminance behind it and moves, which is
   *            what keeps text readable over a bright cover.
   * frosted  - the blurred end, for when the wallpaper is too busy to read over.
   */
  var PRESETS = {
    clear: {
      label: 'クリア',
      values: { adaptive: false, brightness: 0, contrast: 1, saturation: 1.2,
                blurMix: 0, surface: [1, 1, 1, 0.03], dispersion: 1,
                superness: 4, radiusScale: 3, height: 24, amount: 48, hlAlpha: 0.75 },
    },
    adaptive: {
      label: '適応',
      values: { adaptive: true, saturation: 1.5, surface: [1, 1, 1, 0.05],
                dispersion: 1, superness: 4, radiusScale: 3, height: 24, amount: 48, hlAlpha: 0.75 },
    },
    frosted: {
      label: 'くもり',
      values: { adaptive: false, brightness: 0, contrast: 1, saturation: 1.5,
                blurMix: 1, surface: [1, 1, 1, 0.12], dispersion: 0.4,
                superness: 4, radiusScale: 3, height: 24, amount: 48, hlAlpha: 0.75 },
    },
  };

  var SLIDERS = [
    { k: 'height', label: '屈折の幅', min: 2, max: 90, step: 1 },
    { k: 'amount', label: '屈折の量', min: 0, max: 160, step: 1 },
    { k: 'dispersion', label: '色収差', min: 0, max: 1, step: 0.02 },
    { k: 'radiusScale', label: '角の大きさ', min: 0.5, max: 8, step: 0.05 },
    { k: 'superness', label: '角の角ばり', min: 2, max: 8, step: 0.1 },
    { k: 'depthEffect', label: '深さ', min: 0, max: 1, step: 0.02 },
    { k: 'saturation', label: '彩度', min: 1, max: 1.5, step: 0.01 },
    { k: 'blurMix', label: 'ぼかし', min: 0, max: 1, step: 0.02 },
    { k: 'hlAlpha', label: '縁の光', min: 0, max: 1, step: 0.02 },
    { k: 'hlAngle', label: '光の角度', min: 0, max: 360, step: 5 },
    { k: 'tint', label: '白の濃さ', min: 0, max: 0.4, step: 0.01 },
  ];

  var CSS =
    /* matched to #liquify-settings-gear-btn so the pair reads as one control */
    '#liquify-lg-btn{display:inline-flex;align-items:center;justify-content:center;' +
    'width:47px;height:47px;border:0;background:transparent;cursor:pointer;' +
    'color:var(--text-subdued);z-index:2;align-self:center;box-shadow:var(--liquify-shadow);' +
    'border-radius:17px;transition:transform .28s cubic-bezier(.3,2.25,.32,1)!important;}' +
    '#liquify-lg-btn:hover{color:var(--text-base);transform:scale(1.05);}' +
    '#liquify-lg-btn svg{width:18px;height:18px;display:block;}' +
    /* A modal, centred, with the body doing the scrolling.
     *
     * It used to be pinned to the top right corner at a fixed size, which put
     * it over the controls it sits beside and gave the sliders nowhere to go
     * once there were more than a handful. Liquify's own settings are a
     * centred sheet; this one matches, so the pair reads as one thing. */
    /* Nothing over the app behind it: no dim, no blur. This panel exists to
     * adjust a material you judge by looking at it, and a scrim that softens
     * the very thing being tuned makes it impossible to see what the sliders
     * are doing. It is only here to catch a click outside. */
    '#liquify-lg-scrim{position:fixed;inset:0;z-index:99998;display:flex;' +
    'align-items:center;justify-content:center;background:transparent;}' +
    '#liquify-lg-scrim[hidden]{display:none;}' +
    '#liquify-lg-panel{width:min(420px,calc(100vw - 64px));max-height:min(680px,80vh);' +
    'display:flex;flex-direction:column;border-radius:20px;' +
    'border:1px solid rgba(255,255,255,.14);background:rgba(18,18,22,.94);' +
    'backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);color:#fff;' +
    'font:13px/1.6 ui-sans-serif,system-ui,"Segoe UI",sans-serif;' +
    'box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;}' +
    '#liquify-lg-panel .head{display:flex;align-items:center;justify-content:space-between;' +
    'padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex:0 0 auto;}' +
    '#liquify-lg-panel .head h3{margin:0;font-size:14px;letter-spacing:.02em;' +
    'font-weight:600;opacity:.9;text-transform:none;}' +
    '#liquify-lg-panel .head .x{width:30px;height:30px;border-radius:10px;cursor:pointer;' +
    'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;' +
    'font:inherit;line-height:1;}' +
    /* the only thing that scrolls, so the title and the footer stay put */
    '#liquify-lg-panel .body{overflow-y:auto;overscroll-behavior:contain;' +
    'padding:14px 20px 18px;flex:1 1 auto;min-height:0;}' +
    '#liquify-lg-panel .presets{display:flex;gap:8px;margin-bottom:14px;}' +
    '#liquify-lg-panel .presets button{flex:1;padding:8px 0;border-radius:10px;cursor:pointer;' +
    'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;}' +
    '#liquify-lg-panel .presets button.on{background:rgba(255,255,255,.9);color:#111;border-color:transparent;}' +
    '#liquify-lg-panel label{display:flex;align-items:center;gap:10px;margin:8px 0;}' +
    '#liquify-lg-panel label>span{flex:0 0 84px;opacity:.75;}' +
    '#liquify-lg-panel input[type=range]{flex:1;min-width:0;accent-color:#fff;}' +
    '#liquify-lg-panel output{flex:0 0 46px;text-align:right;font-variant-numeric:tabular-nums;opacity:.85;}' +
    '#liquify-lg-panel .row{display:flex;align-items:center;justify-content:space-between;' +
    'padding:10px 0;border-top:1px solid rgba(255,255,255,.1);margin-top:12px;}' +
    '#liquify-lg-panel .row button{padding:6px 14px;border-radius:10px;cursor:pointer;' +
    'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;}' +
    '#liquify-lg-panel .row button[disabled]{cursor:default;}' +
    '#liquify-lg-panel .hint{opacity:.45;font-size:12px;margin-top:10px;}';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function save() {
    try {
      var d = window.liquifyLG.defaults;
      localStorage.setItem(KEY, JSON.stringify({
        preset: current,
        values: {
          height: d.height, amount: d.amount, dispersion: d.dispersion,
          superness: d.superness, radiusScale: d.radiusScale, depthEffect: d.depthEffect,
          saturation: d.saturation, blurMix: d.blurMix, adaptive: d.adaptive,
          hlAlpha: d.hlAlpha, hlAngle: d.hlAngle, surface: d.surface,
          brightness: d.brightness, contrast: d.contrast,
        },
      }));
    } catch (e) { /* private mode, quota - not worth failing over */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (o && o.values) window.liquifyLG.set(o.values);
      return o.preset || null;
    } catch (e) { return null; }
  }

  var current = null;
  var inputs = {};
  /* The retina button is gone. It was CSS zoom on the root, which is what
   * Ctrl and the wheel already do properly - Spotify keeps that setting, it
   * survives a restart, and it does not double a display that is already 2x.
   * What is useful is being told where you are, so the row shows the factor
   * instead of offering to change it.
   *
   * Spotify's own zoom is a Chromium zoom level: the factor is 1.2 to the
   * power of level/100. Reading devicePixelRatio instead would fold in the
   * display's own scale and answer 200% on a retina screen at 100% zoom. */
  var ZOOM_STEP = 1.2;

  function readZoom(then) {
    try {
      var z = Spicetify.Platform.ZoomAPI.zoomEsperanto;
      Promise.resolve(z.getZoomLevel()).then(function (r) {
        var lvl = (r && r.zoomLevel != null) ? r.zoomLevel : 0;
        then(Math.round(Math.pow(ZOOM_STEP, lvl / 100) * 100));
      }).catch(function () { then(null); });
    } catch (e) { then(null); }
  }

  /* Whatever the old toggle left behind, taken off once. */
  try {
    if (localStorage.getItem('liquify-lg-retina')) {
      localStorage.removeItem('liquify-lg-retina');
      document.documentElement.style.removeProperty('zoom');
    }
  } catch (e) { /* storage blocked */ }

  function syncInputs() {
    var d = window.liquifyLG.defaults;
    SLIDERS.forEach(function (s) {
      var v = s.k === 'tint' ? d.surface[3] : d[s.k];
      if (v == null) return;
      inputs[s.k].input.value = v;
      inputs[s.k].out.value = (+v).toFixed(s.step < 1 ? 2 : 0);
    });
    Array.prototype.forEach.call(
      document.querySelectorAll('#liquify-lg-panel .presets button'),
      function (b) { b.classList.toggle('on', b.dataset.k === current); });
  }

  function applyPreset(k) {
    current = k;
    window.liquifyLG.set(PRESETS[k].values);
    syncInputs();
    save();
  }

  /* Liquify puts its gear in .main-actionButtons and creates it asynchronously,
   * so wait for it and sit immediately to its left. Falls back to the same host
   * (or the top bar) if the gear never turns up. */
  var GEAR = '#liquify-settings-gear-btn';
  var HOST = '.main-actionButtons';

  function placeButton(btn) {
    var tries = 0;
    var put = function () {
      var gear = document.querySelector(GEAR);
      var host = document.querySelector(HOST);
      if (gear && gear.parentElement) {
        if (btn.nextElementSibling !== gear) gear.parentElement.insertBefore(btn, gear);
        return true;
      }
      if (host && tries > 30) { host.insertBefore(btn, host.firstChild); return true; }
      return false;
    };
    if (put()) { keepPlaced(btn); return; }
    var iv = setInterval(function () {
      if (put() || ++tries > 60) { clearInterval(iv); keepPlaced(btn); }
    }, 300);
  }

  /* Spotify rebuilds the top bar on navigation and takes the button with it. */
  function keepPlaced(btn) {
    setInterval(function () {
      if (btn.isConnected) return;
      var gear = document.querySelector(GEAR);
      if (gear && gear.parentElement) gear.parentElement.insertBefore(btn, gear);
    }, 1000);
  }

  function build() {
    document.head.appendChild(el('style', { text: CSS }));

    var btn = el('button', { id: 'liquify-lg-btn', type: 'button' });
    btn.setAttribute('aria-label', 'Liquid Glass の設定');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="3.2" y="6.2" width="17.6" height="11.6" rx="5" ' +
      'stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M6.4 9.2c1.6 1.1 3.4 1.7 5.6 1.7s4-.6 5.6-1.7" ' +
      'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".75"/>' +
      '</svg>';
    btn.style.setProperty('-webkit-app-region', 'no-drag');
    btn.style.pointerEvents = 'auto';
    placeButton(btn);

    var presets = el('div', { class: 'presets' });
    Object.keys(PRESETS).forEach(function (k) {
      var b = el('button', { text: t(PRESETS[k].label) });
      b.dataset.k = k;
      b.addEventListener('click', function () { applyPreset(k); });
      presets.appendChild(b);
    });

    var closeBtn = el('button', { class: 'x', text: '×', title: t('閉じる') });
    var body = el('div', { class: 'body' }, [presets]);
    var panel = el('div', { id: 'liquify-lg-panel' }, [
      el('div', { class: 'head' }, [el('h3', { text: 'Liquid Glass' }), closeBtn]),
      body,
    ]);
    var scrim = el('div', { id: 'liquify-lg-scrim', hidden: 'hidden' }, [panel]);

    SLIDERS.forEach(function (s) {
      var input = el('input', { type: 'range', min: s.min, max: s.max, step: s.step });
      var out = el('output');
      input.addEventListener('input', function () {
        var v = +input.value;
        out.value = v.toFixed(s.step < 1 ? 2 : 0);
        if (s.k === 'tint') {
          var su = window.liquifyLG.defaults.surface.slice();
          su[3] = v;
          window.liquifyLG.set({ surface: su });
        } else {
          var patch = {};
          patch[s.k] = v;
          // touching brightness-related knobs by hand means leaving adaptive mode
          if (s.k === 'blurMix' || s.k === 'saturation') patch.adaptive = false;
          window.liquifyLG.set(patch);
        }
        current = null;
        syncInputs();
        save();
      });
      inputs[s.k] = { input: input, out: out };
      body.appendChild(el('label', {}, [el('span', { text: t(s.label) }), input, out]));
    });

    var toggle = el('button', { text: window.liquifyLG.enabled ? 'ON' : 'OFF' });
    toggle.addEventListener('click', function () {
      toggle.textContent = window.liquifyLG.toggle() ? 'ON' : 'OFF';
    });
    body.appendChild(el('div', { class: 'row' }, [
      el('span', { text: t('ガラス (Ctrl+Shift+G)') }), toggle,
    ]));

    /* Read only. Ctrl and the wheel change it; this says where you are. */
    var zoomOut = el('span', { text: '—' });
    zoomOut.style.opacity = '.85';
    zoomOut.style.fontVariantNumeric = 'tabular-nums';
    function refreshZoom() {
      readZoom(function (pct) { zoomOut.textContent = pct === null ? '—' : pct + '%'; });
    }
    refreshZoom();
    window.addEventListener('resize', refreshZoom, { passive: true });
    body.appendChild(el('div', { class: 'row' }, [
      el('span', { text: t('拡大率') }), zoomOut,
    ]));

    var reset = el('button', { text: t('既定に戻す') });
    reset.addEventListener('click', function () { applyPreset('clear'); });
    body.appendChild(el('div', { class: 'row' }, [
      el('span', { text: t('リセット') }), reset,
    ]));

    body.appendChild(el('div', { class: 'hint', text: t('設定は次回起動時にも残ります。') }));
    document.body.appendChild(scrim);

    function open(on) {
      scrim.hidden = !on;
      if (on) syncInputs();
    }
    btn.addEventListener('click', function () { open(scrim.hidden); });
    closeBtn.addEventListener('click', function () { open(false); });
    /* Clicking the sheet itself must not close it - only the space around. */
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) open(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !scrim.hidden) { open(false); e.stopPropagation(); }
    }, true);

    applyRetina();
    current = restore() || 'clear';
    if (!localStorage.getItem(KEY)) applyPreset('clear');
    syncInputs();
  }

  /* Wait for the language too. The labels are written once when the panel is
   * built, and Spotify sets <html lang> after its own boot, so building the
   * moment the renderer exists produced an English panel in a Japanese client.
   * The deadline is there so a client that never sets it still gets a panel. */
  var waited = 0;

  function wait() {
    var ready = window.liquifyLG && document.body;
    var known = document.documentElement.lang ||
      (window.Spicetify && Spicetify.Locale && Spicetify.Locale.getLocale &&
       Spicetify.Locale.getLocale());
    if (ready && (known || waited > 8000)) build();
    else { waited += 300; setTimeout(wait, 300); }
  }
  wait();
})();
