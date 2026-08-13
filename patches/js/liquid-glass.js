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

  /* Every surface Liquify puts glass on, generated from its GLASS_TARGETS by
   * tools/gen-targets.py. Some of these sit over scrolling content, where the
   * canvas shows the wallpaper instead of what is really behind - that is
   * expected for now and gets trimmed once we can see which ones break.
   *
   * Resolved inside start(), not at module scope: both files are deferred and
   * this one runs first, so at module scope the global is not there yet and we
   * would silently fall back to a single selector. */
  var TARGETS = [];

  function resolveTargets() {
    var raw = window.__liquifyGlassTargets;
    if (!raw || !raw.length) raw = [{ s: '.Root__now-playing-bar', r: 20 }];
    TARGETS = raw.map(function (t) {
      return { selector: t.s, radius: t.r, ca: t.ca !== false };
    });
    /* Our own settings button sits next to Liquify's gear, which is one of the
     * theme's glass targets. Without this it is the one flat, square-looking
     * control in the row. */
    TARGETS.push({ selector: '#liquify-lg-btn', radius: 17, ca: true });

    /* Surfaces that sit on top of the app rather than in it. These want the
     * frosted end of the material: they are asking for attention, and reading
     * a dialog over a sharp wallpaper is hard. Marked here rather than left to
     * the theme, whose own blur is the one being replaced. */
    for (var i = 0; i < TARGETS.length; i++) {
      TARGETS[i].overlay = OVERLAYS.indexOf(TARGETS[i].selector) >= 0;
    }
  }

  var OVERLAYS = [
    '.liquifySettingsPanel', '.liquifySelectMenu', 'dialog',
    '.main-contextMenu-menu', '.main-contextMenu-tippy', '.Dropdown-menu',
    '.Root__cinema-view', '.main-playlistEditDetailsModal-container',
    '.main-trackCreditsModal-container', '.main-embedWidgetGenerator-container',
    '#marketplace-readme', '.xamNkt5LX9o8aL1q', '.zddkQq3wlxEOg6aa',
    '.NJh1B8rnlSUlK7sY', '.main-topBar-buddyFeed', '.main-userWidget-box',
  ];

  // frosted rather than clear: overlays want separation from what is under them
  var OVERLAY_STYLE = {
    blurMix: 1,
    dispersion: 0,
    surface: [1, 1, 1, 0.14],
    hlAlpha: 0.55,
  };

  var MAX_ELEMENTS = 400;   // backstop; drawing is cheap, layout reads are not

  var DEFAULTS = {
    superness: 4,
    height: 24,
    amount: 48,
    depthEffect: 1,
    dispersion: 1,        // Backdrop passes chromaticAberration = 1.0
    adaptive: false,      // the panel's 適応 preset turns this on
    blurMix: 0,
    dispersionCorner: 1,   // 1 = corners only, as Backdrop and iOS do it
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

  /* No y flip here on purpose. Everything is rendered into an offscreen target
   * that is also sampled, so pixel y and texture row have to agree; the flip
   * happens once, in the final blit to the canvas. */
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
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '}',
  ].join('\n');

  var QUAD_VERT = [
    '#version 300 es',
    'in vec2 aPos;',
    'out vec2 vUv;',
    'uniform float uFlip;',
    'void main() {',
    '  vUv = vec2(aPos.x, mix(aPos.y, 1.0 - aPos.y, uFlip));',
    '  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);',
    '}',
  ].join('\n');

  var QUAD_FRAG = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'out vec4 outColor;',
    'uniform sampler2D uTex;',
    'void main() { outColor = texture(uTex, vUv); }',
  ].join('\n');

  var FRAG = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vPix;',
    'out vec4 outColor;',
    'uniform sampler2D uBackdrop;',
    'uniform sampler2D uBackdropBlur;',
    'uniform float uBlurMix;',
    'uniform vec2 uCanvas;',
    'uniform vec4 uRect;',
    'uniform vec4 uRadii;',
    'uniform float uSuperness;',
    'uniform float uRefractionHeight;',
    'uniform float uRefractionAmount;',
    'uniform float uDepthEffect;',
    'uniform float uDispersion;',
    'uniform float uDispersionCorner;',
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
    'vec4 sampleBackdrop(vec2 pix) {',
    '  vec2 uv = pix / uCanvas;',
    '  return mix(texture(uBackdrop, uv), texture(uBackdropBlur, uv), uBlurMix);',
    '}',
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
    '    // Dispersion is weighted by (x*y)/(hw*hh), which is exactly zero along',
    '    // both axes, so it only shows near the corners - which is where iOS',
    '    // shows it too. uDispersionCorner = 0 spreads it along the whole edge',
    '    // instead, kept only because it is useful for checking the taps work.',
    '    float uv = (centered.x * centered.y) / (halfSize.x * halfSize.y);',
    '    float di = uDispersion * mix(1.0, uv, uDispersionCorner);',
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

  function link(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  /* The canvas is the whole background-and-glass layer, drawn back to front:
   * wallpaper first, then every glass surface in paint order, each one sampling
   * what has already been drawn. That is what lets a card refract the panel it
   * sits on instead of the wallpaper two layers down.
   *
   * Sampling what we are drawing into needs two surfaces: render into `rt`,
   * then copy the touched rectangle into `sample` before the next quad reads
   * it. GL cannot read and write one texture in a single draw. */
  function Renderer(canvas) {
    var gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.prog = link(gl, VERT, FRAG);
    this.quad = link(gl, QUAD_VERT, QUAD_FRAG);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    var a = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.wall = this.makeTex();     // the wallpaper
    this.wallBlur = this.makeTex(); // and a blurred copy, for bright backdrops
    this.sample = this.makeTex();   // what the next quad reads
    this.sampleBlur = this.makeTex();
    this.rt = this.makeTex();       // what we draw into
    this.fbo = gl.createFramebuffer();
    this.size = [0, 0];

    this.u = {};
    ['uCanvas','uRect','uRadii','uSuperness','uRefractionHeight','uRefractionAmount',
     'uDepthEffect','uDispersion','uDispersionCorner','uBrightness','uContrast','uSaturation',
     'uSurface','uHighlight','uHlAngle','uHlFalloff','uHlWidth','uBackdrop',
     'uBackdropBlur','uBlurMix'
    ].forEach(function (n) { this.u[n] = gl.getUniformLocation(this.prog, n); }, this);
    this.uq = {
      uTex: gl.getUniformLocation(this.quad, 'uTex'),
      uFlip: gl.getUniformLocation(this.quad, 'uFlip'),
    };
  }

  Renderer.prototype.makeTex = function () {
    var gl = this.gl;
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  Renderer.prototype.resize = function (W, H) {
    if (this.size[0] === W && this.size[1] === H) return;
    var gl = this.gl;
    [this.sample, this.sampleBlur, this.rt].forEach(function (t) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }, this);
    this.size = [W, H];
  };

  Renderer.prototype.setBackdrop = function (src, blurred) {
    var gl = this.gl;
    /* No flip on upload. Pixel y = 0 maps to framebuffer row 0 (see VERT) and
     * sampling uses v = pix.y / H, so texture row r has to be source row r.
     * Flipping here turns it into H-1-r and the wallpaper comes out upside
     * down. The one flip that belongs in the pipeline is the final blit. */
    gl.bindTexture(gl.TEXTURE_2D, this.wall);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (blurred) {
      gl.bindTexture(gl.TEXTURE_2D, this.wallBlur);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blurred);
    }
  };

  Renderer.prototype.blit = function (tex, flip) {
    var gl = this.gl;
    gl.useProgram(this.quad);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.uq.uTex, 0);
    gl.uniform1f(this.uq.uFlip, flip ? 1 : 0);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  Renderer.prototype.begin = function () {
    var gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    var W = gl.canvas.width, H = gl.canvas.height;
    this.resize(W, H);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rt, 0);
    gl.viewport(0, 0, W, H);

    // the wallpaper is the bottom of the stack, in both sharp and blurred form
    this.blit(this.wallBlur, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sampleBlur);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    this.blit(this.wall, false);
    gl.bindTexture(gl.TEXTURE_2D, this.sample);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sample);
    gl.uniform1i(this.u.uBackdrop, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sampleBlur);
    gl.uniform1i(this.u.uBackdropBlur, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(this.u.uCanvas, W, H);
  };

  /* Copy what was just drawn back into the texture the next quad reads. Only
   * the touched rectangle, padded by the refraction reach so a neighbouring
   * surface can still bend the edge of this one. */
  Renderer.prototype.commit = function (rect, pad) {
    var gl = this.gl;
    var W = this.size[0], H = this.size[1];
    var x = Math.max(0, Math.floor(rect.x - pad));
    var y = Math.max(0, Math.floor(rect.y - pad));
    var w = Math.min(W - x, Math.ceil(rect.w + pad * 2));
    var h = Math.min(H - y, Math.ceil(rect.h + pad * 2));
    if (w <= 0 || h <= 0) return;
    gl.bindTexture(gl.TEXTURE_2D, this.sample);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, x, y, x, y, w, h);

    // The blurred stack has to follow, or a surface drawn on top of this one
    // would blur what was here before instead of what is here now.
    //
    // It gets copied on unit 1, not unit 0. Binding it on unit 0 and walking
    // away leaves the blurred texture sitting in uBackdrop's unit, so every
    // surface drawn after the first one reads the blurred copy as its sharp
    // backdrop - which looks like a grey haze spreading over the panels.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sampleBlur);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, x, y, x, y, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sample);
  };

  /* Clips a quad to the box that scrolls it, so glass cannot spill out of its
   * container. Pixel y runs downward here; GL scissor counts from the bottom. */
  Renderer.prototype.scissor = function (box) {
    var gl = this.gl;
    if (!box) { gl.disable(gl.SCISSOR_TEST); return; }
    var H = this.size[1];
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.max(0, Math.floor(box.x)),
               Math.max(0, Math.floor(H - (box.y + box.h))),
               Math.max(0, Math.ceil(box.w)),
               Math.max(0, Math.ceil(box.h)));
  };

  Renderer.prototype.end = function () {
    var gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.blit(this.rt, true);   // the one and only y flip
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
    gl.uniform1f(u.uDispersionCorner, o.dispersionCorner);
    gl.uniform1f(u.uBlurMix, o.blurMix || 0);
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
  /* Liquify's own background uses image_url, which is the 300px cover. Blown up
   * to a 4K window that is a 13x upscale, and a backdrop that smooth has
   * nothing left for the lens to bend or the dispersion to separate. The
   * xlarge variant is 640px; coverSwipe in the same theme already prefers it. */
  /* The API tops out at ab67616d0000b273, which is 640px - blown up to a 4K
   * window that is a 3x upscale and there is nothing left for the lens to bend.
   * The CDN also serves ab67616d000082c1, which is 2000px, for the same id.
   * It is not in any metadata field, so ask for it and fall back if it 404s. */
  var COVER_PREFIX_2000 = 'ab67616d000082c1';

  function coverUrls() {
    var m = window.Spicetify && Spicetify.Player && Spicetify.Player.data &&
      Spicetify.Player.data.item && Spicetify.Player.data.item.metadata;
    if (!m) return [];
    var raw = m.image_xlarge_url || m.image_large_url || m.image_url;
    if (!raw) return [];
    var url = raw.replace('spotify:image:', 'https://i.scdn.co/image/');
    var out = [];
    var mm = /^(https:\/\/i\.scdn\.co\/image\/)(ab67616d[0-9a-f]{8})([0-9a-f]+)$/.exec(url);
    if (mm) out.push(mm[1] + COVER_PREFIX_2000 + mm[3]);
    out.push(url);
    return out;
  }

  function coverUrl() {
    var u = coverUrls();
    return u.length ? u[u.length - 1] : null;   // the identity of the track
  }

  function cssNumber(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  var MAX_ADAPT_BLUR_DP = 16;   // the blurred copy is built at this radius

  function buildBackdropCanvas(img, W, H) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var blurPx = cssNumber('--liquify-bg-blur', 7) * dpr;
    var brightness = cssNumber('--liquify-bg-brightness', 45) / 100;

    if (img) {
      // background-size: cover, background-position: center
      var sc = Math.max(W / img.width, H / img.height);
      var dw = img.width * sc, dh = img.height * sc;
      c.filter = blurPx > 0 ? 'blur(' + blurPx + 'px)' : 'none';
      var pad = Math.ceil(blurPx * 3);   // overdraw so the blur cannot darken the edges
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

    /* A blurred copy of the same wallpaper. Over a bright backdrop the material
     * blurs more, so the shader mixes towards this one; over a dark backdrop it
     * stays sharp. Mixing two fixed levels is not a true variable blur, but it
     * is monotone in the same direction and costs one extra texture. */
    var bl = document.createElement('canvas');
    bl.width = W; bl.height = H;
    var bc = bl.getContext('2d');
    var r = MAX_ADAPT_BLUR_DP * dpr;
    bc.filter = 'blur(' + r + 'px)';
    var pad2 = Math.ceil(r * 3);
    bc.drawImage(cv, -pad2, -pad2, W + pad2 * 2, H + pad2 * 2);
    bc.filter = 'none';

    /* A small luminance map, so the per-surface average is a cheap array read
     * rather than a GPU reduction. The wallpaper only changes with the track. */
    var LW = 128, LH = Math.max(1, Math.round(128 * H / W));
    var sm = document.createElement('canvas');
    sm.width = LW; sm.height = LH;
    var sc2 = sm.getContext('2d');
    sc2.drawImage(cv, 0, 0, LW, LH);
    var d = sc2.getImageData(0, 0, LW, LH).data;
    var lum = new Float32Array(LW * LH);
    for (var i = 0; i < LW * LH; i++) {
      // sRGB relative luminance
      var rr = d[i*4] / 255, gg = d[i*4+1] / 255, bb = d[i*4+2] / 255;
      rr = rr <= 0.04045 ? rr / 12.92 : Math.pow((rr + 0.055) / 1.055, 2.4);
      gg = gg <= 0.04045 ? gg / 12.92 : Math.pow((gg + 0.055) / 1.055, 2.4);
      bb = bb <= 0.04045 ? bb / 12.92 : Math.pow((bb + 0.055) / 1.055, 2.4);
      lum[i] = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    }

    return { sharp: cv, blurred: bl, lum: lum, lw: LW, lh: LH };
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

  /* The shader shapes the glass as a superellipse, but the element itself is
   * still a circular-arc rounded rect, so the two outlines disagree at the
   * corners. clip-path puts the element on the same shape.
   *
   * n = 4 is the usual stand-in for Apple's continuous-curvature corner; n = 2
   * is the ordinary arc. */
  function squirclePath(w, h, radius, n, steps) {
    n = n || 4; steps = steps || 16;
    var r = Math.min(radius, Math.min(w, h) / 2);
    if (r <= 0.5) return '';
    var pts = [];
    var corners = [[w - r, h - r, 1, 1], [r, h - r, -1, 1], [r, r, -1, -1], [w - r, r, 1, -1]];
    for (var c = 0; c < 4; c++) {
      var cx = corners[c][0], cy = corners[c][1], sx = corners[c][2], sy = corners[c][3];
      var back = sx * sy < 0;   // walking clockwise, half the corners run backwards
      for (var i = 0; i <= steps; i++) {
        var u = back ? (steps - i) : i;
        var t = (u / steps) * (Math.PI / 2);
        var ex = Math.pow(Math.cos(t), 2 / n);
        var ey = Math.pow(Math.sin(t), 2 / n);
        pts.push((cx + sx * r * ex).toFixed(1) + 'px ' + (cy + sy * r * ey).toFixed(1) + 'px');
      }
    }
    return 'polygon(' + pts.join(',') + ')';
  }

  /* Not used while the elements keep their own borders: a CSS border follows
   * the element's circular border-radius, so clipping the box to a squircle
   * puts two differently shaped outlines on top of each other. Kept for the
   * day the frames are drawn in the shader instead. */
  function applySquircle(el, w, h, radius, n) {
    var key = (w | 0) + 'x' + (h | 0) + 'r' + (radius | 0) + 'n' + n;
    if (el.__lgClip === key) return;
    el.__lgClip = key;
    el.style.clipPath = squirclePath(w, h, radius, n);
  }

  // ---- wiring -------------------------------------------------------------

  var canvas, renderer, currentUrl = null, pending = false, haveBackdrop = null;
  var lumMap = null;

  /* Backdrop's AdaptiveLuminanceGlassContent: the material reads the luminance
   * behind it and moves. Over a bright backdrop it lifts its own brightness,
   * crushes contrast and blurs harder; over a dark one it darkens slightly and
   * stays sharp. That is what keeps text on the glass readable without simply
   * making the whole thing opaque. */
  function adaptTo(rect, dpr) {
    if (!lumMap) return null;
    var LW = lumMap.lw, LH = lumMap.lh;
    var W = canvas.width, H = canvas.height;
    var x0 = Math.max(0, Math.floor(rect.x / W * LW));
    var x1 = Math.min(LW, Math.ceil((rect.x + rect.w) / W * LW));
    var y0 = Math.max(0, Math.floor(rect.y / H * LH));
    var y1 = Math.min(LH, Math.ceil((rect.y + rect.h) / H * LH));
    if (x1 <= x0 || y1 <= y0) return null;
    var sum = 0, n = 0;
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) { sum += lumMap.lum[y * LW + x]; n++; }
    }
    var lum = sum / n;

    var l = lum * 2 - 1;
    l = (l < 0 ? -1 : 1) * l * l;          // signed square, as in the catalog
    var lerp = function (a, b, t) { return a + (b - a) * t; };
    var blurDp = l > 0 ? lerp(8, 16, l) : lerp(8, 2, -l);
    return {
      brightness: l > 0 ? lerp(0.1, 0.5, l) : lerp(0.1, -0.2, -l),
      contrast: l > 0 ? lerp(1, 0, l) : 1,
      blurMix: Math.max(0, Math.min(1, blurDp / MAX_ADAPT_BLUR_DP)),
    };
  }

  /* The wallpaper can be rebuilt; the app's own content cannot. A surface only
   * qualifies while nothing sits between it and the wallpaper, so the test is
   * against the current layout rather than against a list of selectors. That
   * way the floating-player layout, a Spotify layout change and any unexpected
   * overlay all fail through the same check. */
  var BLOCKERS = ['.Root__main-view', '.Root__nav-bar', '.Root__right-sidebar'];

  function backdropIsKnown(rect) {
    for (var i = 0; i < BLOCKERS.length; i++) {
      var b = document.querySelector(BLOCKERS[i]);
      if (!b) continue;
      var q = b.getBoundingClientRect();
      if (rect.left < q.right - 1 && q.left < rect.right - 1 &&
          rect.top < q.bottom - 1 && q.top < rect.bottom - 1) return false;
    }
    return true;
  }

  function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.id = 'liquify-lg-canvas';
    canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    /* Same layer as Liquify's own background: z-index 0 and first child.
     * z-index 1 paints over the main view's content; z-index -1 falls behind
     * an opaque ancestor background. Only the position the theme already uses
     * puts it under the UI and over nothing else. */
    var root = document.querySelector('.Root__top-container') || document.body;
    root.insertBefore(canvas, root.firstChild);
    renderer = new Renderer(canvas);
    return canvas;
  }

  /* The style is what actually hands the surfaces over, so adding and removing
   * it is the on/off switch: with it gone, Liquify's own backdrop-filter is
   * back and nothing of ours is visible. */
  function setStyle(on) {
    var st = document.getElementById('liquify-lg-style');
    if (!on) { if (st) st.remove(); return; }
    if (st) return;
    st = document.createElement('style');
    st.id = 'liquify-lg-style';
    /* Everything the theme painted has to come off every surface it glasses,
     * not only the ones this frame happens to draw. Scoping this to the
     * handover attribute left anything off screen, too small or skipped still
     * frosted while the rest went clear - which is exactly how it looked.
     *
     * Its border and box-shadow are drawn on the element's own circular
     * border-radius too, so leaving them in place puts a second,
     * differently-shaped outline on top of the squircle. */
    var sels = TARGETS.map(function (t) { return t.selector; }).join(',');
    /* Only the theme's own glass comes off: its backdrop-filter (so nothing is
     * blurred twice) and its fill (so the canvas shows through). Borders and
     * shadows stay - they are the frames that make the panels readable as
     * panels, and stripping them left the sections outline-less. */
    st.textContent =
      ':is(' + sels + '){backdrop-filter:none!important;-webkit-backdrop-filter:none!important;' +
      'background-image:none!important;background-color:transparent!important;}' +
      ':is(' + sels + ')::before,:is(' + sels + ')::after{' +
      'backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}' +
      /* the canvas draws the wallpaper, so the theme's own layers would double it */
      '.liquify-bg-layer,.liquify-animated-bg{display:none!important;}' +
      /* The lens bends the wallpaper's detail, so the wallpaper must not be
       * pre-blurred. This belongs here rather than in the theme's CSS: with it
       * in user.css the toggle's off state was not the untouched theme either,
       * which made any comparison meaningless. */
      ':root{--liquify-bg-blur:0px!important;}';
    document.head.appendChild(st);
  }

  var enabled = localStorage.getItem('liquify-lg') !== 'off';

  function flash(text) {
    var el = document.getElementById('liquify-lg-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'liquify-lg-toast';
      el.style.cssText =
        'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:99999;' +
        'padding:8px 16px;border-radius:999px;background:rgba(0,0,0,.78);color:#fff;' +
        'font:600 13px ui-sans-serif,system-ui;pointer-events:none;transition:opacity .25s;';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; }, 1100);
  }

  function setEnabled(on, quiet) {
    enabled = !!on;
    localStorage.setItem('liquify-lg', enabled ? 'on' : 'off');
    setStyle(enabled);
    if (canvas) canvas.style.display = enabled ? '' : 'none';
    if (!enabled) {
      document.querySelectorAll('[data-liquify-lg],[data-liquify-lg-plain]').forEach(function (el) {
        el.removeAttribute('data-liquify-lg');
        el.removeAttribute('data-liquify-lg-plain');
        el.style.clipPath = '';
        el.__lgClip = null;
      });
    }
    if (!quiet) flash(enabled ? 'liquid glass: ON' : 'liquid glass: OFF (Liquify 標準)');
    if (enabled) { rescan(); render(true); }
  }

  /* Selector matching is the expensive part, so it runs on a timer; the rects
   * are re-read every frame because scrolling moves them. */
  var matched = [];
  var drawn = 0;

  /* Selector matching and style resolution are the expensive parts, so they run
   * on a timer. Only getBoundingClientRect is per-frame, because scrolling
   * moves things without changing anything else. */
  function scrollClipOf(el) {
    for (var q = el.parentElement; q; q = q.parentElement) {
      var cs = getComputedStyle(q);
      var o = cs.overflow + cs.overflowX + cs.overflowY;
      if (o.indexOf('hidden') >= 0 || o.indexOf('auto') >= 0 || o.indexOf('scroll') >= 0) return q;
      if (q === document.documentElement) break;
    }
    return null;
  }

  function rescan() {
    var out = [];
    for (var i = 0; i < TARGETS.length && out.length < MAX_ELEMENTS; i++) {
      var t = TARGETS[i];
      var els;
      try { els = document.querySelectorAll(t.selector); } catch (e) { continue; }
      for (var j = 0; j < els.length && out.length < MAX_ELEMENTS; j++) {
        var el = els[j];
        var cs = getComputedStyle(el);
        /* A surface pinned inside a scroller has the list passing underneath
         * it, and the canvas only knows the wallpaper - it would blur a static
         * image while the real content slides past. Those keep the theme's own
         * backdrop-filter, which reads the actual backdrop. Surfaces that
         * scroll along with their backdrop are fine. */
        if (!t.overlay && (cs.position === 'sticky' || cs.position === 'fixed') && scrollClipOf(el)) {
          /* Handing it back to the theme would leave it frosted while
           * everything around it is clear, which reads as a bug. Strip the
           * treatment instead: the real content shows through untouched. */
          el.setAttribute('data-liquify-lg-plain', '');
          continue;
        }
        if (el.hasAttribute('data-liquify-lg-plain')) el.removeAttribute('data-liquify-lg-plain');
        var cssR = parseFloat(cs.borderTopLeftRadius);
        out.push({
          el: el,
          t: t,
          radius: (!isNaN(cssR) && cssR > 0) ? cssR : t.radius,
          hidden: cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0,
          clip: scrollClipOf(el)
        });
      }
    }
    // back to front, so a card samples the shelf it sits on
    out.sort(function (a, b) {
      var rel = a.el.compareDocumentPosition(b.el);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    /* Nested targets would stack the material: a card inside a shelf inside a
     * section re-reads pixels that already went through colorControls and the
     * tint, so saturation compounds (1.5^3) and the white piles up. The result
     * is a milky haze over exactly the panels that nest. Keep the outermost
     * and drop its descendants - Apple does not stack glass either. */
    var kept = [];
    for (var m = 0; m < out.length; m++) {
      var nested = false;
      for (var k = 0; k < kept.length; k++) {
        if (kept[k].el.contains(out[m].el) && kept[k].el !== out[m].el) { nested = true; break; }
      }
      if (!nested) kept.push(out[m]);
      else out[m].el.setAttribute('data-liquify-lg-plain', '');
    }
    matched = kept;
    sig = '';       // force one redraw after a rescan
    dirty = true;
  }

  var sig = '';
  var dirty = true;

  /* Idle frames must cost nothing. getBoundingClientRect on every matched
   * element forces layout, so it only runs when something could have moved:
   * a scroll, a resize, a rescan, or the slow safety tick. */
  function markDirty() { dirty = true; }

  function drop(m) {
    if (m.el.hasAttribute && m.el.hasAttribute('data-liquify-lg')) {
      m.el.removeAttribute('data-liquify-lg');
      m.el.style.clipPath = '';
      m.el.__lgClip = null;
    }
  }

  function render(force) {
    if (!renderer) return;
    if (!force && !dirty) return;
    dirty = false;
    var dpr = window.devicePixelRatio || 1;
    var W = Math.round(window.innerWidth * dpr);
    var H = Math.round(window.innerHeight * dpr);
    var resized = canvas.width !== W || canvas.height !== H;
    if (resized) { canvas.width = W; canvas.height = H; }

    // collect first, so nothing is drawn when the layout has not moved
    var list = [];
    var s2 = W + 'x' + H;
    var i;
    for (i = 0; i < matched.length; i++) {
      var m = matched[i];
      if (!m.el.isConnected || m.hidden) { drop(m); continue; }
      var r = m.el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 ||
          r.bottom <= 0 || r.top >= window.innerHeight ||
          r.right <= 0 || r.left >= window.innerWidth) { drop(m); continue; }
      var c = (m.clip && m.clip.isConnected) ? m.clip.getBoundingClientRect() : null;
      if (c && (r.right <= c.left || r.left >= c.right ||
                r.bottom <= c.top || r.top >= c.bottom)) { drop(m); continue; }
      list.push({ m: m, r: r, c: c });
      s2 += '|' + (r.left | 0) + ',' + (r.top | 0) + ',' + (r.width | 0) + ',' + (r.height | 0);
    }
    if (!force && !resized && s2 === sig) return;
    sig = s2;

    renderer.begin();
    drawn = 0;
    for (i = 0; i < list.length; i++) {
      var it = list[i], mm = it.m, rr = it.r;
      if (!mm.el.hasAttribute('data-liquify-lg')) mm.el.setAttribute('data-liquify-lg', '');
      drawn++;

      var minDim = Math.min(rr.width, rr.height);
      var radius = Math.min(mm.radius, minDim / 2);

      // a full-size lens on a small chip looks wrong; scale it to what fits
      var scale = Math.min(1, minDim / 96);
      var rect = {
        x: rr.left * dpr, y: rr.top * dpr, w: rr.width * dpr, h: rr.height * dpr,
        r: radius * dpr
      };

      // glass must not spill out of the box that scrolls it
      renderer.scissor(it.c ? {
        x: it.c.left * dpr, y: it.c.top * dpr, w: it.c.width * dpr, h: it.c.height * dpr
      } : null);

      var opts = Object.assign({}, DEFAULTS, mm.t.overlay ? OVERLAY_STYLE : null, {
        height: DEFAULTS.height * scale * dpr,
        amount: DEFAULTS.amount * scale * dpr,
        hlWidth: DEFAULTS.hlWidth * dpr,
        dispersion: mm.t.overlay ? 0 : (mm.t.ca ? DEFAULTS.dispersion : 0)
      });
      if (DEFAULTS.adaptive) {
        var ad = adaptTo(rect, dpr);
        if (ad) {
          opts.brightness = ad.brightness;
          opts.contrast = ad.contrast;
          opts.blurMix = ad.blurMix;
        }
      }
      renderer.draw(rect, opts);
      // hand this surface to whatever is drawn on top of it
      renderer.commit(rect, DEFAULTS.amount * dpr + 2);
    }
    renderer.scissor(null);
    renderer.end();
  }

  function loop() {
    if (enabled) render(false);
    requestAnimationFrame(loop);
  }

  /* The backdrop is only valid once the cover has actually decoded. Building it
   * from a null image gives a flat #1c1c22 fill, which then gets refracted
   * instead of the wallpaper - it looks like a black box, not like a bug, so it
   * is worth being strict here and retrying until an image really arrives. */
  var retry = null;

  function refreshBackdrop() {
    if (pending) return;
    pending = true;
    if (retry) { clearTimeout(retry); retry = null; }

    var urls = coverUrls();
    var url = coverUrl();
    var dpr = window.devicePixelRatio || 1;
    var W = Math.round(window.innerWidth * dpr);
    var H = Math.round(window.innerHeight * dpr);

    var tryNext = function (i) {
      if (i >= urls.length) return Promise.resolve(null);
      return loadImage(urls[i]).then(function (img) {
        return img || tryNext(i + 1);
      });
    };

    tryNext(0).then(function (img) {
      pending = false;
      if (!img) {
        // no cover yet (startup) or the load failed - keep whatever we had and
        // come back for it rather than baking the fallback fill in
        if (!haveBackdrop) {
          var f = buildBackdropCanvas(null, W, H);
          lumMap = f;
          renderer.setBackdrop(f.sharp, f.blurred);
          haveBackdrop = 'fallback';
        }
        retry = setTimeout(refreshBackdrop, 1000);
        return;
      }
      currentUrl = url;
      haveBackdrop = 'cover';
      var b = buildBackdropCanvas(img, W, H);
      lumMap = b;
      renderer.setBackdrop(b.sharp, b.blurred);
      render(true);
    });
  }

  function start() {
    resolveTargets();
    try {
      ensureCanvas();
      setStyle(enabled);
      if (canvas) canvas.style.display = enabled ? '' : 'none';
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

    rescan();
    setInterval(rescan, 400);

    // anything that can move a surface without a rescan
    window.addEventListener('scroll', markDirty, { capture: true, passive: true });
    window.addEventListener('resize', markDirty, { passive: true });
    window.addEventListener('transitionrun', markDirty, { capture: true, passive: true });
    window.addEventListener('animationstart', markDirty, { capture: true, passive: true });
    new MutationObserver(markDirty).observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style'],
    });
    requestAnimationFrame(loop);

    // Ctrl+Shift+G flips between this and Liquify's own glass, so the two can
    // be compared without a restart.
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault();
        setEnabled(!enabled);
      }
    }, true);

    /* A high-contrast backdrop, for checking that refraction and dispersion
     * are actually doing something. Over a flat wallpaper both are invisible
     * by construction: shifting the sample position on a uniform colour
     * returns the same colour. */
    function testBackdrop(on) {
      if (!on) { haveBackdrop = null; refreshBackdrop(); return 'restored'; }
      var d = window.devicePixelRatio || 1;
      var W = Math.round(window.innerWidth * d), H = Math.round(window.innerHeight * d);
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var c = cv.getContext('2d');
      var sz = 24 * d;
      for (var y = 0; y < H; y += sz) {
        for (var x = 0; x < W; x += sz) {
          c.fillStyle = ((x / sz + y / sz) & 1) ? '#ffffff' : '#101014';
          c.fillRect(x, y, sz, sz);
        }
      }
      renderer.setBackdrop(cv, cv);
      lumMap = null;
      haveBackdrop = 'test';
      render(true);
      return 'test pattern';
    }

    window.liquifyLG = {
      render: function () { render(true); }, refresh: refreshBackdrop, rescan: rescan,
      testBackdrop: testBackdrop, renderer: renderer,
      defaults: DEFAULTS, targets: TARGETS,
      count: function () { return { matched: matched.length, drawn: drawn }; },
      toggle: function () { setEnabled(!enabled); return enabled; },
      on: function () { setEnabled(true); },
      off: function () { setEnabled(false); },
      get enabled() { return enabled; },
      set: function (patch) { Object.assign(DEFAULTS, patch); render(true); return DEFAULTS; },
    };
    console.log(LOG, 'ready:', TARGETS.length, 'selectors, enabled =', enabled);
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
