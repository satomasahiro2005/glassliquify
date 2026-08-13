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

    /* The three columns. The theme leaves them as plain framed boxes, which is
     * the one place the app still looks like it did before. They are the
     * largest surfaces on screen and their backdrop is the wallpaper, so there
     * is no reason for them to be the exception. */
    ['.Root__nav-bar', '.Root__main-view', '.Root__right-sidebar'].forEach(function (sel) {
      TARGETS.push({ selector: sel, radius: 20, ca: true });
    });

    /* The card itself, not the box around its cover. Wrapping the artwork was
     * what put a film on it; the card is the frame that holds the cover and
     * its title, and that is a surface like any other. */
    /* Spotify prefixes every encore class with the build number
     * (e-10451-box--interactive), so match the part that does not change.
     * .main-card-card is the older markup and no longer exists here. */
    ['[class*="box--interactive"]', '.main-card-card'].forEach(function (sel) {
      TARGETS.push({ selector: sel, radius: 20, ca: true, notInside: '.Root__nav-bar' });
    });

    /* Controls the theme's list misses: the icons at the top right, and the
     * library header's collapse and create buttons. They sit in the same rows
     * as surfaces that do have glass, so leaving them flat is what stands
     * out. */
    ['.main-actionButtons > button',
     '.main-topBar-topbarContentRight > button',
     '.main-yourLibraryX-headerContent button'].forEach(function (sel) {
      TARGETS.push({ selector: sel, radius: 17, ca: true });
    });

    /* Surfaces that sit on top of the app rather than in it. These want the
     * frosted end of the material: they are asking for attention, and reading
     * a dialog over a sharp wallpaper is hard. Marked here rather than left to
     * the theme, whose own blur is the one being replaced. */
    TARGETS = TARGETS.filter(function (t) {
      return OVERLAYS.indexOf(t.selector) < 0;
    });
  }

  /* Two different kinds of surface, so two different treatments.
   *
   * A dialog stops the app and has to be read: it wants a lot of blur, enough
   * that whatever is behind it stops competing with its text. A card that
   * floats over the page for a few seconds wants the opposite - stay light, do
   * not swallow what it is sitting on.
   *
   * Both are left exactly as the theme draws them. The backdrop behind them is
   * the app's own content, which this canvas does not have; only a real
   * backdrop-filter can read it, and the theme's is already doing that. */
  var DIALOGS = [
    '.liquifySettingsPanel', '.liquifySelectMenu', 'dialog',
    '.main-playlistEditDetailsModal-container', '.main-trackCreditsModal-container',
    '.main-embedWidgetGenerator-container', '#marketplace-readme',
  ];

  var FLOATERS = [
    '#liquify-next-song-card', '.main-contextMenu-menu', '.main-contextMenu-tippy',
    '.Dropdown-menu', '.xamNkt5LX9o8aL1q', '.zddkQq3wlxEOg6aa', '.NJh1B8rnlSUlK7sY',
    '.main-topBar-buddyFeed', '.main-userWidget-box',
  ];

  var OVERLAYS = [
    '.liquifySettingsPanel', '.liquifySelectMenu', 'dialog',
    '.main-contextMenu-menu', '.main-contextMenu-tippy', '.Dropdown-menu', '.main-playlistEditDetailsModal-container',
    '.main-trackCreditsModal-container', '.main-embedWidgetGenerator-container',
    '#marketplace-readme', '.xamNkt5LX9o8aL1q', '.zddkQq3wlxEOg6aa',
    '.NJh1B8rnlSUlK7sY', '.main-topBar-buddyFeed', '.main-userWidget-box',
    '#liquify-next-song-card',
  ];

  /* Full screen is one big sheet. Frosting it to the same degree as a context
   * menu buries the wallpaper - at that size a light haze is enough to separate
   * the panel from what is behind it. */
  var CINEMA_STYLE = {
    blurMix: 0.22,
    dispersion: 0.4,
    surface: [1, 1, 1, 0.05],
    hlAlpha: 0.5,
  };

  /* Overlays are handed back to the theme, not drawn here.
   *
   * What sits behind a dialog is the app's own content - cards, text, artwork -
   * and this canvas only knows the wallpaper and the sheets drawn into it. Take
   * the dialog's own fill away and the page shows straight through it: the
   * settings modal came out with Daily Mix tiles legible across its labels.
   * A real backdrop-filter reads the composited backdrop, so for these the
   * theme's own glass is the only thing that can work. */

  /* Below this, a control's visible shape is its own background rather than
   * anything glass can stand in for - the carousel arrows on Home disappeared
   * entirely when their fill was taken away. Leave them to the theme.
   *
   * 32 rather than 40 so the library header's create button, which is 35, is
   * not the one flat control in a row of glass ones. */
  var MIN_GLASS_SIZE = 32;

  /* Wrappers that exist to group other panels. Giving each of them a sheet of
   * its own stacks frame inside frame inside frame, and the overlaps read as
   * noise rather than as glass. The panels inside them keep their own. */
  /* A strip along the top of a pane that the theme already frames. A sheet of
   * its own lands ~20px inside that frame and the two outlines read as one
   * doubled corner. Whose frame wins does not matter much; having both does. */
  var NO_SHEET = ['.main-nowPlayingView-headerWrapper'];

  var CONTAINERS = [
    '.main-home-content section',
    '.main-shelf-shelf',
    '.view-homeShortcutsGrid-shortcuts',
    '.main-home-filterChipsSection',
    '.main-nowPlayingView-section',
    /* A strip along the top of a pane that already has its own frame. Giving
     * it a second one draws two rounded outlines a few px apart. */
    '.main-nowPlayingView-headerWrapper',
  ];

  var MAX_ELEMENTS = 400;   // backstop; drawing is cheap, layout reads are not

  var DEFAULTS = {
    superness: 4,        /* superellipse exponent: 2 is a circular arc, larger
                          * is squarer. Not a roundness dial - it sets how much
                          * of the corner is straight. */
    /* One radius for every corner in the app. Using each element's own made the
     * shape track its size - a 48px row clamps to a pill, a tall panel keeps
     * 20px - so no two corners matched. */
    cornerRadius: 18,
    radiusScale: 3,
    height: 24,
    amount: 48,
    depthEffect: 1,
    dispersion: 1,        // Backdrop passes chromaticAberration = 1.0
    adaptive: false,      // the panel's 適応 preset turns this on
    blurMix: 0,
    dispersionCorner: 1,   // 1 = corners only, as Backdrop and iOS do it
    brightness: 0,
    contrast: 1,
    saturation: 1.2,   // clear glass barely lifts it; 1.5 reads as a filter
    surface: [1, 1, 1, 0.05],
    hlAngle: 45,
    hlFalloff: 2,
    hlAlpha: 0.75,       // the rim is the only frame, so it has to carry
    hlWidth: 1.5,
    hlFloor: 0.55,
    roundChildren: true,
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
    'uniform float uHlFloor;',
    'uniform float uOpacity;',
    '',
    'float radiusAt(vec2 coord, vec4 radii) {',
    '  if (coord.x >= 0.0) { if (coord.y <= 0.0) return radii.y; else return radii.z; }',
    '  else { if (coord.y <= 0.0) return radii.x; else return radii.w; }',
    '}',
    /* A radius past half the shorter side has to saturate, the way CSS does.
     * Left unclamped, halfSize - radius goes negative and the Lp norm is
     * evaluated on a box larger than the one being drawn: the curve runs out
     * past the edge and meets itself at a point, so turning the knob up grew a
     * sharp corner exactly where the shape should have gone fully round. */
    'float sdRoundedRect(vec2 coord, vec2 halfSize, float radius, float n) {',
    '  radius = min(radius, min(halfSize.x, halfSize.y));',
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
    '  radius = min(radius, min(halfSize.x, halfSize.y));',
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
    '  // a floor keeps the rim continuous all the way round, so it reads as',
    '  // the frame of the panel and not just a glint on the lit sides',
    '  float intensity = mix(uHlFloor, 1.0, pow(abs(dot(g, lightDir)), uHlFalloff));',
    '  float band = 1.0 - smoothstep(uHlWidth - 1.0, uHlWidth + 1.0, -sd);',
    '  color.rgb += uHighlight.rgb * (intensity * band * uHighlight.a);',
    '  float cov = clamp(-sd, 0.0, 1.0);',
    '  cov *= uOpacity;',
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
     'uSurface','uHighlight','uHlAngle','uHlFalloff','uHlWidth','uHlFloor','uOpacity','uBackdrop',
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
   * container.
   *
   * No y flip here. Every surface is drawn into the render target with pixel y
   * as row y, and end() flips once on the way to the canvas - so inside the
   * target a CSS box is already the scissor box. Flipping again put the clip at
   * its mirror image: wide clips still happened to cover their element, which
   * is why the columns and the sections looked right, but a section clipping
   * its own children landed hundreds of pixels away and cut them out entirely.
   * That is what left the shortcut tiles and the shelf cards with no glass. */
  Renderer.prototype.scissor = function (box) {
    var gl = this.gl;
    if (!box) { gl.disable(gl.SCISSOR_TEST); return; }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.max(0, Math.floor(box.x)),
               Math.max(0, Math.floor(box.y)),
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
    gl.uniform1f(u.uHlFloor, o.hlFloor == null ? 0.35 : o.hlFloor);
    gl.uniform1f(u.uOpacity, o.opacity == null ? 1 : o.opacity);
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
  function superPoints(x0, y0, w, h, radius, n, steps) {
    n = n || 4; steps = steps || 16;
    var r = Math.min(radius, Math.min(w, h) / 2);
    if (r <= 0.5 || w <= 0 || h <= 0) return null;
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
        pts.push([x0 + cx + sx * r * ex, y0 + cy + sy * r * ey]);
      }
    }
    return pts;
  }

  function squirclePath(w, h, radius, n, steps) {
    var pts = superPoints(0, 0, w, h, radius, n, steps);
    if (!pts) return '';
    return 'polygon(' + pts.map(function (p) {
      return p[0].toFixed(1) + 'px ' + p[1].toFixed(1) + 'px';
    }).join(',') + ')';
  }

  /* The same corner as a ring: the outline as two subpaths with evenodd, so
   * what is left is the band between them.
   *
   * An overlay cannot be drawn by the shader - what is behind it is the app's
   * own content, which this canvas does not have. Its rim can be, though: the
   * rim is light added on top and does not read the backdrop at all. Clipping
   * a gradient to this ring puts the same edge on an overlay as the shader
   * puts on every panel, which is the part of the material the eye matches. */
  function superRingPath(w, h, radius, n, ring, steps) {
    var t = Math.max(0.75, ring);
    var outer = superPoints(0, 0, w, h, radius, n, steps);
    var inner = superPoints(t, t, w - 2 * t, h - 2 * t, radius - t, n, steps);
    if (!outer || !inner) return 'none';
    function sub(pts) {
      return 'M' + pts.map(function (p) {
        return p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      }).join('L') + 'Z';
    }
    return 'path(evenodd, "' + sub(outer) + sub(inner) + '")';
  }

  /* ---- overlays ----------------------------------------------------------
   *
   * An overlay sits on the app's own content, which this canvas does not have,
   * so the shader cannot draw it. backdrop-filter can: it reads the real
   * composited backdrop. What it needs is a displacement map, and the one the
   * theme ships is not one - it is two linear gradients across the whole box,
   * so it translates the backdrop instead of bending it at the edge.
   *
   * This builds the map the lens actually implies: the same superellipse SDF,
   * the same circleMap falloff, the same gradient direction. Inside the panel
   * the map is neutral and the backdrop passes straight through; within
   * `height` of the edge it turns and pushes outward by `amount`.
   *
   * Encoding follows feDisplacementMap: the sample offset is
   * scale * (channel - 0.5), so 0.5 is no displacement and the map is built
   * against a fixed scale rather than the element's size. */
  var lensFilters = {};

  function lensMapURL(w, h, radius, n, height, amount, enc, chan, pad) {
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w + 2 * pad));
    cv.height = Math.max(1, Math.round(h + 2 * pad));
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(cv.width, cv.height);
    var d = img.data;
    var hw = w / 2, hh = h / 2;
    /* The map covers the padded region, with the panel centred in it, so every
     * pixel the filter touches has a value. Outside the shape that value is
     * neutral - feImage returns nothing beyond its own box, and nothing reads
     * as a channel of 0, which is a full-scale displacement rather than none. */
    var cx0 = cv.width / 2, cy0 = cv.height / 2;
    var r = Math.min(radius, Math.min(hw, hh));
    for (var y = 0; y < cv.height; y++) {
      for (var x = 0; x < cv.width; x++) {
        var px = x + 0.5 - cx0, py = y + 0.5 - cy0;
        var qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
        var sd, gx, gy;
        if (qx <= 0 || qy <= 0) {
          sd = Math.max(qx, qy) - r;
          var alongX = qy <= qx ? 1 : 0;
          gx = Math.sign(px) * alongX;
          gy = Math.sign(py) * (1 - alongX);
        } else {
          var an = Math.pow(qx, n) + Math.pow(qy, n);
          sd = Math.pow(an, 1 / n) - r;
          var vx = Math.pow(qx, n - 1), vy = Math.pow(qy, n - 1);
          var vl = Math.hypot(vx, vy) || 1;
          gx = Math.sign(px) * vx / vl;
          gy = Math.sign(py) * vy / vl;
        }
        var dx = 0, dy = 0;
        if (sd < 0 && -sd < height) {
          var u = 1 - (-sd) / height;
          var disp = (1 - Math.sqrt(Math.max(0, 1 - u * u))) * amount;
          /* Same as the shader: the edge normal plus a pull towards the
           * centre, so the bend is not purely perpendicular at the corners. */
          var cl = Math.hypot(px, py) || 1;
          var ex = gx + px / cl, ey = gy + py / cl;
          var el = Math.hypot(ex, ey) || 1;
          /* Dispersion is weighted by (x*y)/(hw*hh), exactly as the shader
           * does it: zero along both axes, strongest at the corners. chan is
           * +1 for red, 0 for green, -1 for blue. */
          var di = 1 + chan * FLOAT_STYLE.dispersion * (px * py) / (hw * hh);
          dx = disp * ex / el * di;
          dy = disp * ey / el * di;
        }
        var i = (y * cv.width + x) * 4;
        d[i] = Math.max(0, Math.min(255, Math.round(128 + 127 * dx / enc)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round(128 + 127 * dy / enc)));
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  /* A floating card is read, not looked through. The panels are clear because
   * their backdrop is a wallpaper; a card sits on cards and text, and at this
   * clarity its own text does not survive. So this one is frosted. */
  /* Legibility comes from the blur alone. Darkening was tried and is not
   * needed once the backdrop is soft: the colour stays the app's, which is the
   * point of glass, and the card does not turn into a grey plate. darken is
   * kept at 1 rather than removed because it is the knob to reach for if a
   * light theme ever makes this unreadable again.
   *
   * Dispersion is far weaker here than on the panels. The lens is the same but
   * the surface is not: a context menu is 88px tall, so a band that is a hair
   * on a column covers a third of it, and three taps at full strength put a
   * rainbow right round the edge. */
  var FLOAT_STYLE = { blur: 2, saturation: 1.15, dispersion: 0.2, darken: 1 };

  function lensFilter(w, h, radius) {
    var n = DEFAULTS.superness;
    /* Same scaling the draw pass uses: a full-size lens on a small card is not
     * a lens, it is the whole card. */
    var s = Math.min(1, Math.min(w, h) / 96);
    var height = DEFAULTS.height * s, amount = DEFAULTS.amount * s;
    var key = [w | 0, h | 0, radius.toFixed(1), n, height.toFixed(1), amount.toFixed(1),
               FLOAT_STYLE.dispersion, FLOAT_STYLE.blur, FLOAT_STYLE.saturation,
               FLOAT_STYLE.darken].join('_');
    if (lensFilters[key]) return lensFilters[key];

    var svg = document.getElementById('liquify-lg-filters');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'liquify-lg-filters';
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
      document.body.appendChild(svg);
    }
    var id = 'lg-lens-' + key.replace(/[^a-z0-9]/gi, '');

    /* One encode scale for all three maps, and therefore one `scale` on every
     * feDisplacementMap. Giving each channel its own scale is the obvious way
     * to do dispersion and it does not work: in Chromium the scale feeds the
     * primitive subregion, so the channels come out offset from each other
     * across the whole element rather than only where the map bends. The
     * per-channel strength is baked into the maps instead. */
    var enc = amount * (1 + FLOAT_STYLE.dispersion);
    var chans = [
      { name: 'R', chan: 1, keep: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0' },
      { name: 'G', chan: 0, keep: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0' },
      { name: 'B', chan: -1, keep: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0' },
    ];
    var pad = Math.ceil(enc) + 4;
    var parts = '<feGaussianBlur in="SourceGraphic" stdDeviation="' +
                FLOAT_STYLE.blur + '" result="lgblur"/>';
    for (var c = 0; c < chans.length; c++) {
      var ch = chans[c];
      var url = lensMapURL(w, h, radius, n, height, amount, enc, ch.chan, pad);
      parts +=
        '<feImage href="' + url + '" x="' + (-pad) + '" y="' + (-pad) +
        '" width="' + (w + 2 * pad) + '" height="' + (h + 2 * pad) +
        '" result="map' + ch.name + '"/>' +
        '<feDisplacementMap in="lgblur" in2="map' + ch.name + '" scale="' + (2 * enc) +
        '" xChannelSelector="R" yChannelSelector="G" result="bent' + ch.name + '"/>' +
        '<feColorMatrix in="bent' + ch.name + '" type="matrix" values="' + ch.keep +
        '" result="only' + ch.name + '"/>';
    }
    /* Added, not composited: each pass carries one channel and full alpha, so
     * arithmetic k2 = k3 = 1 puts them back together. Alpha saturates at 1. */
    parts +=
      '<feComposite in="onlyR" in2="onlyG" operator="arithmetic" k2="1" k3="1" result="lgrg"/>' +
      '<feComposite in="lgrg" in2="onlyB" operator="arithmetic" k2="1" k3="1" result="lgrgb"/>' +
      '<feColorMatrix in="lgrgb" type="saturate" values="' + FLOAT_STYLE.saturation +
      '" result="lgsat"/>' +
      '<feColorMatrix in="lgsat" type="matrix" values="' +
      [FLOAT_STYLE.darken, 0, 0, 0, 0,
       0, FLOAT_STYLE.darken, 0, 0, 0,
       0, 0, FLOAT_STYLE.darken, 0, 0,
       0, 0, 0, 1, 0].join(' ') + '"/>';

    /* The region has to reach past the element. The lens pushes each sample
     * outward, so the pixels it wants are outside the box; with the region cut
     * to the box exactly there was nothing there to fetch and the edge came
     * back smeared instead of bent. What this admits beyond the element is
     * clipped by the squircle anyway. */
    svg.insertAdjacentHTML('beforeend',
      '<filter id="' + id + '" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"' +
      ' x="' + (-pad) + '" y="' + (-pad) + '"' +
      ' width="' + (w + 2 * pad) + '" height="' + (h + 2 * pad) + '"' +
      ' color-interpolation-filters="sRGB">' +
      parts + '</filter>');
    lensFilters[key] = id;
    return id;
  }

  var FLOAT_ATTR = 'data-liquify-lg-float';

  function clearFloat(el) {
    if (!el.hasAttribute(FLOAT_ATTR)) return;
    el.removeAttribute(FLOAT_ATTR);
    el.__lgFloat = null;
    ['--lg-ring', '--lg-rim', '--lg-rim-floor', '--lg-angle'].forEach(function (p) {
      el.style.removeProperty(p);
    });
    el.style.removeProperty('backdrop-filter');
    el.style.removeProperty('-webkit-backdrop-filter');
  }

  /* Only the cards that float over the page. A dialog stops the app and has to
   * be read, and this material is too clear for that - the settings modal came
   * out with Daily Mix tiles legible across its labels. Those keep the theme's
   * own glass. */
  function styleFloaters() {
    for (var i = 0; i < FLOATERS.length; i++) {
      var els;
      try { els = document.querySelectorAll(FLOATERS[i]); } catch (e) { continue; }
      for (var j = 0; j < els.length; j++) applyFloat(els[j]);
    }
  }

  function applyFloat(el) {
    /* Never both. A surface the shader draws already has its glass, and the
     * SVG lens on top of it refracts the same backdrop a second time: the bell
     * and the social button came out as fat blobs beside our own buttons,
     * which are the same size and were only ever drawn once. Spotify moved
     * .main-topBar-buddyFeed from the friends panel onto the button, which is
     * how a floater selector ended up matching a control. */
    if (el.hasAttribute('data-liquify-lg')) { clearFloat(el); return; }
    /* Layout size, not the painted rect. A context menu animates in with a
     * transform, so getBoundingClientRect returns whatever it is mid-scale,
     * while clip-path and the filter's user space are both measured before the
     * transform. Using the painted rect sized the lens and the clip to a frame
     * of the animation and left them short of the element. */
    var w = el.offsetWidth, h = el.offsetHeight;
    if (w < 16 || h < 16) return;
    var r = { width: w, height: h };
    var n = DEFAULTS.superness;
    var radius = Math.min(uniformRadius(), Math.min(r.width, r.height) / 2);
    var ring = Math.max(1, DEFAULTS.hlWidth);
    var key = (r.width | 0) + 'x' + (r.height | 0) + 'r' + radius.toFixed(1) +
              'n' + n + 'w' + ring + 's' + DEFAULTS.saturation;
    if (el.__lgFloat === key && el.style.clipPath) return;
    el.__lgFloat = key;

    remember(el);
    el.setAttribute(FLOAT_ATTR, '');
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var id = lensFilter(r.width, r.height, radius);
    el.style.setProperty('backdrop-filter', 'url(#' + id + ')', 'important');
    el.style.setProperty('-webkit-backdrop-filter', 'url(#' + id + ')', 'important');
    el.style.setProperty('clip-path', squirclePath(r.width, r.height, radius, n, 32));
    el.style.setProperty('--lg-ring', superRingPath(r.width, r.height, radius, n, ring, 32));
    el.style.setProperty('--lg-rim', String(DEFAULTS.hlAlpha));
    el.style.setProperty('--lg-rim-floor', String(DEFAULTS.hlFloor * DEFAULTS.hlAlpha));
    el.style.setProperty('--lg-angle', (90 - DEFAULTS.hlAngle) + 'deg');
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
      /* Nothing selector-wide. Taking the theme's blur off every element that
       * matches a target left the ones we do not draw - the carousel arrows are
       * 32px, under the size we take over - with no glass and no fill at all:
       * an icon floating on the wallpaper. Only the surfaces actually handed
       * over lose the theme's treatment. */
      /* On the surfaces we actually draw, the frame comes from the shader, so
       * every outline the theme puts on the element's own circular
       * border-radius has to go - including the ones on its pseudo elements.
       * Leaving those draws a second arc beside the superellipse: the curves
       * lie on top of each other along the straight edges and separate at the
       * corner, which is exactly the doubled corner. */
      /* One frame per surface, and it is the shader's rim. Drawing a CSS border
       * as well put ours next to the theme's on the same corner. */
      /* The panes are containers, not panels. The theme frames them, and a
       * sheet drawn just inside one puts a second outline 20px from the first,
       * which is what reads as a doubled corner in the right pane. */
      '.Root__right-sidebar,.Root__nav-bar{box-shadow:none!important;' +
      'border-color:transparent!important;}' +
      /* A floating card is refracted by an SVG lens instead of the shader, but
       * its rim is the same superellipse ring, drawn as light on top. The
       * gradient across it stands in for the shader's cos falloff: brightest
       * where the edge faces the light, never below the floor, so the frame is
       * continuous the whole way round. */
      '[data-liquify-lg-float]{border-radius:0!important;box-shadow:none!important;' +
      'border-color:transparent!important;}' +
      /* plus-lighter, because the shader adds the rim rather than laying it
       * over: alpha-blended white on a dark card reads as grey paint, and that
       * is why the overlay's edge did not look like the panels'. */
      '[data-liquify-lg-float]::after{content:"";position:absolute;inset:0;' +
      'pointer-events:none;z-index:2;clip-path:var(--lg-ring);' +
      'mix-blend-mode:plus-lighter;' +
      'background:linear-gradient(var(--lg-angle),' +
      'rgba(255,255,255,var(--lg-rim)) 0%,' +
      'rgba(255,255,255,var(--lg-rim-floor)) 50%,' +
      'rgba(255,255,255,var(--lg-rim)) 100%);}' +
      /* The pane header strip sits ~20px inside the pane's own frame and the
       * theme outlines both, so the corner reads as two lines. The strip is the
       * one you actually look at, so the pane's frame is the one that goes. */
      '.Root__right-sidebar > *:first-child{box-shadow:none!important;' +
      'border-color:transparent!important;}' +
      /* No border of ours. Adding one put a second outline on every surface -
       * the glass is the effect, the frame is not ours to draw. */
      /* The element's own fill has to go, or it sits on top of the sheet and
       * hides it - the shortcut tiles were painted over by their own background
       * while the container behind them showed through fine. Only surfaces we
       * draw lose it; the small controls we leave alone keep theirs, since for
       * them the fill is the whole button. */
      '[data-liquify-lg]{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;' +
      'background-color:transparent!important;background-image:none!important;' +
      'border-color:transparent!important;box-shadow:none!important;' +
      'outline:none!important;background-image:none!important;' +
      'background-color:transparent!important;}' +
      '[data-liquify-lg]::before,[data-liquify-lg]::after{box-shadow:none!important;' +
      'border-color:transparent!important;background:none!important;}' +
      /* the canvas draws the wallpaper, so the theme's own layers would double it */
      'html.liquify-lg-wall .liquify-bg-layer,' +
      'html.liquify-lg-wall .liquify-animated-bg{display:none!important;}' +
      /* The lens bends the wallpaper's detail, so the wallpaper must not be
       * pre-blurred. This belongs here rather than in the theme's CSS: with it
       * in user.css the toggle's off state was not the untouched theme either,
       * which made any comparison meaningless. */
      ':root{--liquify-bg-blur:0px!important;}' +
      /* Full screen is not full screen: the right sidebar stays up at z-index 4
       * (420x879 next to a 1584-wide cinema panel) and the now-playing rows sit
       * under it. Nothing there is reachable while the cover is up, so take the
       * whole column out for as long as it lasts. */
      'html.liquify-cinema .Root__right-sidebar{display:none!important;}' +
      /* The bars fade on Spotify's timer, but the theme's border on them does
       * not, so an empty frame hangs there after the contents have gone. */
      'html.liquify-cinema .Root__now-playing-bar,html.liquify-cinema .Root__globalNav{' +
      'border-color:transparent!important;box-shadow:none!important;background:none!important;}';
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
      /* The toggle has to put back what the theme would have looked like, so
       * everything this pass wrote inline goes with the attribute. Leaving the
       * clip and the flattened radius behind made "off" a third look that was
       * neither ours nor Liquify's. */
      document.querySelectorAll('[data-liquify-lg],[data-liquify-lg-plain]').forEach(function (el) {
        el.removeAttribute('data-liquify-lg');
        el.removeAttribute('data-liquify-lg-plain');
        el.__lgRadius = null;
        restore(el);
      });
      /* Every corner the sweep clipped, put back. These are the app's own
       * boxes, not surfaces of ours, so nothing else would ever clear them. */
      swept.forEach(function (el) {
        el.__lgCorner = null;
        el.style.removeProperty('clip-path');
      });
      swept.clear();
      sweepCursor = 0;
      document.documentElement.classList.remove('liquify-lg-wall');
      document.documentElement.classList.remove('liquify-cinema');
      document.querySelectorAll('[' + FLOAT_ATTR + ']').forEach(function (el) {
        el.removeAttribute(FLOAT_ATTR);
        el.__lgFloat = null;
        ['--lg-ring', '--lg-rim', '--lg-rim-floor', '--lg-angle'].forEach(function (p) {
          el.style.removeProperty(p);
        });
        restore(el);
      });
    }
    if (!quiet) flash(enabled ? 'liquid glass: ON' : 'liquid glass: OFF (Liquify 標準)');
    /* The backdrop is rebuilt on the way back in. It is only refreshed on a
     * track change or a resize, and both can happen while this is off - the
     * window was resized with the toggle down and every surface came back
     * drawing a texture that no longer matched, which looks exactly like
     * nothing being drawn at all. It also puts back the wall class, which
     * turning off removes. */
    if (enabled) { rescan(); refreshBackdrop(); render(true); }
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
      /* Only boxes that hard-clip. A scroller's rect is not where its content
       * visually ends - the browser already draws the element where it draws
       * it, and cutting again at the scroller's edge slices the sheet across
       * the middle of a panel while its text carries on below. */
      var o = cs.overflow + cs.overflowX + cs.overflowY;
      if (o.indexOf('hidden') >= 0 || o.indexOf('clip') >= 0) return q;
      if (q === document.documentElement) break;
    }
    return null;
  }

  /* The selector list is what the theme *declares*; what it actually paints can
   * differ. Sweep for anything still carrying the theme's bulk filter and take
   * the blur off it, if it is big enough that glass was the point. Small
   * controls keep theirs - it is the only thing making them visible. */
  var swept = new Set();

  /* Every rounded corner in the app, not just the glass. A superellipse next
   * to a circular arc at the same radius reads as two different shapes, and
   * the app is full of both. Circles are left alone - an avatar is meant to be
   * a circle, not a squircle.
   *
   * Only boxes that actually paint at their corner. A transparent layout
   * wrapper has no arc to correct, so a clip on it can only take content away -
   * and it did: three wrappers around the now-playing cover kept a polygon from
   * when they were 280 wide and cut 108px off the artwork.
   *
   * Whatever gets a clip is remembered, so a box that stops qualifying - lost
   * its radius, its fill, or got too small - has the clip taken off again
   * rather than keeping a stale one for good.
   *
   * A slice at a time. The tree is 5600 elements and reading a computed style
   * for each of them is 14ms; doing that in one go is a stall you can see. The
   * cursor carries over, so the whole tree is still covered, just spread out.
   *
   * There used to be a first pass over the same 4000 elements that read every
   * rect and every style and then did nothing - the body was comments. It cost
   * the same 14ms for no effect at all. */
  var SWEEP_BUDGET = 900;
  var sweepCursor = 0;

  function sweepThemeGlass() {
    var all = document.querySelectorAll('.Root__top-container *');
    if (sweepCursor >= all.length) sweepCursor = 0;
    var end = Math.min(all.length, sweepCursor + SWEEP_BUDGET);

    for (var i = sweepCursor; i < end; i++) {
      var el = all[i];
      var keep = false, key2 = null, rad = 0, r2 = null;
      r2 = el.getBoundingClientRect();
      if (r2.width >= 16 && r2.height >= 16) {
        var cs2 = getComputedStyle(el);
        rad = parseFloat(cs2.borderTopLeftRadius);
        keep = !isNaN(rad) && rad >= 6 &&
          cs2.borderTopLeftRadius === cs2.borderBottomRightRadius &&
          rad < Math.min(r2.width, r2.height) / 2 - 0.5 &&    // not a circle
          paintsAtItsCorner(cs2);
        if (keep) key2 = (r2.width | 0) + 'x' + (r2.height | 0) + 'r' + (rad | 0);
      }
      if (keep) {
        swept.add(el);
        if (el.__lgCorner === key2 && el.style.clipPath) continue;
        el.__lgCorner = key2;
        el.style.clipPath = squirclePath(r2.width, r2.height, rad, DEFAULTS.superness);
      } else if (swept.has(el)) {
        swept.delete(el);
        el.__lgCorner = null;
        el.style.removeProperty('clip-path');
      }
    }

    sweepCursor = end;
    if (sweepCursor >= all.length) {
      // one full lap done: drop anything that has left the document
      swept.forEach(function (el) { if (!el.isConnected) swept.delete(el); });
    }
  }

  /* A box only needs its corner corrected if something is drawn there. With no
   * fill, no border and no shadow the arc is invisible and a clip can only cut
   * content out of the box. */
  function paintsAtItsCorner(cs) {
    var bg = cs.backgroundColor || '';
    var opaque = bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(bg);
    return opaque ||
      (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      parseFloat(cs.borderTopWidth) > 0 ||
      (cs.boxShadow && cs.boxShadow !== 'none');
  }

  function rescan() {
    /* Nothing runs while the toggle is off. The corner sweep kept going and
     * kept clipping the app's boxes to superellipses, so "off" was Liquify
     * with our corners on it - not the theme, and not a comparison worth
     * anything. */
    if (!enabled) return;
    var out = [];
    for (var i = 0; i < TARGETS.length && out.length < MAX_ELEMENTS; i++) {
      var t = TARGETS[i];
      var els;
      try { els = document.querySelectorAll(t.selector); } catch (e) { continue; }
      for (var j = 0; j < els.length && out.length < MAX_ELEMENTS; j++) {
        var el = els[j];
        /* A selector broad enough to catch every shelf card also catches the
         * library rows, which are rows and not cards: a frame around each of
         * their covers turns the left pane into a grid of boxes. */
        if (t.notInside && el.closest(t.notInside)) continue;
        var cs = getComputedStyle(el);
        /* A surface pinned inside a scroller has the list passing underneath
         * it, and the canvas only knows the wallpaper - it would blur a static
         * image while the real content slides past. Those keep the theme's own
         * backdrop-filter, which reads the actual backdrop. Surfaces that
         * scroll along with their backdrop are fine. */
        /* Pinned surfaces are drawn too. Dropping them was meant to stop a
         * frosted sheet blurring a still wallpaper while a list slid under it,
         * but the default material does not blur, and skipping them took most
         * of the app's panels out with them. */
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
    /* Nesting is kept. Dropping descendants was meant to stop the material
     * stacking, but that haze turned out to be a texture unit left bound, and
     * the filter was quietly taking two thirds of the app's panels with it. */
    matched = out;
    sweepThemeGlass();
    collectScrollNodes();
    sig = '';       // force one redraw after a rescan
    dirty = true;
  }

  var sig = '';
  var dirty = true;
  var wasCinema = false;

  /* Idle frames must cost nothing. getBoundingClientRect on every matched
   * element forces layout, so it only runs when something could have moved:
   * a scroll, a resize, a rescan, or the slow safety tick. */
  function markDirty() { dirty = true; }

  /* Rescanning is the expensive thing in this extension, not drawing. It runs
   * ~90 selectors over a 5600-element tree and reads a computed style for
   * every hit: 68ms. On a 400ms interval that is a stall four times every two
   * seconds, and landing one on top of a scrolling frame is what the stutter
   * actually was - the frames themselves were 15ms.
   *
   * So it waits for a gap. Never during a scroll, never while the toggle is
   * off, and through requestIdleCallback so it takes a frame the compositor
   * was not using. The timeout keeps it honest if the app never goes idle. */
  var lastScroll = 0;
  var rescanTimer = null;

  function scheduleRescan(delay) {
    if (rescanTimer) return;
    rescanTimer = setTimeout(function () {
      rescanTimer = null;
      var run = function () {
        if (enabled && performance.now() - lastScroll > 200) rescan();
        scheduleRescan();
      };
      if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 600 });
      else run();
    }, delay || 400);
  }

  /* Liquify writes its glass onto the elements themselves, inline. Taking a
   * surface over means overwriting that, and letting it go used to mean
   * removeProperty - which deletes the theme's value, not ours. Turning the
   * toggle off then left the app with no glass at all: neither this nor
   * Liquify, which is exactly what "off" must not be.
   *
   * So the inline declarations are copied before the first write and put back
   * verbatim, priority included. */
  var TAKEOVER_PROPS = [
    'backdrop-filter', '-webkit-backdrop-filter', 'box-shadow', 'border-color',
    'border-radius', 'clip-path', 'position', 'background-color', 'background-image',
  ];

  function remember(el) {
    if (el.__lgPrev) return;
    var prev = {};
    for (var i = 0; i < TAKEOVER_PROPS.length; i++) {
      var p = TAKEOVER_PROPS[i];
      prev[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    }
    el.__lgPrev = prev;
  }

  function restore(el) {
    var prev = el.__lgPrev;
    if (!prev) return;
    el.__lgPrev = null;
    for (var i = 0; i < TAKEOVER_PROPS.length; i++) {
      var p = TAKEOVER_PROPS[i];
      el.style.removeProperty(p);
      if (prev[p] && prev[p][0]) el.style.setProperty(p, prev[p][0], prev[p][1]);
    }
  }

  /* One corner for the whole app, and it is whatever the knob says. Clamping
   * per element - to half its height, or to a third of it - is what stopped
   * the radius being uniform: a column kept the full curve while a shortcut
   * tile got whatever fitted, and the two read as different shapes side by
   * side. Clamping globally instead just took the knob away.
   *
   * Past half the shortest surface's height the corner has nowhere left to go
   * and that surface becomes a pill - a 48px shortcut tile does this at 24 and
   * its artwork, flush in the corner, goes with it. That is the cost of one
   * radius for everything, and it belongs to whoever is turning the knob. */
  function uniformRadius() {
    return DEFAULTS.cornerRadius * DEFAULTS.radiusScale;
  }

  function drawCinema(el) {
    var dpr = window.devicePixelRatio || 1;
    var W = Math.round(window.innerWidth * dpr);
    var H = Math.round(window.innerHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    if (!el.hasAttribute('data-liquify-lg')) {
      remember(el);
      el.setAttribute('data-liquify-lg', '');
      el.style.setProperty('box-shadow', 'none', 'important');
      el.style.setProperty('border-color', 'transparent', 'important');
    }
    var radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20;
    radius = Math.min(radius, Math.min(r.width, r.height) / 2);

    renderer.begin();
    renderer.scissor(null);
    var rect = {
      x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr,
      r: radius * dpr
    };
    renderer.draw(rect, Object.assign({}, DEFAULTS, CINEMA_STYLE, {
      height: DEFAULTS.height * dpr,
      amount: DEFAULTS.amount * dpr,
      hlWidth: DEFAULTS.hlWidth * dpr
    }));
    renderer.end();
    drawn = 1;
  }

  function drop(m) {
    /* A surface we match but do not draw still has to lose the theme's blur if
     * it is big enough to have been ours - otherwise half the sections are
     * clear and half are frosted. Small controls keep their glass: it is the
     * only thing making them visible. */
    /* Whatever we do not draw keeps the theme's glass. Marking it plain took
     * the theme's backdrop-filter away without putting anything in its place,
     * and the shortcut tiles ended up with no outline at all. */
    if (m.el.hasAttribute && m.el.hasAttribute('data-liquify-lg-plain')) {
      m.el.removeAttribute('data-liquify-lg-plain');
      restore(m.el);
    }
    if (m.el.hasAttribute && m.el.hasAttribute('data-liquify-lg')) {
      m.el.removeAttribute('data-liquify-lg');
      m.el.__lgRadius = null;
      restore(m.el);
      /* Corners are owned by the sweep, not by the draw pass. Clearing the
       * clip here fought it: the sheet lost its superellipse every frame it
       * was not drawn and got it back on the next sweep. */
    }
  }

  /* A control whose contents are all transparent is waiting for a hover. The
   * shelves' carousel arrows are like this: the button is there at full
   * opacity, the arrow inside it is not, so drawing its frame left an empty
   * glass box sitting at the edge of every shelf. Only small surfaces are
   * checked - a panel is not hidden just because its children happen to be. */
  function contentIsHidden(el) {
    var kids = el.querySelectorAll('*');
    if (!kids.length) return false;
    for (var i = 0; i < kids.length && i < 8; i++) {
      if (+getComputedStyle(kids[i]).opacity > 0.02) return false;
    }
    return true;
  }

  /* Opacity multiplies down the tree, and the canvas is outside that tree. A
   * shelf's carousel arrow is a fully opaque button inside a group that is
   * faded to nothing until the pointer arrives, so reading the element's own
   * opacity said "visible" while the screen showed nothing but our frame. */
  /* Memoised for the frame. Every surface shares most of its ancestors with
   * every other one, so walking each chain independently read the same nodes
   * over and over: 270 surfaces turned into nearly three thousand style reads
   * and 13.9ms of the frame, which was most of the reason scrolling stuttered.
   * Now each node is read once and the chains meet in the cache. */
  var opCache = null;

  function effectiveOpacity(el) {
    var chain = [], o = null;
    for (var a = el, i = 0; a && i < 14; a = a.parentElement, i++) {
      if (opCache && opCache.has(a)) { o = opCache.get(a); break; }
      chain.push(a);
      if (a.classList && a.classList.contains('Root__top-container')) break;
    }
    if (o === null) o = 1;
    for (var j = chain.length - 1; j >= 0; j--) {
      var cs = getComputedStyle(chain[j]);
      var v = (cs.display === 'none' || cs.visibility === 'hidden')
        ? 0 : o * +cs.opacity;
      if (opCache) opCache.set(chain[j], v);
      o = v;
      if (o <= 0.02) {
        /* Nothing below a dead node can be visible either, so the rest of the
         * chain is settled without reading it. */
        for (var k = j - 1; k >= 0; k--) if (opCache) opCache.set(chain[k], 0);
        return 0;
      }
    }
    return o;
  }

  /* Full screen fills the window with Spotify's own layout. Drawing the usual
   * set on top of it covered everything; drawing nothing left it plain. What it
   * wants is one sheet of glass: the cinema panel itself, and nothing else. */
  function cinemaPanel() {
    var c = document.querySelector('.Root__cinema-view');
    if (!c) return null;
    var r = c.getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? c : null;
  }

  function render(force) {
    if (!renderer) return;

    var cinema = cinemaPanel();
    if (cinema !== null) {
      if (!wasCinema) {
        wasCinema = true;
        document.documentElement.classList.add('liquify-cinema');
        document.querySelectorAll('[data-liquify-lg],[data-liquify-lg-plain]').forEach(function (el) {
          if (el === cinema) return;
          el.removeAttribute('data-liquify-lg');
          el.removeAttribute('data-liquify-lg-plain');
          el.style.removeProperty('box-shadow');
          el.style.removeProperty('border-color');
        });
        force = true;
      }
      if (canvas.style.display === 'none' && enabled) canvas.style.display = '';
      drawCinema(cinema);
      return;
    }
    if (wasCinema) {
      wasCinema = false;
      document.documentElement.classList.remove('liquify-cinema');
      rescan();
      force = true;
    }
    if (!force && !dirty) return;
    dirty = false;
    /* One cache per frame. Styles can change between frames, so it cannot
     * outlive this pass. */
    opCache = new Map();
    /* Floaters come and go with a click, so this rides the same dirty flag the
     * draw pass does rather than waiting for the next rescan. */
    styleFloaters();
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
      /* Read opacity every frame, not from the 400ms cache. Full screen fades
       * the top bar and the playbar out on their own timers; drawing from a
       * stale flag leaves the glass frame hanging there after its element has
       * gone, and the two bars drop at different moments. */
      var op = effectiveOpacity(m.el);
      if (!(op > 0.02)) { drop(m); continue; }
      var r = m.el.getBoundingClientRect();
      if (Math.max(r.width, r.height) <= 64 && contentIsHidden(m.el)) { drop(m); continue; }
      if (Math.min(r.width, r.height) < MIN_GLASS_SIZE ||
          r.bottom <= 0 || r.top >= window.innerHeight ||
          r.right <= 0 || r.left >= window.innerWidth) { drop(m); continue; }
      /* Recomputed every frame. The cached one goes stale as soon as anything
       * reflows, and a stale clip is the same as no clip: the sheet is drawn
       * past the top of the scroller and down over the playbar. */
      var sc = scrollClipOf(m.el);
      var c = sc ? sc.getBoundingClientRect() : null;
      if (c && (r.right <= c.left || r.left >= c.right ||
                r.bottom <= c.top || r.top >= c.bottom)) { drop(m); continue; }
      list.push({ m: m, r: r, c: c, op: op });
      s2 += '|' + (r.left | 0) + ',' + (r.top | 0) + ',' + (r.width | 0) + ',' + (r.height | 0) +
            ',' + op.toFixed(2);
    }
    if (!force && !resized && s2 === sig) return;
    sig = s2;

    renderer.begin();
    drawn = 0;
    for (i = 0; i < list.length; i++) {
      var it = list[i], mm = it.m, rr = it.r;
      if (!mm.el.hasAttribute('data-liquify-lg')) {
        /* If the float pass got here first, take its treatment off. The draw
         * pass wins: it knows this surface's backdrop, which is what the whole
         * shader path is for. */
        clearFloat(mm.el);
        remember(mm.el);
        mm.el.setAttribute('data-liquify-lg', '');
        /* Some of these carry their outline with !important from the theme's
         * own stylesheet, which a stylesheet rule cannot beat. Inline
         * !important can. The search field is the one that needs it. */
        mm.el.style.setProperty('backdrop-filter', 'none', 'important');
        mm.el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        mm.el.style.setProperty('box-shadow', 'none', 'important');

      }
      drawn++;

      var minDim = Math.min(rr.width, rr.height);
      /* Same radius the sweep clips to. Leaving the shader on the element's own
       * radius put the sheet's edge inside or outside the clipped corner, and
       * the frame disappeared where they disagreed. */
      var radius = uniformRadius();
      /* Whatever sits in the corner has to be cut on the same curve the shader
       * draws. border-radius cannot do that: at the same number it is a
       * circular arc, which bites deeper than the superellipse and leaves the
       * artwork's corner visibly rounder than the frame around it. So the
       * radius goes to zero and clip-path carries the shape.
       *
       * This only clips content now - the element's own fill, border and
       * shadow are already stripped - so the polygon is not drawn next to the
       * rim and cannot double it. */
      var clipKey = (rr.width | 0) + 'x' + (rr.height | 0) + 'r' + radius.toFixed(1) +
                    'n' + DEFAULTS.superness;
      /* The inline style is checked, not just the cached key. Spotify rebuilds
       * a tile's style attribute on its own - a hover, a re-render - and takes
       * the clip with it, which is why some covers were cut to the corner and
       * some were left square until something touched them again. */
      if (mm.el.__lgRadius !== clipKey || !mm.el.style.clipPath) {
        mm.el.__lgRadius = clipKey;
        mm.el.style.setProperty('border-radius', '0', 'important');
        mm.el.style.setProperty('clip-path',
          squirclePath(rr.width, rr.height, radius, DEFAULTS.superness, 32));
      }
      /* No clip-path. The element is transparent and the frame is drawn by the
       * shader, so clipping buys nothing - and the polygon approximates the
       * superellipse with 16 straight segments per corner, which does not lie
       * exactly on the shader's smooth SDF. The two curves a pixel apart are
       * the doubled corner. */

      // a full-size lens on a small chip looks wrong; scale it to what fits
      var scale = Math.min(1, minDim / 96);
      var rect = {
        x: rr.left * dpr, y: rr.top * dpr, w: rr.width * dpr, h: rr.height * dpr,
        r: radius * dpr
      };

      /* Clip to the parent surface as well as to the scroller. A section drawn
       * inside another panel has a rim of its own, and without this it is drawn
       * past the parent's edge - the frame pokes out through its container. */
      var clipBox = it.c;
      var ancestors = [];
      for (var a = mm.el.parentElement; a; a = a.parentElement) {
        ancestors.push(a);
        if (a.classList && a.classList.contains('Root__top-container')) break;
      }
      for (var p2 = 0; p2 < ancestors.length; p2++) {
        var anc = ancestors[p2];
        var acs = getComputedStyle(anc);
        // only boxes that actually bound their children visually
        var bounds = acs.overflow !== 'visible' || acs.overflowX !== 'visible' ||
                     acs.overflowY !== 'visible' ||
                     parseFloat(acs.borderTopWidth) > 0 ||
                     (acs.boxShadow && acs.boxShadow !== 'none') ||
                     anc.hasAttribute('data-liquify-lg');
        if (!bounds) continue;
        var q = anc.getBoundingClientRect();
        if (q.width < 4 || q.height < 4) continue;
        clipBox = clipBox ? {
          left: Math.max(clipBox.left, q.left), top: Math.max(clipBox.top, q.top),
          right: Math.min(clipBox.right, q.right), bottom: Math.min(clipBox.bottom, q.bottom),
        } : q;
        clipBox = {
          left: clipBox.left, top: clipBox.top,
          right: clipBox.right, bottom: clipBox.bottom,
          width: clipBox.right - clipBox.left, height: clipBox.bottom - clipBox.top,
        };
      }
      it.c = clipBox;

      // glass must not spill out of the box that scrolls it
      renderer.scissor(it.c ? {
        x: it.c.left * dpr, y: it.c.top * dpr, w: it.c.width * dpr, h: it.c.height * dpr
      } : null);

      var opts = Object.assign({}, DEFAULTS, {
        opacity: it.op,
        height: DEFAULTS.height * scale * dpr,
        amount: DEFAULTS.amount * scale * dpr,
        hlWidth: DEFAULTS.hlWidth * dpr,
        dispersion: mm.t.ca ? DEFAULTS.dispersion : 0
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
    opCache = null;
  }

  /* Everything else in view keeps a circular border-radius, which reads as a
   * different corner sitting next to the superellipse ones. Give the rounded
   * children the same curve. Only inside surfaces we drew, only above a radius
   * where the difference is visible, and re-applied when the size changes. */
  var CORNER_MIN = 8;

  function roundChildren(host, n) {
    var kids = host.querySelectorAll('*');
    for (var i = 0; i < kids.length && i < 60; i++) {
      var k = kids[i];
      if (k.hasAttribute('data-liquify-lg')) continue;
      var cs = getComputedStyle(k);
      var r = parseFloat(cs.borderTopLeftRadius);
      if (isNaN(r) || r < CORNER_MIN) continue;
      if (cs.borderTopLeftRadius !== cs.borderBottomRightRadius) continue;   // pills, circles
      var rect = k.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      if (r >= Math.min(rect.width, rect.height) / 2 - 0.5) continue;        // fully round
      var key = (rect.width | 0) + 'x' + (rect.height | 0) + 'r' + (r | 0) + 'n' + n;
      if (k.__lgCorner === key) continue;
      k.__lgCorner = key;
      k.style.clipPath = squirclePath(rect.width, rect.height, r, n);
    }
  }

  /* Scroll position is read here rather than waited for.
   *
   * Spotify's panes scroll on the compositor, so the content has already moved
   * by the time the scroll event reaches this thread: measured, the event that
   * precedes a frame arrives a median of 19.9ms before it - more than a frame.
   * Marking dirty from the event and drawing on the next rAF therefore always
   * drew the previous frame's position, and the glass trailed its own panel.
   *
   * scrollTop on a handful of scrollers is a few property reads, and it is the
   * value the compositor is showing right now, so the frame that notices the
   * movement is the frame that draws it. The event listener stays for the
   * cases this misses - a scroller that appears mid-gesture, a nested one. */
  var scrollNodes = [];
  var scrollSig = '';

  function collectScrollNodes() {
    scrollNodes = [];
    var roots = document.querySelectorAll(
      '.Root__main-view, .Root__nav-bar, .Root__right-sidebar');
    for (var i = 0; i < roots.length; i++) {
      var inner = roots[i].querySelectorAll('*');
      for (var j = 0; j < inner.length && scrollNodes.length < 12; j++) {
        var e = inner[j];
        if (e.scrollHeight > e.clientHeight + 8 && e.clientHeight > 120) {
          scrollNodes.push(e);
          break;                       // the pane's own scroller, not its rows
        }
      }
    }
  }

  function loop() {
    if (enabled) {
      var s = '';
      for (var i = 0; i < scrollNodes.length; i++) {
        var n = scrollNodes[i];
        if (!n.isConnected) { collectScrollNodes(); break; }
        s += n.scrollTop + ',' + n.scrollLeft + '|';
      }
      if (s !== scrollSig) { scrollSig = s; dirty = true; }
      render(false);
    }
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
        /* No cover yet: the theme's own background layer has a gradient for
         * exactly this case, so let it show rather than covering the window
         * with a flat fill. */
        document.documentElement.classList.remove('liquify-lg-wall');
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
      document.documentElement.classList.add('liquify-lg-wall');
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
    collectScrollNodes();
    scheduleRescan();

    // anything that can move a surface without a rescan
    window.addEventListener('scroll', function () {
      lastScroll = performance.now();
      dirty = true;
    }, { capture: true, passive: true });
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
      count: function () {
        return { matched: matched.length, drawn: drawn, scrollers: scrollNodes.length };
      },
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
