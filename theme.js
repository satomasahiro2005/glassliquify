(() => {
  // ==================== Glass Surface ====================
  (() => {
    let STYLE_ID = "liquify-glass-target-style";
    let SVG_ID = "liquify-glass-filters";

    let TARGET_CONFIGS = [
      { selector: ".main-trackList-trackListHeader", options: { borderRadius: 20 } },
      { selector: ".main-topBar-background", options: { borderRadius: 0 } },
      { selector: ".znOINyqAy7ivIGbQyrbt", options: { borderRadius: 20, blur: 5 } },
      { selector: ".iGRaSZDa1r0m21aF6oZq", options: { borderRadius: 20 } },
      { selector: ".niJOWstqVyfckHcXQxP1 .cSZJwcwYgJfwduUmXOOV", options: { borderRadius: 20 } },
      { selector: ".main-nowPlayingView-trackInfo", options: { borderRadius: 20 } },
      { selector: ".main-nowPlayingView-section", options: { borderRadius: 20 } },
      { selector: ".main-entityHeader-container.gmKBgPCnX785KDicbdJu", options: { borderRadius: 20 } },
      { selector: ".main-home-filterChipsSection", options: { borderRadius: 20 } },
      { selector: ".view-homeShortcutsGrid-shortcut", options: { borderRadius: 20 } },
      { selector: ".main-card-card", options: { borderRadius: 20 } },
      { selector: ".Root__globalNav .DoxYADBBjYMvoYwl7QPg", options: { borderRadius: 50 } },
      { selector: ".yfJeY2Xi99dPOe6fsIha", options: { borderRadius: 20 } }
    ];

    let DEFAULTS = {
      borderWidth: 0.07,
      brightness: 50,
      opacity: 0.93,
      blur: 2,
      displace: 0.2,
      distortionScale: -80,
      redOffset: 0,
      greenOffset: 6,
      blueOffset: 10,
      xChannel: "R",
      yChannel: "G",
      mixBlendMode: "screen"
    };

    let applied = new WeakMap();
    let filterCounter = 0;

    function injectStyleTag() {
      if (document.getElementById(STYLE_ID)) return;
      let el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = `
        .liquify-glass-target {
          backdrop-filter: var(--glass-filter) blur(var(--glass-blur)) !important;
          -webkit-backdrop-filter: var(--glass-filter) blur(var(--glass-blur)) !important;
          box-shadow: var(--glass-shadow) !important;
        }
      `;
      document.head.appendChild(el);
    }

    function getOrCreateSvg() {
      let el = document.getElementById(SVG_ID);
      if (el) return el;
      el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      el.setAttribute("id", SVG_ID);
      el.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      el.setAttribute("width", "0");
      el.setAttribute("height", "0");
      el.setAttribute("aria-hidden", "true");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "-9999px";
      el.style.pointerEvents = "none";
      let defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      el.appendChild(defs);
      document.body.appendChild(el);
      return el;
    }

    function buildSvgDataUrl(rect, opts) {
      let w = rect?.width || 400;
      let h = rect?.height || 200;
      let br = opts.borderRadius ?? 0;
      let border = Math.min(w, h) * (opts.borderWidth * 0.5);
      let redGradId = `red-grad-${opts.filterId}`;
      let blueGradId = `blue-grad-${opts.filterId}`;
      let svg = `
        <svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stop-color="#0000"/>
              <stop offset="100%" stop-color="red"/>
            </linearGradient>
            <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#0000"/>
              <stop offset="100%" stop-color="blue"/>
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="${w}" height="${h}" fill="black"></rect>
          <rect x="0" y="0" width="${w}" height="${h}" rx="${br}" fill="url(#${redGradId})" />
          <rect x="0" y="0" width="${w}" height="${h}" rx="${br}" fill="url(#${blueGradId})" style="mix-blend-mode: ${opts.mixBlendMode}" />
          <rect x="${border}" y="${border}" width="${w - border * 2}" height="${h - border * 2}" rx="${br}" fill="hsl(0 0% ${opts.brightness}% / ${opts.opacity})" style="filter:blur(${opts.blur}px)" />
        </svg>
      `;
      return `data:image/svg+xml,${encodeURIComponent(svg)}`;
    }

    function createFilter(defs, opts) {
      let filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
      filter.setAttribute("id", opts.filterId);
      filter.setAttribute("color-interpolation-filters", "sRGB");
      filter.setAttribute("x", "0%");
      filter.setAttribute("y", "0%");
      filter.setAttribute("width", "100%");
      filter.setAttribute("height", "100%");

      let feImage = document.createElementNS("http://www.w3.org/2000/svg", "feImage");
      feImage.setAttribute("x", "0");
      feImage.setAttribute("y", "0");
      feImage.setAttribute("width", "100%");
      feImage.setAttribute("height", "100%");
      feImage.setAttribute("preserveAspectRatio", "none");
      feImage.setAttribute("result", "map");

      let feDispRed = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
      feDispRed.setAttribute("in", "SourceGraphic");
      feDispRed.setAttribute("in2", "map");
      feDispRed.setAttribute("result", "dispRed");

      let feRedMatrix = document.createElementNS("http://www.w3.org/2000/svg", "feColorMatrix");
      feRedMatrix.setAttribute("in", "dispRed");
      feRedMatrix.setAttribute("type", "matrix");
      feRedMatrix.setAttribute("values", `1 0 0 0 0
0 0 0 0 0
0 0 0 0 0
0 0 0 1 0`);
      feRedMatrix.setAttribute("result", "red");

      let feDispGreen = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
      feDispGreen.setAttribute("in", "SourceGraphic");
      feDispGreen.setAttribute("in2", "map");
      feDispGreen.setAttribute("result", "dispGreen");

      let feGreenMatrix = document.createElementNS("http://www.w3.org/2000/svg", "feColorMatrix");
      feGreenMatrix.setAttribute("in", "dispGreen");
      feGreenMatrix.setAttribute("type", "matrix");
      feGreenMatrix.setAttribute("values", `0 0 0 0 0
0 1 0 0 0
0 0 0 0 0
0 0 0 1 0`);
      feGreenMatrix.setAttribute("result", "green");

      let feDispBlue = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
      feDispBlue.setAttribute("in", "SourceGraphic");
      feDispBlue.setAttribute("in2", "map");
      feDispBlue.setAttribute("result", "dispBlue");

      let feBlueMatrix = document.createElementNS("http://www.w3.org/2000/svg", "feColorMatrix");
      feBlueMatrix.setAttribute("in", "dispBlue");
      feBlueMatrix.setAttribute("type", "matrix");
      feBlueMatrix.setAttribute("values", `0 0 0 0 0
0 0 0 0 0
0 0 1 0 0
0 0 0 1 0`);
      feBlueMatrix.setAttribute("result", "blue");

      let feBlendRG = document.createElementNS("http://www.w3.org/2000/svg", "feBlend");
      feBlendRG.setAttribute("in", "red");
      feBlendRG.setAttribute("in2", "green");
      feBlendRG.setAttribute("mode", "screen");
      feBlendRG.setAttribute("result", "rg");

      let feBlendFinal = document.createElementNS("http://www.w3.org/2000/svg", "feBlend");
      feBlendFinal.setAttribute("in", "rg");
      feBlendFinal.setAttribute("in2", "blue");
      feBlendFinal.setAttribute("mode", "screen");
      feBlendFinal.setAttribute("result", "output");

      let feGaussian = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
      feGaussian.setAttribute("in", "output");

      filter.appendChild(feImage);
      filter.appendChild(feDispRed);
      filter.appendChild(feRedMatrix);
      filter.appendChild(feDispGreen);
      filter.appendChild(feGreenMatrix);
      filter.appendChild(feDispBlue);
      filter.appendChild(feBlueMatrix);
      filter.appendChild(feBlendRG);
      filter.appendChild(feBlendFinal);
      filter.appendChild(feGaussian);
      defs.appendChild(filter);

      return {
        filter,
        feImage,
        feDispRed,
        feDispGreen,
        feDispBlue,
        feGaussian
      };
    }

    function updateFilterScales(nodes, opts) {
      let redScale = opts.distortionScale + opts.redOffset;
      let greenScale = opts.distortionScale + opts.greenOffset;
      let blueScale = opts.distortionScale + opts.blueOffset;
      nodes.feDispRed.setAttribute("scale", redScale.toString());
      nodes.feDispGreen.setAttribute("scale", greenScale.toString());
      nodes.feDispBlue.setAttribute("scale", blueScale.toString());
      [nodes.feDispRed, nodes.feDispGreen, nodes.feDispBlue].forEach((disp) => {
        disp.setAttribute("xChannelSelector", opts.xChannel);
        disp.setAttribute("yChannelSelector", opts.yChannel);
      });
      nodes.feGaussian.setAttribute("stdDeviation", opts.displace.toString());
    }

    function applyGlassToElement(el, overrides) {
      if (!el || applied.has(el)) return;
      let defs = getOrCreateSvg().querySelector("defs");
      let id = `glass-filter--r1-${filterCounter++}`;
      let opts = { ...DEFAULTS, ...overrides, filterId: id };
      let nodes = createFilter(defs, opts);
      updateFilterScales(nodes, opts);

      let prevW = 0;
      let prevH = 0;
      let updateSize = () => {
        let rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height || (rect.width === prevW && rect.height === prevH)) return;
        prevW = rect.width;
        prevH = rect.height;
        let dataUrl = buildSvgDataUrl(rect, opts);
        nodes.feImage.setAttribute("href", dataUrl);
        nodes.feImage.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", dataUrl);
        nodes.feImage.setAttribute("width", "100%");
        nodes.feImage.setAttribute("height", "100%");
      };
      updateSize();

      let resizeObs = new ResizeObserver(() => {
        requestAnimationFrame(updateSize);
      });
      resizeObs.observe(el);

      el.classList.add("liquify-glass-target");
      el.style.setProperty("--glass-filter", `url(#${id})`);
      el.style.setProperty("--glass-blur", `${opts.blur ?? 2}px`);
      el.style.backdropFilter = "var(--glass-filter) blur(var(--glass-blur)) !important";
      el.style.webkitBackdropFilter = "var(--glass-filter) blur(var(--glass-blur)) !important";
      el.style.boxShadow = "var(--glass-shadow) !important";
      if (typeof opts.borderRadius === "number") {
        el.style.borderRadius = `${opts.borderRadius}px`;
      }
      applied.set(el, { options: opts, nodes, resizeObserver: resizeObs });
    }

    function applyAllGlass() {
      TARGET_CONFIGS.forEach(({ selector, options }) => {
        document.querySelectorAll(selector).forEach((el) => applyGlassToElement(el, options));
      });
    }

    injectStyleTag();
    applyAllGlass();
    new MutationObserver(() => {
      applyAllGlass();
    }).observe(document.body, { childList: true, subtree: true });
  })();

  // ==================== Background System ====================
  (async function () {
    for (; !Spicetify?.Player || !Spicetify?.Player?.data; ) {
      await new Promise((r) => setTimeout(r, 300));
    }

    let root = document.querySelector(".Root__top-container");
    if (!root) return;

    let layerA = document.createElement("div");
    let layerB = document.createElement("div");
    layerA.classList.add("liquify-bg-layer", "layer-a");
    layerB.classList.add("liquify-bg-layer", "layer-b");
    root.prepend(layerA, layerB);

    let animatedBg = document.createElement("div");
    animatedBg.classList.add("liquify-animated-bg");

    let tilesA = [];
    let tilesB = [];
    for (let i = 0; i < 2; i++) {
      let tile = document.createElement("div");
      tile.classList.add("liquify-animated-tile");
      animatedBg.appendChild(tile);
      tilesA.push(tile);
    }
    for (let i = 0; i < 2; i++) {
      let tile = document.createElement("div");
      tile.classList.add("liquify-animated-tile");
      animatedBg.appendChild(tile);
      tilesB.push(tile);
    }
    root.prepend(animatedBg);

    let animFlip = true;
    let dynamicFlip = true;
    let lastImage = null;
    let lastMode = null;
    let lastAlbumArt = null;
    let lastBgUrl = null;

    function getAlbumArt() {
      let url = Spicetify.Player?.data?.item?.metadata?.image_url;
      return url ? url.replace("spotify:image:", "https://i.scdn.co/image/") : null;
    }

    function getAverageColor(src) {
      return new Promise((resolve) => {
        if (!src) return resolve("rgb(30,215,96)");
        let img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = src;
        img.onload = () => {
          let canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          let ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          let data = ctx.getImageData(0, 0, img.width, img.height).data;
          let r = 0, g = 0, b = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
          resolve(
            `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`
          );
        };
        img.onerror = () => resolve("rgb(30,215,96)");
      });
    }

    function boostColor(rgb, satMul = 1.7, lightMul = 1.1) {
      let [r, g, b] = rgb.match(/\d+/g).map(Number);
      let rN = r / 255, gN = g / 255, bN = b / 255;
      let max = Math.max(rN, gN, bN);
      let min = Math.min(rN, gN, bN);
      let h, s, l = (max + min) / 2;

      if (max === min) {
        h = s = 0;
      } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
          case gN: h = (bN - rN) / d + 2; break;
          case bN: h = (rN - gN) / d + 4; break;
        }
        h /= 6;
      }

      s = Math.min(s * satMul, 1);
      l = Math.min(l * lightMul, 1);

      function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      }

      let rOut, gOut, bOut;
      if (s === 0) {
        rOut = gOut = bOut = l;
      } else {
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q;
        rOut = hue2rgb(p, q, h + 1 / 3);
        gOut = hue2rgb(p, q, h);
        bOut = hue2rgb(p, q, h - 1 / 3);
      }

      return `rgb(${Math.round(rOut * 255)},${Math.round(gOut * 255)},${Math.round(bOut * 255)})`;
    }

    async function updateBackground() {
      let mode = localStorage.getItem("liquify-bg-mode") || "dynamic";
      let customImage = localStorage.getItem("liquify-bg-image");
      let bgUrl = localStorage.getItem("liquify-bg-url");
      let albumArt = getAlbumArt();

      if (
        !(mode !== lastMode || customImage !== lastImage || bgUrl !== lastBgUrl) &&
        !(albumArt !== lastAlbumArt)
      ) {
        return;
      }

      lastMode = mode;
      lastImage = customImage;
      lastBgUrl = bgUrl;
      lastAlbumArt = albumArt;

      let src;

      if (mode === "url" && bgUrl) {
        src = bgUrl;
        layerA.style.backgroundImage = `url("${src}")`;
        layerB.style.backgroundImage = `url("${src}")`;
        layerA.classList.add("active");
        layerB.classList.remove("active");
        animatedBg.classList.remove("active");
        tilesA.forEach((t) => t.classList.remove("active"));
        tilesB.forEach((t) => t.classList.remove("active"));
      } else if (mode === "custom" && customImage) {
        src = customImage;
        layerA.style.backgroundImage = `url("${src}")`;
        layerB.style.backgroundImage = `url("${src}")`;
        layerA.classList.add("active");
        layerB.classList.remove("active");
        animatedBg.classList.remove("active");
        tilesA.forEach((t) => t.classList.remove("active"));
        tilesB.forEach((t) => t.classList.remove("active"));
      } else if (mode === "animated" && albumArt) {
        layerA.classList.remove("active");
        layerB.classList.remove("active");
        animatedBg.classList.add("active");
        if (animFlip) {
          tilesA.forEach((t) => {
            t.style.backgroundImage = `url("${albumArt}")`;
            t.classList.add("active");
          });
          tilesB.forEach((t) => t.classList.remove("active"));
        } else {
          tilesB.forEach((t) => {
            t.style.backgroundImage = `url("${albumArt}")`;
            t.classList.add("active");
          });
          tilesA.forEach((t) => t.classList.remove("active"));
        }
        animFlip = !animFlip;
      } else if (albumArt) {
        // dynamic mode
        src = albumArt;
        animatedBg.classList.remove("active");
        tilesA.forEach((t) => t.classList.remove("active"));
        tilesB.forEach((t) => t.classList.remove("active"));
        if (dynamicFlip) {
          layerA.style.backgroundImage = `url("${src}")`;
          layerA.classList.add("active");
          layerB.classList.remove("active");
        } else {
          layerB.style.backgroundImage = `url("${src}")`;
          layerB.classList.add("active");
          layerA.classList.remove("active");
        }
        dynamicFlip = !dynamicFlip;
      }

      if (albumArt) {
        let avg = await getAverageColor(albumArt);
        let boosted = boostColor(avg, 1.7, 1.1);
        document.documentElement.style.setProperty("--accent-color", boosted);
      }
    }

    updateBackground();
    Spicetify.Player.addEventListener("songchange", updateBackground);
    window.addEventListener("liquifyBackgroundChange", updateBackground);
    setInterval(updateBackground, 500);
  })();

  // ==================== Popup Bounce ====================
  (() => {
    let BOUNCE_STYLE_ID = "liquify-popup-bounce-style";

    if (!document.getElementById(BOUNCE_STYLE_ID)) {
      let style = document.createElement("style");
      style.id = BOUNCE_STYLE_ID;
      style.textContent = `
        @keyframes popupBounce {
          0%   { transform: scale(0.85); }
          40%  { transform: scale(1.05); }
          60%  { transform: scale(0.98); }
          80%  { transform: scale(1.02); }
          100% { transform: scale(1); }
        }

        .popup-bounce {
          animation: popupBounce 300ms cubic-bezier(.22,.9,.3,1) forwards;
          transform-origin: top center;
        }

        .main-contextMenu-menu::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          z-index: -1;
          box-shadow: var(--glass-shadow);
          backdrop-filter: var(--glass-filter) blur(5px);
          --glass-filter: url(#glass-filter--r1-7);
        }
      `;
      document.head.appendChild(style);
    }

    let expandedStates = new WeakMap();
    let visibilityStates = new WeakMap();

    let POPUP_SELECTOR = `
      .main-contextMenu-menu,
      .jHt3xA6ovwVKkMJKqOhO,
      .HwAlGCDD0hvEKSl4MqyQ
    `;

    function triggerBounce(el, trigger) {
      if (!el) return;
      if (trigger?.id === "liquify-settings-btn") return;
      el.classList.remove("popup-bounce");
      el.offsetWidth; // force reflow
      el.classList.add("popup-bounce");
      el.addEventListener(
        "animationend",
        () => { el.classList.remove("popup-bounce"); },
        { once: true }
      );
    }

    function isVisible(el) {
      if (!el) return false;
      let cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") {
        return false;
      }
      return el.offsetParent !== null;
    }

    function checkPopups() {
      document.querySelectorAll(POPUP_SELECTOR).forEach((el) => {
        let wasVisible = !!visibilityStates.get(el);
        let nowVisible = isVisible(el);
        if (!wasVisible && nowVisible) triggerBounce(el);
        visibilityStates.set(el, nowVisible);
      });
    }

    new MutationObserver((mutations) => {
      for (let mutation of mutations) {
        if (mutation.attributeName === "aria-expanded") {
          let target = mutation.target;
          let newVal = target.getAttribute("aria-expanded");
          if (expandedStates.get(target) === "false" && newVal === "true") {
            let popup = target.parentElement?.querySelector(POPUP_SELECTOR);
            triggerBounce(popup, target);
          }
          expandedStates.set(target, newVal);
        }
      }
      requestAnimationFrame(checkPopups);
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ["aria-expanded", "style", "class"]
    });

    document.querySelectorAll("[aria-expanded]").forEach((el) => {
      expandedStates.set(el, el.getAttribute("aria-expanded"));
    });

    checkPopups();
  })();
})();
