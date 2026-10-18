// Dither engine: the banner video's ordered-dither look across the site.
//
//   banners  <canvas class="page-banner-canvas" data-seed="N"> on inner pages
//   media    project images / video / blog figures render dithered and
//            dissolve to the original in Bayer order (hover, or on scroll-in)
//   veil     Bayer dissolve when entering and leaving a page
//
// Palettes come from css/style.css: --dither-0..5 (greyscale, media) and
// --banner-0..5 (sampled from the homepage video, inner-page banners).
// Add data-dither="off" to any image to leave it alone.

(() => {

// Config

const MEDIA_HOVER  = '.project-card-img, .project-poster-thumb';
const MEDIA_REVEAL = '.post-img';

const CELL       = 2;    // css px per dither cell (media, banners)
const VEIL_CELL  = 4;    // chunkier cells for page transitions
const FPS        = 24;
const VEIL_IN_MS = 420;
const VEIL_OUT_MS = 260;
const REVEAL_MS  = 280;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover     = matchMedia('(hover: hover)').matches;

// Helpers

const rootStyle = getComputedStyle(document.documentElement);

function cssColor(name, fallback) {
  const hex = rootStyle.getPropertyValue(name).trim() || fallback;
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const ramp = prefix => [0, 1, 2, 3, 4, 5].map(i => cssColor(`--${prefix}-${i}`, '#000000'));
const PALETTE        = ramp('dither');
const BANNER_PALETTE = ramp('banner');
const BG             = cssColor('--bg', '#000000');

// 8x8 Bayer matrix, normalized to [0, 1)
const BAYER = (() => {
  let m = [[0]];
  while (m.length < 8) {
    const n = m.length, next = [];
    for (let y = 0; y < n * 2; y++) {
      next[y] = [];
      for (let x = 0; x < n * 2; x++) {
        const base = 4 * m[y % n][x % n];
        next[y][x] = base + [[0, 2], [3, 1]][(y / n) | 0][(x / n) | 0];
      }
    }
    m = next;
  }
  return Float32Array.from(m.flat(), v => (v + 0.5) / 64);
})();

const bayerAt = (x, y) => BAYER[((y & 7) << 3) | (x & 7)];

function thresholdGrid(w, h) {
  const t = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) t[y * w + x] = bayerAt(x, y);
  return t;
}

// Shared frame loop: every animated surface registers a tick(now)

const tickers = new Set();
let lastFrame = 0;

function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden || now - lastFrame < 1000 / FPS) return;
  lastFrame = now;
  tickers.forEach(fn => fn(now));
}
requestAnimationFrame(loop);

// Shader surface (banners)

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime, uSeed, uScale, uGain;
uniform vec3  uP0, uP1, uP2, uP3, uP4, uP5;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = r * p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
float clouds(vec2 c) {
  vec2 p = c / uScale + vec2(uSeed * 7.31, uSeed * 3.17);
  vec2 w = vec2(fbm(p + vec2(uTime * 0.035, 0.0)),
                fbm(p + vec2(5.2, 1.3) - vec2(0.0, uTime * 0.02)));
  return smoothstep(0.34, 0.82, fbm(p + 0.9 * w + vec2(uTime * 0.02, 0.0)));
}

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

vec3 ramp(float v, float th) {
  float l = clamp(v, 0.0, 1.0) * 5.0;
  float i = floor(l);
  if (l - i > th) i += 1.0;
  if (i < 0.5) return uP0;
  if (i < 1.5) return uP1;
  if (i < 2.5) return uP2;
  if (i < 3.5) return uP3;
  if (i < 4.5) return uP4;
  return uP5;
}

