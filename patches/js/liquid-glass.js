/* Liquid glass for Liquify, drawn in WebGL.
 *
 * Spicetify extension. Draws a canvas between Liquify's album-art background
 * and the UI, and renders the glass for a fixed list of surfaces into it. The
 * surfaces themselves are made transparent so the canvas shows through.
 *
 * Why not backdrop-filter: this only runs where the backdrop is known - the
 * album-art layer - so the backdrop can be rebuilt exactly and sampled
 * directly. That removes the 8-bit displacement map, the filter-subregion
 * quirks, and the blur approximation all at once.
 *
 * The shader bodies are ported from Kyant0/AndroidLiquidGlass (Backdrop),
 * Apache-2.0, from AGSL. AGSL is GLSL with different scalar names.
 */
(function () {
  'use strict';

  var LOG = '[liquid-glass]';

  /* Surfaces whose backdrop really is only the album-art layer. Anything that
   * sits over a scrolling list is deliberately not here - the canvas would show
   * the wallpaper where the list should be. */
  var TARGETS = [
    { selector: '.Root__now-playing-bar', radius: 20 },
  ];

  var DEFAULTS = {
    superness: 4,
    height: 24,
    amount: 48,
    depthEffect: 1,
    dispersion: 0.3,
    brightness: 0,
    contrast: 1,
    saturation: 1.5,
    surface: [1, 1, 1, 0.05],
    hlAngle: 45,
    hlFalloff: 2,
    hlAlpha: 0.5,
    hlWidth: 1.5,
  };

  // ---- shaders ------------------------------------------------------------

  var VERT = [
    '#version 300 es',
    'in vec2 aPos;',
    'out vec2 vPix;',
    'uniform vec2 uCanvas;',
    'uniform vec4 uRect;',
    'void main() {',
    '  vec2 pix = uRect.xy + aPos * uRect.zw;',
    '  vPix = pix;',
    '  vec2 clip = (pix / uCanvas) * 2.0 - 1.0;',
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);',
    '}',
  ].join('\n');

  var FRAG = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vPix;',
    'out vec4 outColor;',
    'uniform sampler2D uBackdrop;',
    'uniform vec2 uCanvas;',
    'uniform vec4 uRect;',
    'uniform vec4 uRadii;',
    'uniform float uSuperness;',
    'uniform float uRefractionHeight;',
    'uniform float uRefractionAmount;',
    'uniform float uDepthEffect;',
    'uniform float uDispersion;',
    'uniform float uBrightness;',
    'uniform float uContrast;',
    'uniform float uSaturation;',
    'uniform vec4 uSurface;',
    'uniform vec4 uHighlight;',
    'uniform float uHlAngle;',
    'uniform float uHlFalloff;',
    'uniform float uHlWidth;',
    '',
    'float radiusAt(vec2 coord, vec4 radii) {',
    '  if (coord.x >= 0.0) { if (coord.y <= 0.0) return radii.y; else return radii.z; }',
    '  else { if (coord.y <= 0.0) return radii.x; else return radii.w; }',
    '}',
    'float sdRoundedRect(vec2 coord, vec2 halfSize, float radius, float n) {',
    '  vec2 q = abs(coord) - (halfSize - vec2(radius));',
    '  if (q.x <= 0.0 || q.y <= 0.0) return max(q.x, q.y) - radius;',
    '  if (n <= 2.001) return length(q) - radius;',
    '  float an = pow(q.x, n) + pow(q.y, n);',
    '  float f = pow(an, 1.0 / n) - radius;',
    '  vec2 gv = vec2(pow(q.x, n - 1.0), pow(q.y, n - 1.0));',
    '  float gl = length(gv) / pow(an, (n - 1.0) / n);',
    '  return gl < 1e-6 ? f : f / gl;',
    '}',
    'vec2 gradSdRoundedRect(vec2 coord, vec2 halfSize, float radius, float n) {',
    '  vec2 q = abs(coord) - (halfSize - vec2(radius));',
    '  if (q.x >= 0.0 && q.y >= 0.0) {',
    '    vec2 gv = (n <= 2.001) ? q : vec2(pow(q.x, n - 1.0), pow(q.y, n - 1.0));',
    '    return sign(coord) * normalize(max(gv, 1e-6));',
    '  } else {',
    '    float gradX = step(q.y, q.x);',
    '    return sign(coord) * vec2(gradX, 1.0 - gradX);',
    '  }',
    '}',
    'float circleMap(float x) { return 1.0 - sqrt(1.0 - x * x); }',
    'vec4 sampleBackdrop(vec2 pix) { return texture(uBackdrop, pix / uCanvas); }',
    'vec3 colorControls(vec3 c) {',
    '  float invSat = 1.0 - uSaturation;',
    '  float r = 0.213 * invSat, g = 0.715 * invSat, b = 0.072 * invSat;',
    '  float k = uContrast, s = uSaturation;',
    '  float t = 0.5 - k * 0.5 + uBrightness;',
    '  vec3 o;',
    '  o.r = k * ((r + s) * c.r + g * c.g + b * c.b) + t;',
    '  o.g = k * (r * c.r + (g + s) * c.g + b * c.b) + t;',
    '  o.b = k * (r * c.r + g * c.g + (b + s) * c.b) + t;',
    '  return o;',
    '}',
    'void main() {',
    '  vec2 halfSize = uRect.zw * 0.5;',
    '  vec2 centered = (vPix - uRect.xy) - halfSize;',
    '  float radius = radiusAt(centered, uRadii);',
    '  float sd = sdRoundedRect(centered, halfSize, radius, uSuperness);',
    '  if (sd > 0.0) { outColor = vec4(0.0); return; }',
    '  vec2 refracted = vPix;',
    '  vec2 dispersed = vec2(0.0);',
    '  if (-sd < uRefractionHeight) {',
    '    float d = circleMap(1.0 - (-sd) / uRefractionHeight) * uRefractionAmount;',
    '    float gradRadius = min(radius * 1.5, min(halfSize.x, halfSize.y));',
    '    vec2 grad = normalize(gradSdRoundedRect(centered, halfSize, gradRadius, uSuperness)',
    '                          + uDepthEffect * normalize(centered + 1e-6));',
    '    refracted = vPix + d * grad;',
    '    float di = uDispersion * ((centered.x * centered.y) / (halfSize.x * halfSize.y));',
    '    dispersed = d * grad * di;',
    '  }',
    '  vec4 color = vec4(0.0);',
    '  if (uDispersion > 0.0) {',
    '    vec4 red = sampleBackdrop(refracted + dispersed);',
    '    color.r += red.r / 3.5;',
    '    vec4 orange = sampleBackdrop(refracted + dispersed * (2.0 / 3.0));',
    '    color.r += orange.r / 3.5; color.g += orange.g / 7.0;',
    '    vec4 yellow = sampleBackdrop(refracted + dispersed * (1.0 / 3.0));',
    '    color.r += yellow.r / 3.5; color.g += yellow.g / 3.5;',
    '    vec4 green = sampleBackdrop(refracted);',
    '    color.g += green.g / 3.5;',
    '    vec4 cyan = sampleBackdrop(refracted - dispersed * (1.0 / 3.0));',
    '    color.g += cyan.g / 3.5; color.b += cyan.b / 3.0;',
    '    vec4 blue = sampleBackdrop(refracted - dispersed * (2.0 / 3.0));',
    '    color.b += blue.b / 3.0;',
    '    vec4 purple = sampleBackdrop(refracted - dispersed);',
    '    color.r += purple.r / 7.0; color.b += purple.b / 3.0;',
    '  } else {',
    '    color.rgb = sampleBackdrop(refracted).rgb;',
    '  }',
    '  color.rgb = colorControls(color.rgb);',
    '  color.rgb = mix(color.rgb, uSurface.rgb, uSurface.a);',
    '  float gradRadius = min(radius * 1.5, min(halfSize.x, halfSize.y));',
    '  vec2 g = gradSdRoundedRect(centered, halfSize, gradRadius, uSuperness);',
    '  vec2 lightDir = vec2(cos(uHlAngle), sin(uHlAngle));',
    '  float intensity = pow(abs(dot(g, lightDir)), uHlFalloff);',
    '  float band = 1.0 - smoothstep(uHlWidth - 1.0, uHlWidth + 1.0, -sd);',
    '  color.rgb += uHighlight.rgb * (intensity * band * uHighlight.a);',
    '  float cov = clamp(-sd, 0.0, 1.0);',
    '  outColor = vec4(color.rgb * cov, cov);',
    '}',
  ].join('\n');

  // ---- gl plumbing --------------------------------------------------------

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function Renderer(canvas) {
    var gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(p, 'aPos');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.u = {};
    ['uCanvas','uRect','uRadii','uSuperness','uRefractionHeight','uRefractionAmount',
     'uDepthEffect','uDispersion','uBrightness','uContrast','uSaturation',
     'uSurface','uHighlight','uHlAngle','uHlFalloff','uHlWidth','uBackdrop'
    ].forEach(function (n) { this.u[n] = gl.getUniformLocation(p, n); }, this);
  }

  Renderer.prototype.setBackdrop = function (src) {
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  };

  Renderer.prototype.begin = function () {
    var gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uBackdrop, 0);
    gl.uniform2f(this.u.uCanvas, gl.canvas.width, gl.canvas.height);
  };

  Renderer.prototype.draw = function (rect, o) {
    var gl = this.gl, u = this.u;
    gl.uniform4f(u.uRect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform4f(u.uRadii, rect.r, rect.r, rect.r, rect.r);
    gl.uniform1f(u.uSuperness, o.superness);
    gl.uniform1f(u.uRefractionHeight, Math.max(0.01, o.height));
    gl.uniform1f(u.uRefractionAmount, -o.amount);
    gl.uniform1f(u.uDepthEffect, o.depthEffect);
    gl.uniform1f(u.uDispersion, o.dispersion);
    gl.uniform1f(u.uBrightness, o.brightness);
    gl.uniform1f(u.uContrast, o.contrast);
    gl.uniform1f(u.uSaturation, o.saturation);
    gl.uniform4f(u.uSurface, o.surface[0], o.surface[1], o.surface[2], o.surface[3]);
    gl.uniform4f(u.uHighlight, 1, 1, 1, o.hlAlpha);
    gl.uniform1f(u.uHlAngle, o.hlAngle * Math.PI / 180);
    gl.uniform1f(u.uHlFalloff, o.hlFalloff);
    gl.uniform1f(u.uHlWidth, o.hlWidth);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  // ---- rebuilding Liquify's backdrop --------------------------------------

  /* .liquify-bg-layer is the album art at background-size:cover, centred,
   * with filter: blur(--liquify-bg-blur, 7px) brightness(--liquify-bg-brightness, 45%).
   * Reproduced here so the shader has real pixels to sample. */
  function coverUrl() {
    var raw = window.Spicetify && Spicetify.Player && Spicetify.Player.data &&
      Spicetify.Player.data.item && Spicetify.Player.data.item.metadata &&
      Spicetify.Player.data.item.metadata.image_url;
    if (!raw) return null;
    return raw.replace('spotify:image:', 'https://i.scdn.co/image/');
  }

  function cssNumber(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function buildBackdropCanvas(img, W, H) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var blurPx = cssNumber('--liquify-bg-blur', 7) * dpr;
    var brightness = cssNumber('--liquify-bg-brightness', 45) / 100;

    if (img) {
      // background-size: cover, background-position: center
      var s = Math.max(W / img.width, H / img.height);
      var dw = img.width * s, dh = img.height * s;
      c.filter = blurPx > 0 ? 'blur(' + blurPx + 'px)' : 'none';
      // overdraw so the blur does not darken the edges
      var pad = Math.ceil(blurPx * 3);
      c.drawImage(img, (W - dw) / 2 - pad, (H - dh) / 2 - pad, dw + pad * 2, dh + pad * 2);
      c.filter = 'none';
    } else {
      c.fillStyle = '#1c1c22';
      c.fillRect(0, 0, W, H);
    }
    if (brightness < 1) {
      c.fillStyle = 'rgba(0,0,0,' + (1 - brightness) + ')';
      c.fillRect(0, 0, W, H);
    }
    return cv;
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  // ---- wiring -------------------------------------------------------------

  var canvas, renderer, currentUrl = null, pending = false;

  function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.id = 'liquify-lg-canvas';
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    var root = document.querySelector('.Root__top-container') || document.body;
    root.appendChild(canvas);
    renderer = new Renderer(canvas);
    return canvas;
  }

  function ensureStyle() {
    if (document.getElementById('liquify-lg-style')) return;
    var st = document.createElement('style');
    st.id = 'liquify-lg-style';
    // hand the surfaces over: no backdrop-filter of Liquify's, and lift the
    // element above the canvas so its own content still draws on top
    st.textContent = TARGETS.map(function (t) {
      return t.selector + '{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;' +
             'background:transparent!important;position:relative;z-index:2;}';
    }).join('') + '#liquify-lg-canvas{z-index:1;}';
    document.head.appendChild(st);
  }

  function render() {
    if (!renderer) return;
    var dpr = window.devicePixelRatio || 1;
    var W = Math.round(window.innerWidth * dpr);
    var H = Math.round(window.innerHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

    renderer.begin();
    TARGETS.forEach(function (t) {
      var el = document.querySelector(t.selector);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.draw({
        x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr,
        r: t.radius * dpr,
      }, Object.assign({}, DEFAULTS, {
        height: DEFAULTS.height * dpr,
        amount: DEFAULTS.amount * dpr,
        hlWidth: DEFAULTS.hlWidth * dpr,
      }));
    });
  }

  function refreshBackdrop() {
    if (pending) return;
    pending = true;
    var url = coverUrl();
    var dpr = window.devicePixelRatio || 1;
    var W = Math.round(window.innerWidth * dpr);
    var H = Math.round(window.innerHeight * dpr);
    Promise.resolve(url ? loadImage(url) : null).then(function (img) {
      pending = false;
      currentUrl = url;
      renderer.setBackdrop(buildBackdropCanvas(img, W, H));
      render();
    });
  }

  function start() {
    try {
      ensureCanvas();
      ensureStyle();
    } catch (e) {
      console.warn(LOG, 'disabled:', e && e.message);
      return;
    }
    refreshBackdrop();

    if (window.Spicetify && Spicetify.Player && Spicetify.Player.addEventListener) {
      Spicetify.Player.addEventListener('songchange', function () {
        if (coverUrl() !== currentUrl) refreshBackdrop();
      });
    }
    window.addEventListener('resize', function () { refreshBackdrop(); });

    // the playbar changes height when the queue/lyrics panel opens
    var ro = new ResizeObserver(function () { render(); });
    TARGETS.forEach(function (t) {
      var el = document.querySelector(t.selector);
      if (el) ro.observe(el);
    });

    window.liquifyLG = { render: render, refresh: refreshBackdrop, defaults: DEFAULTS };
    console.log(LOG, 'ready');
  }

  function waitForSpicetify() {
    if (window.Spicetify && Spicetify.Player && document.querySelector('.Root__top-container')) {
      start();
    } else {
      setTimeout(waitForSpicetify, 300);
    }
  }
  waitForSpicetify();
})();
