/* Liquid glass, baked into images.
 *
 * The refraction and the highlight follow Kyant0/AndroidLiquidGlass (Backdrop),
 * Apache-2.0, ported from its AGSL runtime shaders. The parameterisation is the
 * part worth taking: shape and strength stay independent.
 *
 *   height  (refractionHeight) - how far in from the edge the bevel reaches
 *   amount  (refractionAmount) - how far the backdrop is pulled at the rim
 *
 * The displacement magnitude comes straight from the signed distance,
 *
 *   d = circleMap(1 - (-sd)/height) * amount,   circleMap(x) = 1 - sqrt(1-x^2)
 *
 * not from the gradient of a height field - that is what keeps the two knobs
 * from bleeding into each other. The direction is the SDF gradient, taken on a
 * shape whose corner radius is inflated by 1.5x so the normal turns smoothly
 * through the corner.
 *
 * Everything here is precomputed into PNGs. The shapes do not move, so there is
 * no reason to approximate anything for speed.
 *
 * Corners are superellipse by default. Circular arcs (superness = 2) give a
 * bevel band that is visibly wider on the corner diagonal.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    radius: 20,          // css px
    superness: 4,        // 2 = circular arc (Kyant's exact shape), 4 ~ squircle
    height: 24,          // css px, refractionHeight  (Kyant uses 24dp everywhere)
    amount: 48,          // css px, refractionAmount   (always 2x height there)
    dispersion: 0,       // 0..1, chromatic aberration
    gradInflate: 1.5,    // corner radius multiplier for the gradient field
    depthEffect: 1,      // 0..1, blends the normal toward radial (always on there)
    dpr: 1,

    // highlight
    hlAngle: 45,         // degrees
    hlFalloff: 2,
    hlAlpha: 0.5,
    hlWidth: 1.5,        // css px, stroke width
    hlBlur: 1,           // css px, softening
  };

  function circleMap(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return 1 - Math.sqrt(1 - x * x);
  }

  /* Signed distance to a rounded rectangle with superellipse corners.
   * Negative inside. n === 2 is the ordinary circular-corner formula.
   *
   * The Lp norm is not a Euclidean distance, so it is divided by the gradient
   * magnitude - the first-order correction, exact at the boundary, which is
   * where the bevel band starts. Without it the band widens on the diagonal. */
  function sdShape(px, py, halfW, halfH, r, n) {
    var qx = Math.abs(px) - (halfW - r);
    var qy = Math.abs(py) - (halfH - r);

    if (qx <= 0 || qy <= 0) return Math.max(qx, qy) - r;
    if (n === 2) return Math.sqrt(qx * qx + qy * qy) - r;

    var an = Math.pow(qx, n) + Math.pow(qy, n);
    var f = Math.pow(an, 1 / n) - r;
    var gx = Math.pow(qx, n - 1);
    var gy = Math.pow(qy, n - 1);
    var gl = Math.sqrt(gx * gx + gy * gy) / Math.pow(an, (n - 1) / n);
    return gl < 1e-9 ? f : f / gl;
  }

  /* Outward unit normal of the same shape, analytically. */
  function gradShape(px, py, halfW, halfH, r, n, out) {
    var sx = px < 0 ? -1 : 1;
    var sy = py < 0 ? -1 : 1;
    var qx = Math.abs(px) - (halfW - r);
    var qy = Math.abs(py) - (halfH - r);

    if (qx > 0 && qy > 0) {
      var gx, gy;
      if (n === 2) { gx = qx; gy = qy; }
      else { gx = Math.pow(qx, n - 1); gy = Math.pow(qy, n - 1); }
      var l = Math.sqrt(gx * gx + gy * gy);
      if (l < 1e-9) { out[0] = 0; out[1] = 0; return out; }
      out[0] = sx * gx / l; out[1] = sy * gy / l;
      return out;
    }
    // straight edge or interior: whichever side is closer
    if (qx >= qy) { out[0] = sx; out[1] = 0; }
    else { out[0] = 0; out[1] = sy; }
    return out;
  }

  /* Per-pixel refraction offsets, in device px. */
  function computeOffsets(W, H, o, dpr) {
    var halfW = W / 2, halfH = H / 2;
    var r = Math.min(o.radius * dpr, Math.min(halfW, halfH));
    var n = Math.max(2, o.superness);
    var height = Math.max(1, o.height * dpr);
    var amount = o.amount * dpr;
    // inflate the corner radius for the direction field only
    var gr = Math.min(r * o.gradInflate, Math.min(halfW, halfH));

    var offs = new Float32Array(W * H * 2);
    var disp = new Float32Array(W * H * 2);   // dispersion split, same direction
    var g = [0, 0];
    var k = 0;

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var cx = x + 0.5 - halfW;
        var cy = y + 0.5 - halfH;

        var sd = sdShape(cx, cy, halfW, halfH, r, n);
        if (-sd >= height) { k += 2; continue; }
        if (sd > 0) sd = 0;

        var d = circleMap(1 - (-sd) / height) * amount;

        gradShape(cx, cy, halfW, halfH, gr, n, g);
        var gx = g[0], gy = g[1];
        if (o.depthEffect > 0) {
          var rl = Math.sqrt(cx * cx + cy * cy) || 1;
          gx += o.depthEffect * cx / rl;
          gy += o.depthEffect * cy / rl;
          var gl = Math.sqrt(gx * gx + gy * gy) || 1;
          gx /= gl; gy /= gl;
        }

        // amount is applied inward: the rim reads the backdrop from further in
        offs[k] = -d * gx;
        offs[k + 1] = -d * gy;

        if (o.dispersion > 0) {
          // Kyant scales dispersion by (x*y)/(halfW*halfH): nothing on the
          // axes, most of it in the corners.
          var di = o.dispersion * ((cx * cy) / (halfW * halfH));
          disp[k] = -d * gx * di;
          disp[k + 1] = -d * gy * di;
        }
        k += 2;
      }
    }
    return { offs: offs, disp: disp };
  }

  function encode(W, H, offs, disp, mul, peak) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(W, H);
    var data = img.data;
    var enc = 1 / (2 * peak);
    for (var p = 0, i = 0; p < W * H; p++) {
      var ox = offs[p * 2] + disp[p * 2] * mul;
      var oy = offs[p * 2 + 1] + disp[p * 2 + 1] * mul;
      var vx = Math.round(255 * (0.5 + ox * enc));
      var vy = Math.round(255 * (0.5 + oy * enc));
      data[i++] = vx < 0 ? 0 : vx > 255 ? 255 : vx;
      data[i++] = vy < 0 ? 0 : vy > 255 ? 255 : vy;
      data[i++] = 128;
      data[i++] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /* Backdrop's dispersion: seven taps along the refraction direction, summed
   * with fixed weights. Straight from RoundedRectRefractionWithDispersionShader.
   *
   *   tap      sample at                  adds
   *   red      refracted + disp           r/3.5
   *   orange   refracted + disp*2/3       r/3.5, g/7
   *   yellow   refracted + disp*1/3       r/3.5, g/3.5
   *   green    refracted                  g/3.5
   *   cyan     refracted - disp*1/3       g/3.5, b/3
   *   blue     refracted - disp*2/3       b/3
   *   purple   refracted - disp           r/7,   b/3
   *
   * Each channel's weights sum to exactly 1:
   *   R = 3/3.5 + 1/7 = 1,  G = 1/7 + 3/3.5 = 1,  B = 3/3 = 1
   * so the result keeps the backdrop's brightness; only the colours separate.
   *
   * A three-tap RGB approximation is not the same effect - it splits every
   * edge into hard red/cyan fringes, where seven weighted taps blend into a
   * smooth spectral smear. */
  var TAPS = [
    { k: 1,      w: [1 / 3.5, 0, 0] },
    { k: 2 / 3,  w: [1 / 3.5, 1 / 7, 0] },
    { k: 1 / 3,  w: [1 / 3.5, 1 / 3.5, 0] },
    { k: 0,      w: [0, 1 / 3.5, 0] },
    { k: -1 / 3, w: [0, 1 / 3.5, 1 / 3] },
    { k: -2 / 3, w: [0, 0, 1 / 3] },
    { k: -1,     w: [1 / 7, 0, 1 / 3] },
  ];

  /* All taps share one filter `scale`; only the maps differ.
   *
   * Do not give a tap its own `scale` instead: in Chromium a different scale
   * changes the primitive subregion, the surfaces land on different pixels, and
   * the whole element gets a 1px RGB split - even where the map is perfectly
   * neutral. Verified with an all-128 map. */
  function buildDisplacement(w, h, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var dpr = o.dpr || 1;
    var W = Math.max(1, Math.round(w * dpr));
    var H = Math.max(1, Math.round(h * dpr));

    var f = computeOffsets(W, H, o, dpr);
    var peak = Math.abs(o.amount * dpr) * (1 + Math.abs(o.dispersion));
    if (peak < 1e-6) peak = 1;

    var taps;
    if (o.dispersion > 0) {
      taps = TAPS.map(function (t) {
        return { url: encode(W, H, f.offs, f.disp, t.k, peak).toDataURL('image/png'), w: t.w };
      });
    } else {
      // no dispersion: one tap, full weight
      taps = [{ url: encode(W, H, f.offs, f.disp, 0, peak).toDataURL('image/png'), w: [1, 1, 1] }];
    }

    return {
      taps: taps,
      scale: 2 * peak / dpr,
      preview: encode(W, H, f.offs, f.disp, 0, peak),
    };
  }

  /* The highlight: an inner stroke along the outline, modulated by
   * pow(|dot(normal, lightDir)|, falloff). Meant to be composited additively.
   *
   * abs() is deliberate - the rim lights up on the far side too, which is a
   * large part of what makes the material read as glass rather than as a
   * bevelled button. */
  function buildHighlight(w, h, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var dpr = o.dpr || 1;
    var W = Math.max(1, Math.round(w * dpr));
    var H = Math.max(1, Math.round(h * dpr));
    var halfW = W / 2, halfH = H / 2;
    var r = Math.min(o.radius * dpr, Math.min(halfW, halfH));
    var n = Math.max(2, o.superness);
    var gr = Math.min(r * o.gradInflate, Math.min(halfW, halfH));

    var a = o.hlAngle * Math.PI / 180;
    var lx = Math.cos(a), ly = Math.sin(a);
    var width = Math.max(0.5, o.hlWidth * dpr);
    var soft = Math.max(0.01, o.hlBlur * dpr);

    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(W, H);
    var data = img.data;
    var g = [0, 0];

    for (var y = 0, i = 0; y < H; y++) {
      for (var x = 0; x < W; x++, i += 4) {
        var cx = x + 0.5 - halfW;
        var cy = y + 0.5 - halfH;
        var sd = sdShape(cx, cy, halfW, halfH, r, n);
        var inside = -sd;
        if (sd > 0 || inside > width + soft) { data[i + 3] = 0; continue; }

        // solid for the stroke width, then a soft shoulder
        var mask = inside <= width ? 1 : 1 - (inside - width) / soft;
        if (mask <= 0) { data[i + 3] = 0; continue; }

        gradShape(cx, cy, halfW, halfH, gr, n, g);
        var dp = g[0] * lx + g[1] * ly;
        var intensity = Math.pow(Math.abs(dp), o.hlFalloff);

        var al = Math.round(255 * mask * intensity * o.hlAlpha);
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
        data[i + 3] = al < 0 ? 0 : al > 255 ? 255 : al;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  /* colorControls as a 20-value feColorMatrix, matching Backdrop's
   * colorControlsColorFilter: saturation, then contrast about 0.5, then an
   * additive brightness. CSS brightness() is multiplicative, so it cannot
   * express the additive term - hence doing it in the filter chain. */
  function colorControlsMatrix(brightness, contrast, saturation) {
    var invSat = 1 - saturation;
    var r = 0.213 * invSat, g = 0.715 * invSat, b = 0.072 * invSat;
    var c = contrast, s = saturation;
    var t = 0.5 - c * 0.5 + brightness;   // 0..1 here; SVG wants the same scale
    var cr = c * r, cg = c * g, cb = c * b, cs = c * s;
    return [
      cr + cs, cg, cb, 0, t,
      cr, cg + cs, cb, 0, t,
      cr, cg, cb + cs, 0, t,
      0, 0, 0, 1, 0,
    ].join(' ');
  }

  /* clip-path for the same superellipse, so the element outline matches the
   * shape the maps were built for. */
  function squirclePath(w, h, radius, n, steps) {
    n = n || 4; steps = steps || 24;
    var r = Math.min(radius, Math.min(w, h) / 2);
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
        pts.push((cx + sx * r * ex).toFixed(2) + 'px ' + (cy + sy * r * ey).toFixed(2) + 'px');
      }
    }
    return 'polygon(' + pts.join(',') + ')';
  }

  // What Liquify ships today, for comparison: two linear ramps over the whole
  // box, so the offset follows absolute x/y rather than distance to the edge.
  function reactbits(w, h, opts) {
    var o = Object.assign({
      radius: 20, borderWidth: 0.07, brightness: 50, opacity: 0.93, blur: 2,
      mixBlendMode: 'screen',
    }, opts || {});
    var edge = Math.min(w, h) * (o.borderWidth * 0.5);
    var svg =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
      '<linearGradient id="rb-r" x1="100%" y1="0%" x2="0%" y2="0%">' +
      '<stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>' +
      '<linearGradient id="rb-b" x1="0%" y1="0%" x2="0%" y2="100%">' +
      '<stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient>' +
      '</defs>' +
      '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="black"></rect>' +
      '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="' + o.radius + '" fill="url(#rb-r)" />' +
      '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="' + o.radius + '" fill="url(#rb-b)" style="mix-blend-mode: ' + o.mixBlendMode + '" />' +
      '<rect x="' + edge + '" y="' + edge + '" width="' + (w - edge * 2) + '" height="' + (h - edge * 2) + '" rx="' + o.radius + '" fill="hsl(0 0% ' + o.brightness + '% / ' + o.opacity + ')" style="filter:blur(' + o.blur + 'px)" />' +
      '</svg>';
    return { url: 'data:image/svg+xml,' + encodeURIComponent(svg), scale: -80 };
  }

  global.LiquidGlassMaps = {
    DEFAULTS: DEFAULTS,
    circleMap: circleMap,
    sdShape: sdShape,
    gradShape: gradShape,
    buildDisplacement: buildDisplacement,
    buildHighlight: buildHighlight,
    colorControlsMatrix: colorControlsMatrix,
    squirclePath: squirclePath,
    reactbits: reactbits,
  };
})(window);