void main() {
  vec2 c = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  gl_FragColor = vec4(ramp(clouds(c) * uGain, bayer8(gl_FragCoord.xy)), 1.0);
}`;

function createShaderSurface(canvas, opts) {
  const gl = canvas.getContext('webgl', {
    antialias: false, alpha: false, depth: false, powerPreference: 'low-power',
  });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    console.warn('[dither] shader failed:', err);
    return null;
  }
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = name => gl.getUniformLocation(prog, name);
  opts.palette.forEach((c, i) => gl.uniform3f(u(`uP${i}`), c[0] / 255, c[1] / 255, c[2] / 255));
  gl.uniform1f(u('uSeed'),  opts.seed);
  gl.uniform1f(u('uScale'), opts.scale);
  gl.uniform1f(u('uGain'),  opts.gain);

  const uRes = u('uRes'), uTime = u('uTime');
  const start = performance.now() - opts.seed * 9000;

  return {
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    },
    draw(now) {
      gl.uniform1f(uTime, reduceMotion ? 0 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// Banners: inner-page headers rendered as live dithered clouds

function initBanners() {
  document.querySelectorAll('.page-banner-canvas').forEach(canvas => {
    const surface = createShaderSurface(canvas, {
      palette: BANNER_PALETTE, seed: parseFloat(canvas.dataset.seed) || 1, scale: 70, gain: 1.3,
    });
    if (!surface) { canvas.remove(); return; }

    let visible = true;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      surface.resize(Math.ceil(r.width / CELL), Math.ceil(r.height / CELL));
      surface.draw(performance.now());
    };
    resize();
    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    if (!reduceMotion) tickers.add(now => visible && surface.draw(now));
  });
}

// Media: dither images / video to greyscale, dissolve to the original

function ditherPixels(src, out, w, h) {
  const n = PALETTE.length - 1;
  const lumAt = i => {
    const l = (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) / 255;
    return Math.min(1, Math.max(0, (l - 0.5) * 1.15 + 0.52));
  };
  const level = (l, th) => {
    const v = l * n, i = Math.floor(v);
    return Math.min(n, v - i > th ? i + 1 : i);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] < 128) { out[i + 3] = 0; continue; }
      const c = PALETTE[level(lumAt(i), bayerAt(x, y))];
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  }
}

class DitherMedia {
  constructor(el, mode) {
    this.el = el;
    this.isVideo = el.tagName === 'VIDEO';
    this.t = 0;          // 0 = fully dithered, 1 = original showing
    this.target = 0;
    this.visible = false;

    this.wrap = document.createElement('span');
    this.wrap.className = 'dither-media';
    el.parentNode.insertBefore(this.wrap, el);
    this.wrap.appendChild(el);

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.wrap.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.work = document.createElement('canvas');
    this.wctx = this.work.getContext('2d', { willReadFrequently: true });

    if (mode === 'hover') {
      this.wrap.addEventListener('mouseenter', () => this.animateTo(1));
      this.wrap.addEventListener('mouseleave', () => this.animateTo(0));
    } else {
      const io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { this.animateTo(1); io.disconnect(); }
      }, { threshold: 0.4 });
      io.observe(this.wrap);
    }
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }).observe(this.wrap);

    const ready = () => { this.layout(); new ResizeObserver(() => this.layout()).observe(el); };
    if (this.isVideo ? el.readyState >= 2 : el.complete && el.naturalWidth) ready();
    else el.addEventListener(this.isVideo ? 'loadeddata' : 'load', ready, { once: true });

    if (this.isVideo) tickers.add(() => this.visible && this.t < 1 && !el.paused && this.sample());
  }

  layout() {
    const el = this.el;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    Object.assign(this.canvas.style, {
      left: `${el.offsetLeft + el.clientLeft}px`,
      top: `${el.offsetTop + el.clientTop}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    this.w = Math.max(1, Math.round(w / CELL));
    this.h = Math.max(1, Math.round(h / CELL));
    this.canvas.width = this.work.width = this.w;
    this.canvas.height = this.work.height = this.h;
    this.thresholds = thresholdGrid(this.w, this.h);
    this.dithered = new Uint8ClampedArray(this.w * this.h * 4);
    this.frame = this.ctx.createImageData(this.w, this.h);
    this.sample();
  }

  sample() {
    if (!this.w) return;
    try {
      this.wctx.drawImage(this.el, 0, 0, this.w, this.h);
      const src = this.wctx.getImageData(0, 0, this.w, this.h).data;
      ditherPixels(src, this.dithered, this.w, this.h);
    } catch (err) {
      // tainted canvas (e.g. opened over file://); just show the original
      this.destroy();
      return;
    }
    this.paint();
  }

  paint() {
    const out = this.frame.data, src = this.dithered, th = this.thresholds, t = this.t;
    for (let i = 0, p = 0; i < th.length; i++, p += 4) {
      out[p] = src[p]; out[p + 1] = src[p + 1]; out[p + 2] = src[p + 2];
      out[p + 3] = th[i] < t ? 0 : src[p + 3];
    }
    this.ctx.putImageData(this.frame, 0, 0);
  }

  animateTo(target) {
    this.target = target;
    if (reduceMotion) { this.t = target; this.paint(); return; }
    if (this.animating) return;
    this.animating = true;
    let last = performance.now();
    const step = now => {
      const dt = (now - last) / REVEAL_MS;
      last = now;
      this.t += Math.sign(this.target - this.t) * Math.min(dt, Math.abs(this.target - this.t));
      if (this.isVideo && this.t < 1) this.sample(); else this.paint();
      if (this.t !== this.target) requestAnimationFrame(step);
      else this.animating = false;
    };
    requestAnimationFrame(step);
  }

  destroy() {
    this.w = 0;
    this.canvas.remove();
  }
}

