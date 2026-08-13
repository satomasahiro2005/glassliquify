/* Liquid glass displacement maps.
 *
 * The map is a picture of where each pixel should read its backdrop from.
 * feDisplacementMap moves a pixel by  scale * (channel/255 - 0.5), so 128 means
 * "do not move"; we encode the offset in R (x) and G (y) and hand the filter a
 * matching `scale`.
 *
 * Shape and strength are deliberately separate:
 *
 *   height  - how far in from the edge the bevel reaches (px)
 *   amount  - how far the backdrop is pulled at the strongest point (px)
 *
 * Folding those together, or driving them through a refractive index, means you
 * cannot widen the bevel without also making it bend harder. Apple's curve is
 * not a physically correct IOR anyway. The physical path is still here behind
 * `physical: true`, for comparison.
 *
 * Corners are superellipse (squircle) by default rather than circular arcs.
 * With circular corners the bevel band comes out uneven around the corner,
 * which is the first thing that shows when you put the two side by side.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    radius: 20,          // css px
    superness: 4,        // 2 = circular arc, 4 ~ iOS squircle
    height: 18,          // css px, width of the bevel band
    amount: 14,          // css px, peak displacement
    profile: 'circular', // circular | quadratic | smoothstep
    physical: false,     // use Snell with `ior` instead of `amount`
    ior: 1.5,
    thickness: 0,        // physical mode only; 0 means "same as height"
    dpr: 1,
  };

  /* Signed distance to a rounded rectangle whose corners are superellipses.
   * Negative inside. n === 2 gives the ordinary circular-corner version.
   *
   * The Lp norm is not a Euclidean distance, so the raw value would make the
   * bevel band wider on the corner diagonal than on the straight edges. We
   * divide by the gradient magnitude, which is the first-order correction and
   * is exact where it matters - right at the boundary.
   */
  function sdSuperRect(px, py, halfW, halfH, r, n) {
    var qx = Math.abs(px) - (halfW - r);
    var qy = Math.abs(py) - (halfH - r);

    if (qx <= 0 || qy <= 0) {
      // straight edge or interior: the corner term does not apply
      return Math.max(qx, qy) - r;
    }
    if (n === 2) {
      return Math.sqrt(qx * qx + qy * qy) - r;
    }

    var an = Math.pow(qx, n) + Math.pow(qy, n);
    var f = Math.pow(an, 1 / n) - r;

    // |grad| of (qx^n + qy^n)^(1/n)
    var gx = Math.pow(qx, n - 1);
    var gy = Math.pow(qy, n - 1);
    var gl = Math.sqrt(gx * gx + gy * gy) / Math.pow(an, (n - 1) / n);
    if (gl < 1e-9) return f;
    return f / gl;
  }

  /* Height of the glass surface, normalised to [0,1].
   * t = 0 at the boundary, 1 once we are `height` px inside. */
  function heightAt(t, profile) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    switch (profile) {
      case 'quadratic':
        return 1 - (1 - t) * (1 - t);
      case 'smoothstep':
        return t * t * (3 - 2 * t);
      case 'circular':
      default:
        // quarter circle: vertical tangent at the rim, flat on top, so almost
        // all of the bending happens in the outermost pixels
        return Math.sqrt(1 - (1 - t) * (1 - t));
    }
  }

  function buildSdfCanvas(w, h, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var dpr = o.dpr || 1;
    var W = Math.max(1, Math.round(w * dpr));
    var H = Math.max(1, Math.round(h * dpr));

    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d', { willReadFrequently: true });

    var halfW = W / 2;
    var halfH = H / 2;
    var r = Math.min(o.radius * dpr, Math.min(halfW, halfH));
    var band = Math.max(1, o.height * dpr);
    var n = Math.max(2, o.superness);

    // normalised surface height at a point
    function hAt(x, y) {
      var d = sdSuperRect(x - halfW, y - halfH, halfW, halfH, r, n);
      if (d >= 0) return 0;
      return heightAt(-d / band, o.profile);
    }

    var offs = new Float32Array(W * H * 2);
    var peak = 0;
    var k = 0;
    var x, y;

    if (o.physical) {
      // Snell through a slab of glass `thick` deep.
      var thick = (o.thickness > 0 ? o.thickness : o.height) * dpr;
      var eta = 1 / o.ior;
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var pxc = x + 0.5, pyc = y + 0.5;
          var hc = hAt(pxc, pyc) * thick;
          if (hc <= 0) { k += 2; continue; }

          var sx = (hAt(pxc + 1, pyc) - hAt(pxc - 1, pyc)) * 0.5 * thick;
          var sy = (hAt(pxc, pyc + 1) - hAt(pxc, pyc - 1)) * 0.5 * thick;

          var nx = -sx, ny = -sy, nz = 1;
          var nl = Math.sqrt(nx * nx + ny * ny + 1);
          nx /= nl; ny /= nl; nz /= nl;

          var cosi = nz;
          var kk = 1 - eta * eta * (1 - cosi * cosi);
          var rx, ry, rz;
          if (kk < 0) { rx = 0; ry = 0; rz = -1; }
          else {
            var fac = eta * cosi - Math.sqrt(kk);
            rx = fac * nx; ry = fac * ny; rz = -eta + fac * nz;
          }
          var az = Math.abs(rz) < 1e-4 ? 1e-4 : Math.abs(rz);
          var ox = rx * (hc / az);
          var oy = ry * (hc / az);
          offs[k++] = ox; offs[k++] = oy;
          var m = Math.sqrt(ox * ox + oy * oy);
          if (m > peak) peak = m;
        }
      }
    } else {
      // Shape from the gradient direction, strength from `amount` alone.
      var grads = new Float32Array(W * H * 2);
      var gpeak = 0;
      k = 0;
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var gx0 = 0, gy0 = 0;
          if (hAt(x + 0.5, y + 0.5) > 0) {
            gx0 = (hAt(x + 1.5, y + 0.5) - hAt(x - 0.5, y + 0.5)) * 0.5;
            gy0 = (hAt(x + 0.5, y + 1.5) - hAt(x + 0.5, y - 0.5)) * 0.5;
            var gm = Math.sqrt(gx0 * gx0 + gy0 * gy0);
            if (gm > gpeak) gpeak = gm;
          }
          grads[k++] = gx0; grads[k++] = gy0;
        }
      }
      if (gpeak < 1e-9) gpeak = 1;
      var amount = o.amount * dpr;
      for (var p = 0; p < W * H; p++) {
        var ax = grads[p * 2] / gpeak * amount;
        var ay = grads[p * 2 + 1] / gpeak * amount;
        offs[p * 2] = ax; offs[p * 2 + 1] = ay;
      }
      peak = amount;
    }

    if (peak < 1e-6) peak = 1;

    encodeInto(ctx, W, H, offs, peak, 1);

    // the filter works in css px, the map in device px
    return {
      canvas: cv, offsets: offs, width: W, height: H,
      scale: 2 * peak / dpr, peak: peak / dpr, dpr: dpr,
    };
  }

  /* Writes offsets into a canvas as an feDisplacementMap map.
   * `mul` scales the offsets; `peak` is the common encoding range, so several
   * maps built from the same peak all work with the same filter `scale`. */
  function encodeInto(ctx, W, H, offs, peak, mul) {
    var img = ctx.createImageData(W, H);
    var data = img.data;
    var enc = mul / (2 * peak);
    for (var q = 0, i = 0; q < W * H; q++) {
      var vx = Math.round(255 * (0.5 + offs[q * 2] * enc));
      var vy = Math.round(255 * (0.5 + offs[q * 2 + 1] * enc));
      data[i++] = vx < 0 ? 0 : vx > 255 ? 255 : vx;
      data[i++] = vy < 0 ? 0 : vy > 255 ? 255 : vy;
      data[i++] = 128;
      data[i++] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Three maps sharing one filter scale - one per colour channel.
   *
   * The obvious way to get chromatic aberration is to run three
   * feDisplacementMap passes with different `scale` values. Do not: in Chromium
   * a different scale changes the primitive subregion, the three channel
   * surfaces end up snapped to different pixels, and you get a 1px RGB split
   * across the whole element - even where the map is perfectly neutral. Keeping
   * one scale and varying the map instead leaves the interior untouched.
   */
  function buildSet(w, h, opts) {
    var o = Object.assign({}, DEFAULTS, opts || {});
    var d = o.dispersion == null ? 0 : o.dispersion;
    var built = buildSdfCanvas(w, h, o);

    // encode against the widest channel so nothing clips
    var peakPx = built.peak * (built.dpr || 1) * (1 + Math.abs(d));
    var muls = [1 - d, 1, 1 + d];
    var urls = muls.map(function (m) {
      var cv = document.createElement('canvas');
      cv.width = built.width; cv.height = built.height;
      var ctx = cv.getContext('2d');
      encodeInto(ctx, built.width, built.height, built.offsets, peakPx, m);
      return cv.toDataURL('image/png');
    });

    return {
      urls: urls,                                   // [red, green, blue]
      scale: 2 * peakPx / (built.dpr || 1),
      peak: built.peak,
      preview: built.canvas,
    };
  }

  function sdf(w, h, opts) {
    var built = buildSdfCanvas(w, h, opts);
    return {
      url: built.canvas.toDataURL('image/png'),
      canvas: built.canvas,
      scale: built.scale,
      peak: built.peak,
    };
  }

  // The map Liquify ships today, kept verbatim for comparison. Two linear
  // ramps over the whole box, so the offset follows absolute x/y rather than
  // the distance to the edge.
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

  /* A CSS clip-path for the same superellipse, so the element's own outline
   * matches the shape the displacement map was built for. */
  function squirclePath(w, h, radius, n, steps) {
    n = n || 4; steps = steps || 24;
    var r = Math.min(radius, Math.min(w, h) / 2);
    var pts = [];
    var corners = [[w - r, h - r, 1, 1], [r, h - r, -1, 1], [r, r, -1, -1], [w - r, r, 1, -1]];
    for (var c = 0; c < 4; c++) {
      var cx = corners[c][0], cy = corners[c][1], sx = corners[c][2], sy = corners[c][3];
      // Walking clockwise, half the corners are traced backwards.
      var back = sx * sy < 0;
      for (var i = 0; i <= steps; i++) {
        var u = back ? (steps - i) : i;
        var t = (u / steps) * (Math.PI / 2);
        var ct = Math.cos(t), st = Math.sin(t);
        var ex = Math.pow(Math.abs(ct), 2 / n) * (ct < 0 ? -1 : 1);
        var ey = Math.pow(Math.abs(st), 2 / n) * (st < 0 ? -1 : 1);
        pts.push((cx + sx * r * ex).toFixed(2) + 'px ' + (cy + sy * r * ey).toFixed(2) + 'px');
      }
    }
    return 'polygon(' + pts.join(',') + ')';
  }

  global.LiquidGlassMaps = {
    DEFAULTS: DEFAULTS,
    sdSuperRect: sdSuperRect,
    heightAt: heightAt,
    buildSdfCanvas: buildSdfCanvas,
    buildSet: buildSet,
    sdf: sdf,
    reactbits: reactbits,
    squirclePath: squirclePath,
  };
})(window);
