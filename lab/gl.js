/* Liquid glass in WebGL2.
 *
 * Copyright (c) 2026 nemut.ai. Licensed under the GNU Affero General Public
 * License v3.0; see LICENSE.
 *
 * The ported shader bodies are from Backdrop:
 *
 *   https://github.com/Kyant0/AndroidLiquidGlass
 *   Copyright 2025 Kyant
 *   Licensed under the Apache License, Version 2.0.
 *   A copy is in licenses/Apache-2.0-Backdrop.txt.
 *
 * Changed from that original: written in GLSL rather than AGSL, and the corner
 * is a superellipse rather than a circular arc.
 *
 * The shaders below are a port of Kyant0/AndroidLiquidGlass (Backdrop),
 * Apache-2.0, from AGSL. AGSL is GLSL with different scalar names, so the
 * refraction, dispersion and highlight bodies are kept line for line:
 *
 *   half4 -> vec4, float2 -> vec2, float4 -> vec4
 *   content.eval(coord) -> texture(uBackdrop, coord / uSize)
 *
 * This runs instead of the backdrop-filter route because the backdrop here is a
 * known image. Nothing has to be read back from the compositor, so there is no
 * reason to squeeze the maths through 8-bit displacement maps.
 */
(function (global) {
  'use strict';

  var VERT = `#version 300 es
in vec2 aPos;
out vec2 vPix;
uniform vec2 uCanvas;   // canvas size in device px
uniform vec4 uRect;     // x, y, w, h of the quad in device px
void main() {
  vec2 pix = uRect.xy + aPos * uRect.zw;
  vPix = pix;
  vec2 clip = (pix / uCanvas) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

  /* --- ported from Backdrop's RoundedRectSDF ----------------------------- */
  var SDF = `
float radiusAt(vec2 coord, vec4 radii) {
  if (coord.x >= 0.0) {
    if (coord.y <= 0.0) return radii.y;
    else return radii.z;
  } else {
    if (coord.y <= 0.0) return radii.x;
    else return radii.w;
  }
}

// superness == 2.0 reproduces Backdrop's circular corners exactly; higher
// values give the continuous-curvature corner Apple uses. The Lp norm is not a
// distance, so it is divided by its gradient magnitude - exact at the boundary.
float sdRoundedRect(vec2 coord, vec2 halfSize, float radius, float n) {
  vec2 q = abs(coord) - (halfSize - vec2(radius));
  if (q.x <= 0.0 || q.y <= 0.0) return max(q.x, q.y) - radius;
  if (n <= 2.001) return length(q) - radius;
  float an = pow(q.x, n) + pow(q.y, n);
  float f = pow(an, 1.0 / n) - radius;
  vec2 gv = vec2(pow(q.x, n - 1.0), pow(q.y, n - 1.0));
  float gl = length(gv) / pow(an, (n - 1.0) / n);
  return gl < 1e-6 ? f : f / gl;
}

vec2 gradSdRoundedRect(vec2 coord, vec2 halfSize, float radius, float n) {
  vec2 q = abs(coord) - (halfSize - vec2(radius));
  if (q.x >= 0.0 && q.y >= 0.0) {
    vec2 gv = (n <= 2.001) ? q : vec2(pow(q.x, n - 1.0), pow(q.y, n - 1.0));
    return sign(coord) * normalize(max(gv, 1e-6));
  } else {
    float gradX = step(q.y, q.x);
    return sign(coord) * vec2(gradX, 1.0 - gradX);
  }
}

float circleMap(float x) { return 1.0 - sqrt(1.0 - x * x); }
`;

  var FRAG = `#version 300 es
precision highp float;
in vec2 vPix;
out vec4 outColor;

uniform sampler2D uBackdrop;
uniform vec2 uCanvas;
uniform vec4 uRect;           // element box in device px
uniform vec4 uRadii;          // tl, tr, br, bl
uniform float uSuperness;
uniform float uRefractionHeight;
uniform float uRefractionAmount;   // negative = inward, as Backdrop passes it
uniform float uDepthEffect;
uniform float uDispersion;

uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;

uniform vec4 uSurface;        // body tint, straight alpha
uniform vec4 uHighlight;      // rgb + alpha
uniform float uHlAngle;
uniform float uHlFalloff;
uniform float uHlWidth;

${SDF}

vec4 sampleBackdrop(vec2 pix) {
  return texture(uBackdrop, pix / uCanvas);
}

// Backdrop's colorControlsColorFilter: saturation, contrast about 0.5, then an
// additive brightness.
vec3 colorControls(vec3 c) {
  float invSat = 1.0 - uSaturation;
  float r = 0.213 * invSat, g = 0.715 * invSat, b = 0.072 * invSat;
  float k = uContrast, s = uSaturation;
  float t = 0.5 - k * 0.5 + uBrightness;
  vec3 o;
  o.r = k * ((r + s) * c.r + g * c.g + b * c.b) + t;
  o.g = k * (r * c.r + (g + s) * c.g + b * c.b) + t;
  o.b = k * (r * c.r + g * c.g + (b + s) * c.b) + t;
  return o;
}

void main() {
  vec2 halfSize = uRect.zw * 0.5;
  vec2 coord = vPix - uRect.xy;                 // element-local
  vec2 centered = coord - halfSize;
  float radius = radiusAt(centered, uRadii);

  float sd = sdRoundedRect(centered, halfSize, radius, uSuperness);
  if (sd > 0.0) { outColor = vec4(0.0); return; }   // outside the shape

  // --- lens -------------------------------------------------------------
  vec2 refracted = vPix;
  vec2 dispersed = vec2(0.0);
  if (-sd < uRefractionHeight) {
    float d = circleMap(1.0 - (-sd) / uRefractionHeight) * uRefractionAmount;
    float gradRadius = min(radius * 1.5, min(halfSize.x, halfSize.y));
    vec2 grad = normalize(
      gradSdRoundedRect(centered, halfSize, gradRadius, uSuperness) +
      uDepthEffect * normalize(centered + 1e-6));
    refracted = vPix + d * grad;
    float dispersionIntensity = uDispersion * ((centered.x * centered.y) / (halfSize.x * halfSize.y));
    dispersed = d * grad * dispersionIntensity;
  }

  vec4 color = vec4(0.0);
  if (uDispersion > 0.0) {
    // seven weighted taps, exactly as Backdrop sums them
    vec4 red    = sampleBackdrop(refracted + dispersed);
    color.r += red.r / 3.5;
    vec4 orange = sampleBackdrop(refracted + dispersed * (2.0 / 3.0));
    color.r += orange.r / 3.5; color.g += orange.g / 7.0;
    vec4 yellow = sampleBackdrop(refracted + dispersed * (1.0 / 3.0));
    color.r += yellow.r / 3.5; color.g += yellow.g / 3.5;
    vec4 green  = sampleBackdrop(refracted);
    color.g += green.g / 3.5;
    vec4 cyan   = sampleBackdrop(refracted - dispersed * (1.0 / 3.0));
    color.g += cyan.g / 3.5; color.b += cyan.b / 3.0;
    vec4 blue   = sampleBackdrop(refracted - dispersed * (2.0 / 3.0));
    color.b += blue.b / 3.0;
    vec4 purple = sampleBackdrop(refracted - dispersed);
    color.r += purple.r / 7.0; color.b += purple.b / 3.0;
  } else {
    color.rgb = sampleBackdrop(refracted).rgb;
  }

  color.rgb = colorControls(color.rgb);

  // --- surface tint -----------------------------------------------------
  color.rgb = mix(color.rgb, uSurface.rgb, uSurface.a);

  // --- highlight: an inner stroke along the outline ---------------------
  float gradRadius = min(radius * 1.5, min(halfSize.x, halfSize.y));
  vec2 g = gradSdRoundedRect(centered, halfSize, gradRadius, uSuperness);
  vec2 lightDir = vec2(cos(uHlAngle), sin(uHlAngle));
  float intensity = pow(abs(dot(g, lightDir)), uHlFalloff);
  float band = 1.0 - smoothstep(uHlWidth - 1.0, uHlWidth + 1.0, -sd);
  color.rgb += uHighlight.rgb * (intensity * band * uHighlight.a);

  // antialias the outline itself
  float cov = clamp(-sd, 0.0, 1.0);
  outColor = vec4(color.rgb * cov, cov);
}`;

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) + '\n' + src.split('\n').map(function (l, i) { return (i + 1) + ': ' + l; }).join('\n'));
    }
    return sh;
  }

  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  /* A true separable Gaussian, run once on the backdrop. The background is
   * static here, so there is no reason to use the multi-pass downsample tricks
   * the real-time implementations need - and no reason to accept their error.
   * Skia's own blur is a triple box approximation above sigma ~3, so this is
   * strictly better than asking CSS for it. */
  function gaussianBlur(srcCanvas, sigma) {
    if (sigma <= 0) return srcCanvas;
    var W = srcCanvas.width, H = srcCanvas.height;
    var radius = Math.max(1, Math.ceil(sigma * 3));
    var w = new Float32Array(radius * 2 + 1);
    var sum = 0;
    for (var i = -radius; i <= radius; i++) {
      var v = Math.exp(-(i * i) / (2 * sigma * sigma));
      w[i + radius] = v; sum += v;
    }
    for (i = 0; i < w.length; i++) w[i] /= sum;

    var sctx = srcCanvas.getContext('2d');
    var src = sctx.getImageData(0, 0, W, H).data;
    var tmp = new Float32Array(W * H * 3);
    var out = new Float32Array(W * H * 3);

    var x, y, k, px, acc0, acc1, acc2, wk;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        acc0 = acc1 = acc2 = 0;
        for (k = -radius; k <= radius; k++) {
          px = Math.min(W - 1, Math.max(0, x + k));
          wk = w[k + radius];
          acc0 += src[(y * W + px) * 4] * wk;
          acc1 += src[(y * W + px) * 4 + 1] * wk;
          acc2 += src[(y * W + px) * 4 + 2] * wk;
        }
        tmp[(y * W + x) * 3] = acc0; tmp[(y * W + x) * 3 + 1] = acc1; tmp[(y * W + x) * 3 + 2] = acc2;
      }
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        acc0 = acc1 = acc2 = 0;
        for (k = -radius; k <= radius; k++) {
          var py = Math.min(H - 1, Math.max(0, y + k));
          wk = w[k + radius];
          acc0 += tmp[(py * W + x) * 3] * wk;
          acc1 += tmp[(py * W + x) * 3 + 1] * wk;
          acc2 += tmp[(py * W + x) * 3 + 2] * wk;
        }
        out[(y * W + x) * 3] = acc0; out[(y * W + x) * 3 + 1] = acc1; out[(y * W + x) * 3 + 2] = acc2;
      }
    }

    var dst = document.createElement('canvas');
    dst.width = W; dst.height = H;
    var dctx = dst.getContext('2d');
    var img = dctx.createImageData(W, H);
    for (i = 0; i < W * H; i++) {
      img.data[i * 4] = out[i * 3];
      img.data[i * 4 + 1] = out[i * 3 + 1];
      img.data[i * 4 + 2] = out[i * 3 + 2];
      img.data[i * 4 + 3] = 255;
    }
    dctx.putImageData(img, 0, 0);
    return dst;
  }

  function Renderer(canvas) {
    var gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.prog = program(gl, VERT, FRAG);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(this.prog, 'aPos');
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
    var names = ['uCanvas','uRect','uRadii','uSuperness','uRefractionHeight','uRefractionAmount',
                 'uDepthEffect','uDispersion','uBrightness','uContrast','uSaturation',
                 'uSurface','uHighlight','uHlAngle','uHlFalloff','uHlWidth','uBackdrop'];
    for (var i = 0; i < names.length; i++) this.u[names[i]] = gl.getUniformLocation(this.prog, names[i]);
  }

  Renderer.prototype.setBackdrop = function (source) {
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
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

  Renderer.prototype.drawGlass = function (rect, o) {
    var gl = this.gl, u = this.u;
    gl.uniform4f(u.uRect, rect.x, rect.y, rect.w, rect.h);
    var r = o.radius;
    gl.uniform4f(u.uRadii, r, r, r, r);
    gl.uniform1f(u.uSuperness, o.superness);
    gl.uniform1f(u.uRefractionHeight, Math.max(0.01, o.height));
    gl.uniform1f(u.uRefractionAmount, -o.amount);   // Backdrop negates it
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

  global.LiquidGL = { Renderer: Renderer, gaussianBlur: gaussianBlur };
})(window);