function initMedia() {
  const mode = canHover ? 'hover' : 'reveal';
  document.querySelectorAll(MEDIA_HOVER).forEach(el => {
    if (el.dataset.dither !== 'off') new DitherMedia(el, mode);
  });
  document.querySelectorAll(MEDIA_REVEAL).forEach(el => {
    if (el.dataset.dither !== 'off') new DitherMedia(el, 'reveal');
  });
}

// Veil: Bayer dissolve over the whole viewport for page transitions

function createVeil() {
  const canvas = document.createElement('canvas');
  canvas.className = 'dither-veil';
  canvas.setAttribute('aria-hidden', 'true');
  const w = Math.ceil(window.innerWidth / VEIL_CELL);
  const h = Math.ceil(window.innerHeight / VEIL_CELL);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const th = thresholdGrid(w, h);
  for (let p = 0; p < img.data.length; p += 4) {
    img.data[p] = BG[0]; img.data[p + 1] = BG[1]; img.data[p + 2] = BG[2];
  }

  // cover: 1 = fully hidden, 0 = page fully visible
  const paint = cover => {
    for (let i = 0; i < th.length; i++) img.data[i * 4 + 3] = th[i] < cover ? 255 : 0;
    ctx.putImageData(img, 0, 0);
  };

  const run = (from, to, ms, done) => {
    const start = performance.now();
    const step = now => {
      const k = Math.min(1, (now - start) / ms);
      paint(from + (to - from) * k);
      if (k < 1) requestAnimationFrame(step);
      else done && done();
    };
    requestAnimationFrame(step);
  };

  document.body.appendChild(canvas);
  return { canvas, paint, run };
}

function initTransitions() {
  if (reduceMotion) return;

  // entering: start fully covered, dissolve once the header is in place
  const veil = createVeil();
  veil.paint(1);
  const remove = () => veil.canvas.remove();
  const safety = setTimeout(remove, 2000);
  const reveal = () => veil.run(1, 0, VEIL_IN_MS, () => { clearTimeout(safety); remove(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reveal);
  else reveal();

  // leaving: dither out, then navigate
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;

    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    if (/\.(pdf|png|jpe?g|webp|gif|webm|mp4|mov)$/i.test(url.pathname)) return;

    e.preventDefault();
    createVeil().run(0, 1, VEIL_OUT_MS, () => { location.href = url.href; });
  });

  // back/forward cache restores the page mid-transition
  window.addEventListener('pageshow', e => {
    if (e.persisted) document.querySelectorAll('.dither-veil').forEach(v => v.remove());
  });
}

// Init

initTransitions();

function init() {
  initBanners();
  initMedia();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
