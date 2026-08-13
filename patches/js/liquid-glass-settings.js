/* Settings panel for the liquid glass extension.
 *
 * Separate file so the renderer stays about rendering. It only talks to
 * window.liquifyLG, which liquid-glass.js publishes, and persists whatever the
 * user lands on so it survives a restart.
 */
(function () {
  'use strict';

  var KEY = 'liquify-lg-settings';

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
      values: { adaptive: false, brightness: 0, contrast: 1, saturation: 1.5,
                blurMix: 0, surface: [1, 1, 1, 0.03], dispersion: 1,
                superness: 2, height: 24, amount: 48, hlAlpha: 0.5 },
    },
    adaptive: {
      label: '適応',
      values: { adaptive: true, saturation: 1.5, surface: [1, 1, 1, 0.05],
                dispersion: 1, superness: 2, height: 24, amount: 48, hlAlpha: 0.5 },
    },
    frosted: {
      label: 'くもり',
      values: { adaptive: false, brightness: 0, contrast: 1, saturation: 1.5,
                blurMix: 1, surface: [1, 1, 1, 0.12], dispersion: 0.4,
                superness: 2, height: 24, amount: 48, hlAlpha: 0.55 },
    },
  };

  var SLIDERS = [
    { k: 'height', label: '屈折の幅', min: 2, max: 90, step: 1 },
    { k: 'amount', label: '屈折の量', min: 0, max: 160, step: 1 },
    { k: 'dispersion', label: '色収差', min: 0, max: 1, step: 0.02 },
    { k: 'superness', label: '角の丸み', min: 2, max: 8, step: 0.1 },
    { k: 'depthEffect', label: '深さ', min: 0, max: 1, step: 0.02 },
    { k: 'saturation', label: '彩度', min: 1, max: 2.5, step: 0.05 },
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
    '#liquify-lg-panel{position:fixed;right:18px;top:64px;z-index:99999;width:286px;' +
    'padding:14px 16px;border-radius:16px;border:1px solid rgba(255,255,255,.14);' +
    'background:rgba(18,18,22,.94);backdrop-filter:blur(20px);color:#fff;' +
    'font:12px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif;' +
    'max-height:70vh;overflow:auto;box-shadow:0 18px 50px rgba(0,0,0,.5);}' +
    '#liquify-lg-panel[hidden]{display:none;}' +
    '#liquify-lg-panel h3{margin:0 0 10px;font-size:11px;letter-spacing:.1em;opacity:.55;' +
    'text-transform:uppercase;font-weight:600;}' +
    '#liquify-lg-panel .presets{display:flex;gap:6px;margin-bottom:12px;}' +
    '#liquify-lg-panel .presets button{flex:1;padding:6px 0;border-radius:9px;cursor:pointer;' +
    'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;}' +
    '#liquify-lg-panel .presets button.on{background:rgba(255,255,255,.9);color:#111;border-color:transparent;}' +
    '#liquify-lg-panel label{display:flex;align-items:center;gap:8px;margin:6px 0;}' +
    '#liquify-lg-panel label>span{flex:0 0 72px;opacity:.75;}' +
    '#liquify-lg-panel input[type=range]{flex:1;min-width:0;accent-color:#fff;}' +
    '#liquify-lg-panel output{flex:0 0 40px;text-align:right;font-variant-numeric:tabular-nums;opacity:.85;}' +
    '#liquify-lg-panel .row{display:flex;align-items:center;justify-content:space-between;' +
    'padding:8px 0;border-top:1px solid rgba(255,255,255,.1);margin-top:10px;}' +
    '#liquify-lg-panel .row button{padding:5px 12px;border-radius:9px;cursor:pointer;' +
    'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:inherit;}' +
    '#liquify-lg-panel .hint{opacity:.45;font-size:11px;margin-top:8px;}';

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
          superness: d.superness, depthEffect: d.depthEffect,
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
  var RETINA_KEY = 'liquify-lg-retina';

  function retinaOn() {
    return localStorage.getItem(RETINA_KEY) === 'on';
  }

  function applyRetina() {
    document.documentElement.style.zoom = retinaOn() ? '2' : '';
  }

  /* Toggling this live leaves half the app measured at the old scale, so it is
   * saved and the window is reloaded. A true device scale change needs
   * --force-device-scale-factor at launch, which a panel inside the app cannot
   * set; this is CSS zoom, applied once on load. */
  function setRetina(on) {
    try { localStorage.setItem(RETINA_KEY, on ? 'on' : 'off'); } catch (e) {}
    location.reload();
  }

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
      var b = el('button', { text: PRESETS[k].label });
      b.dataset.k = k;
      b.addEventListener('click', function () { applyPreset(k); });
      presets.appendChild(b);
    });

    var panel = el('div', { id: 'liquify-lg-panel', hidden: 'hidden' }, [
      el('h3', { text: 'Liquid Glass' }),
      presets,
    ]);

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
      panel.appendChild(el('label', {}, [el('span', { text: s.label }), input, out]));
    });

    var toggle = el('button', { text: window.liquifyLG.enabled ? 'ON' : 'OFF' });
    toggle.addEventListener('click', function () {
      toggle.textContent = window.liquifyLG.toggle() ? 'ON' : 'OFF';
    });
    panel.appendChild(el('div', { class: 'row' }, [
      el('span', { text: 'ガラス (Ctrl+Shift+G)' }), toggle,
    ]));

    /* Treat the display as Retina.
     *
     * The honest way is --force-device-scale-factor=2 at launch, but a panel
     * cannot change a launch flag. CSS zoom on the root gets the same result
     * here: getBoundingClientRect returns coordinates in the zoomed space and
     * innerWidth stays put, so the canvas and the surfaces still share one
     * coordinate system and none of the drawing maths changes. Checked in the
     * app rather than assumed. */
    var retina = el('button', { text: retinaOn() ? '2x' : '1x' });
    retina.addEventListener('click', function () {
      var on = !retinaOn();
      setRetina(on);
      retina.textContent = on ? '2x' : '1x';
    });
    panel.appendChild(el('div', { class: 'row' }, [
      el('span', { text: 'Retina 表示' }), retina,
    ]));

    var reset = el('button', { text: '既定に戻す' });
    reset.addEventListener('click', function () { applyPreset('clear'); });
    panel.appendChild(el('div', { class: 'row' }, [
      el('span', { text: 'リセット' }), reset,
    ]));

    panel.appendChild(el('div', { class: 'hint', text: '設定は次回起動時にも残ります。' }));
    document.body.appendChild(panel);

    btn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) syncInputs();
    });

    applyRetina();
    current = restore() || 'clear';
    if (!localStorage.getItem(KEY)) applyPreset('clear');
    syncInputs();
  }

  function wait() {
    if (window.liquifyLG && document.body) build();
    else setTimeout(wait, 300);
  }
  wait();
})();
