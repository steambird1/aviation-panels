/* =============================================================================
 * CRTDisplay.js —— 把任意 <canvas> 变成一台 CRT 显示器
 * -----------------------------------------------------------------------------
 * 用法（只有两步，其余代码一行都不用改）：
 *
 *   var cv  = document.getElementById('game');
 *   var crt = new CRTDisplay(cv, { curvature: 0.12 });   // ① 先包一层
 *   var ctx = cv.getContext('2d');                       // ② 再正常取上下文
 *   // 之后 ctx.fillRect / drawImage / fillText / save / restore ... 照常写
 *
 * 原理：
 *   · 你的所有绘制指令被透明代理到一块「离屏源画布」上（仍是普通 2D 上下文）；
 *   · 每帧把源画布当作纹理，用 WebGL 做一次 CRT 后处理，画到可见 canvas 上。
 *   · canvas.getContext('webgl' / 'webgl2') 同样被代理：你的 WebGL/Three.js
 *     代码也会先渲染到离屏画布，再被 CRT 化。
 *
 * 兼容性：
 *   · 代理层用 Proxy 实现，对 2D API 完全透明（含未来新增的方法）；
 *   · 没有 WebGL 时自动降级为 2D 重采样 + CSS 叠加层（见 fallback 选项）。
 * ============================================================================= */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.CRTDisplay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================== 着色器 ============================== */

  /* uFlip: 采样方向。
     +1 = 输出到屏幕（默认帧缓冲）——NDC y=+1 是画布顶部，对应纹理 v=0
     -1 = 输出到 FBO 纹理——NDC y=-1 才是纹理第 0 行，必须反向采样，
          否则写进 FBO 的画面是上下颠倒的（余晖开启时才会暴露） */
  var VERT = [
    'attribute vec2 aPos;',
    'uniform float uFlip;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5 * uFlip);',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* 余晖：新帧与衰减后的历史取 max —— 这就是荧光粉拖影 */
  var FRAG_PERSIST = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uCur;',
    'uniform sampler2D uPrev;',
    'uniform float uDecay;',
    'void main(){',
    '  vec3 c = texture2D(uCur, vUv).rgb;',
    '  vec3 p = texture2D(uPrev, vUv).rgb * uDecay;',
    '  gl_FragColor = vec4(max(c, p), 1.0);',
    '}'
  ].join('\n');

  var FRAG_PRESENT = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2  uSrc;        // 源分辨率(px)',
    'uniform vec2  uOut;        // 输出分辨率(px)',
    'uniform float uTime;',
    'uniform float uCurvature;  // 曲面强度',
    'uniform float uScan;       // 扫描线浓度',
    'uniform float uScanPeriod; // 扫描线周期(输出像素)',
    'uniform float uMask;       // 荫罩浓度',
    'uniform float uMaskSize;   // 荫罩周期(输出像素)',
    'uniform float uAberr;      // 色差(px)',
    'uniform float uBloom;',
    'uniform float uVig;',
    'uniform float uGlare;',
    'uniform float uNoise;',
    'uniform float uFlicker;',
    'uniform float uBright;',
    'uniform float uSat;',
    'uniform float uJitter;',
    'uniform float uBar;',
    'uniform float uCollapse;   // 关机动画 0~1',
    '',
    // 屏幕坐标 -> 源纹理坐标（桶形/凸面）
    'vec2 curve(vec2 uv){',
    '  uv = uv * 2.0 - 1.0;',
    '  vec2 o = abs(uv.yx) * uCurvature;',
    '  uv += uv * o * o;',
    '  return uv * 0.5 + 0.5;',
    '}',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(41.0, 289.0))) * 43758.5453); }',
    'vec3 th(vec3 c){ return c * smoothstep(0.28, 0.85, dot(c, vec3(0.299, 0.587, 0.114))); }',
    'vec3 bloom(vec2 uv){',
    '  vec2 px = 1.5 / uSrc;',
    '  vec3 s = vec3(0.0);',
    '  for (int i = 0; i < 8; i++){',
    '    float a = 6.2831853 * float(i) / 8.0;',
    '    vec2 d = vec2(cos(a), sin(a));',
    '    s += th(texture2D(uTex, uv + d * px).rgb);',
    '    s += th(texture2D(uTex, uv + d * px * 2.4).rgb) * 0.55;',
    '  }',
    '  return s / 12.4;',
    '}',
    'void main(){',
    '  vec2 uvS = vUv;',
    '  uvS.y += uJitter;',
    '  if (uCollapse > 0.001){',                    // 关机：纵向压成一条线
    '    uvS.y = (uvS.y - 0.5) / max(0.0008, 1.0 - uCollapse) + 0.5;',
    '    uvS.x = (uvS.x - 0.5) / max(0.02, 1.0 - uCollapse * 0.9) + 0.5;',
    '  }',
    '  vec2 uv = curve(uvS);',
    '  vec2 q  = uvS * 2.0 - 1.0;',
    '',
    '  vec2 e = smoothstep(vec2(0.0), vec2(0.004), uv) * smoothstep(vec2(0.0), vec2(0.004), 1.0 - uv);',
    '  float edge = e.x * e.y;',
    '',
    '  vec2 ab = q * (uAberr * 2.0) / uSrc;',        // 越靠边色差越大
    '  vec3 col;',
    '  col.r = texture2D(uTex, uv + ab).r;',
    '  col.g = texture2D(uTex, uv).g;',
    '  col.b = texture2D(uTex, uv - ab).b;',
    '',
    '  float sl   = 0.5 + 0.5 * cos((uvS.y * uOut.y / uScanPeriod) * 6.2831853 + 3.1415926);',
    '  col *= mix(1.0, pow(sl, 1.15), uScan);',
    '',
    '  float mx = gl_FragCoord.x / uMaskSize;',      // 荫罩：RGB 三条一组
    '  vec3 m = vec3(',
    '    0.5 + 0.5 * cos(mx * 2.0943951),',
    '    0.5 + 0.5 * cos((mx - 1.0) * 2.0943951),',
    '    0.5 + 0.5 * cos((mx - 2.0) * 2.0943951));',
    '  col *= mix(vec3(1.0), m * 1.75, uMask);',
    '',
    '  col += bloom(uv) * uBloom;',
    '',
    '  float l = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(vec3(l), col, uSat) * uBright;',
    '',
    '  float vig = 1.0 - uVig * smoothstep(0.10, 1.35, dot(q, q));',
    '  col *= vig;',
    '',
    '  vec2 gq = (uvS - vec2(0.27, 0.20)) * vec2(1.0, 1.55);',
    '  col += vec3(0.85, 0.92, 1.0) * exp(-dot(gq, gq) * 5.0) * uGlare;',
    '',
    '  float bd = fract(uvS.y + uTime * 0.11) - 0.5;',
    '  float bar = exp(-bd * bd * 90.0) * uBar;',
    '  col += bar;',
    '',
    '  col += (hash(uvS * uOut + fract(uTime) * 137.0) - 0.5) * uNoise;',
    '  col *= 1.0 + uFlicker * (sin(uTime * 51.0) * 0.35 + sin(uTime * 17.3) * 0.4 + sin(uTime * 7.1) * 0.25);',
    '',
    '  col *= edge;',
    '  float line = (1.0 - smoothstep(0.0, 0.012, abs(vUv.y - 0.5))) * smoothstep(0.55, 1.0, uCollapse);',
    '  col += vec3(0.9, 0.95, 1.0) * line * edge;',
    '',
    '  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);',
    '}'
  ].join('\n');

  /* ============================== 默认值 ============================== */

  var DEFAULTS = {
    curvature:    0.12,   // 曲面（凹凸）强度 0 ~ 0.4
    scanline:     0.35,   // 扫描线浓度
    scanPeriod:   3,      // 扫描线周期（输出像素）
    mask:         0.32,   // 荫罩浓度
    maskSize:     3,      // 荫罩周期（输出像素）
    aberration:   0.9,    // RGB 色差（源像素）
    bloom:        0.42,   // 荧光辉光
    vignette:     0.42,   // 暗角
    glare:        0.05,   // 玻璃反光
    noise:        0.05,   // 噪点
    flicker:      0.02,   // 闪烁
    bar:          0.05,   // 滚动亮带
    persistence:  0.55,   // 余晖/拖影 0 = 关闭
    jitter:       0.0004, // 垂直同步抖动
    brightness:   1.25,
    saturation:   1.12,
    autoRender:   true,   // 自动每帧合成
    outputScale:  1,      // 输出缓冲 = canvas.width × 此值（Retina 可设 2）
    fallback:     'css',  // 无 WebGL 时：'css' 叠加层 | 'warp' 2D 重采样 | 'none'
    setDisplaySize: true, // 自动写 canvas.style.width/height（用 CSS 控制尺寸时设为 false）
    alpha:        false
  };

  /* ============================== 小工具 ============================== */

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('[CRTDisplay] shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function buildProgram(gl, vsSrc, fsSrc) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('[CRTDisplay] link: ' + gl.getProgramInfoLog(p));
    }
    // 缓存 uniform / attribute 位置
    var u = {}, a = {}, i, n, info;
    n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (i = 0; i < n; i++) { info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (i = 0; i < n; i++) { info = gl.getActiveAttrib(p, i); a[info.name] = gl.getAttribLocation(p, info.name); }
    return { program: p, u: u, a: a };
  }

  function makeTexture(gl, w, h) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  /* ============================== 主体 ============================== */

  function CRTDisplay(canvas, options) {
    if (!canvas || canvas.tagName !== 'CANVAS') throw new Error('[CRTDisplay] 需要一个 <canvas>');
    if (canvas.__crt) return canvas.__crt;                 // 同一 canvas 只包一次

    this.canvas = canvas;
    this.opts = {};
    for (var k in DEFAULTS) this.opts[k] = DEFAULTS[k];
    this.setOptions(options || {});

    this._protoDesc = {
      width:  Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width'),
      height: Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height')
    };
    this._origGetContext = HTMLCanvasElement.prototype.getContext;

    /* 离屏源画布：你画的东西都在这里 */
    this.source = document.createElement('canvas');
    this._proxies = {};
    this._time = 0;
    this._collapse = 0; this._collapseTarget = 0;
    this._power = true;
    this._disposed = false;
    this._frame = this._frame.bind(this);

    this._logicalW = canvas.width  || 300;
    this._logicalH = canvas.height || 150;

    this._patchCanvas();
    this._initGL();
    if (!this.gl) this._initFallback();
    this._syncSize(true);

    canvas.__crt = this;
    if (this.opts.autoRender) this._raf = requestAnimationFrame(this._frame);
  }

  /* ---------- 劫持 canvas.width / height / getContext ---------- */
  CRTDisplay.prototype._patchCanvas = function () {
    var self = this, c = this.canvas;
    var wd = this._protoDesc.width, hd = this._protoDesc.height;

    Object.defineProperty(c, 'width', {
      configurable: true, enumerable: true,
      get: function () { return self._logicalW; },
      set: function (v) { self._logicalW = v | 0; self._syncSize(); }
    });
    Object.defineProperty(c, 'height', {
      configurable: true, enumerable: true,
      get: function () { return self._logicalH; },
      set: function (v) { self._logicalH = v | 0; self._syncSize(); }
    });

    c.getContext = function (type, attrs) { return self._acquire(type, attrs); };
    /* 方便调试：拿到被代理的真实源上下文 */
    c.getCRT = function () { return self; };
  };

  /* ---------- 上下文代理 ---------- */
  CRTDisplay.prototype._acquire = function (type, attrs) {
    type = String(type || '2d').toLowerCase();
    if (this._proxies[type]) return this._proxies[type];

    var isGL = /^(webgl2?|experimental-webgl)$/.test(type);
    if (isGL) {
      attrs = attrs || {};
      if (attrs.preserveDrawingBuffer === undefined) attrs.preserveDrawingBuffer = true;
    }
    var ctx = this.source.getContext(type, attrs);
    if (!ctx) return null;

    var self = this, cache = {};
    var proxy = new Proxy(ctx, {
      get: function (t, p) {
        if (p === 'canvas') return self.canvas;          // 让 ctx.canvas.width 等于逻辑尺寸
        if (p === '__crtSource') return t;
        var v = Reflect.get(t, p, t);
        if (typeof v === 'function') {
          if (!cache[p]) cache[p] = v.bind(t);           // 缓存绑定，避免每帧反复 bind
          return cache[p];
        }
        return v;
      },
      set: function (t, p, v) { Reflect.set(t, p, v, t); return true; }
    });

    this._proxies[type] = proxy;
    if (type === '2d') this._src2d = ctx;
    return proxy;
  };

  /* ---------- WebGL 初始化 ---------- */
  CRTDisplay.prototype._initGL = function () {
    var gl = null;
    try {
      var attrs = { alpha: !!this.opts.alpha, antialias: false, depth: false,
                    stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false };
      gl = this._origGetContext.call(this.canvas, 'webgl', attrs) ||
           this._origGetContext.call(this.canvas, 'experimental-webgl', attrs);
    } catch (e) { gl = null; }
    if (!gl) { this.gl = null; return; }

    /* 着色器编译/链接万一失败（老驱动、被安全策略拦截），也要能优雅降级 */
    try {
      this.present = buildProgram(gl, VERT, FRAG_PRESENT);
      this.persist = buildProgram(gl, VERT, FRAG_PERSIST);
    } catch (e) {
      console.error('[CRTDisplay] ' + e.message + ' —— 已降级为 ' + this.opts.fallback + ' 模式');
      this.gl = null;
      return;
    }

    this.gl = gl;
    this._quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    this._srcTex = makeTexture(gl, 2, 2);
    this._hist = [];
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    var self = this;
    this.canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); self._lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', function () { self._lost = false; });
  };

  /* ---------- 尺寸同步 ---------- */
  CRTDisplay.prototype._syncSize = function (force) {
    var w = Math.max(1, this._logicalW), h = Math.max(1, this._logicalH);
    if (!force && this.source.width === w && this.source.height === h) return;

    this.source.width = w; this.source.height = h;

    var ow = Math.round(w * this.opts.outputScale), oh = Math.round(h * this.opts.outputScale);
    this._protoDesc.width.set.call(this.canvas, ow);
    this._protoDesc.height.set.call(this.canvas, oh);
    /* 用户没用 CSS 指定显示尺寸时，用逻辑尺寸兜底（否则会退回 300x150） */
    if (this.opts.setDisplaySize) {
      if (!this.canvas.style.width)  this.canvas.style.width  = w + 'px';
      if (!this.canvas.style.height) this.canvas.style.height = h + 'px';
    }

    if (this.gl) this._allocHistory(w, h);
    this.onresize && this.onresize(w, h);
  };

  CRTDisplay.prototype._allocHistory = function (w, h) {
    var gl = this.gl, i;
    if (this._hist.length) {
      for (i = 0; i < 2; i++) { gl.deleteTexture(this._hist[i].tex); gl.deleteFramebuffer(this._hist[i].fbo); }
    }
    this._hist = [];
    for (i = 0; i < 2; i++) {
      var tex = makeTexture(gl, w, h);
      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      this._hist.push({ tex: tex, fbo: fbo });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._histIdx = 0;
  };

  /* ---------- 每帧合成 ---------- */
  CRTDisplay.prototype._frame = function (ms) {
    if (this._disposed) return;
    this._time = (ms || 0) * 0.001;
    this._collapse += (this._collapseTarget - this._collapse) * 0.16;
    try { this.render(); } catch (e) { /* 单帧出错不中断循环 */ }
    if (this.opts.autoRender) this._raf = requestAnimationFrame(this._frame);
  };

  CRTDisplay.prototype.render = function () {
    if (this._disposed || this._lost) return;
    var gl = this.gl;
    if (!gl) { this._renderFallback(); return; }
    if (!this._proxies['2d'] && !this._isGLSource()) return;   // 还没取上下文就没东西可画

    var o = this.opts, t = this._time;
    var sw = this.source.width, sh = this.source.height;

    /* ① 上传源画布 */
    gl.bindTexture(gl.TEXTURE_2D, this._srcTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);

    /* ② 余晖：max(当前帧, 历史 × 衰减) */
    var displayTex = this._srcTex;
    if (o.persistence > 0.001) {
      var cur = this._hist[this._histIdx], prev = this._hist[1 - this._histIdx];
      gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo);
      gl.viewport(0, 0, sw, sh);
      gl.useProgram(this.persist.program);
      this._bindQuad(this.persist);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._srcTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(this.persist.u.uCur, 0);
      gl.uniform1i(this.persist.u.uPrev, 1);
      gl.uniform1f(this.persist.u.uFlip, -1);   // 写入 FBO：反向采样，否则画面上下颠倒
      gl.uniform1f(this.persist.u.uDecay, Math.min(0.98, o.persistence));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this._histIdx = 1 - this._histIdx;
      displayTex = cur.tex;
    }

    /* ③ CRT 后处理输出到屏幕 */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    var P = this.present;
    gl.useProgram(P.program);
    this._bindQuad(P);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, displayTex);
    gl.uniform1i(P.u.uTex, 0);
    gl.uniform1f(P.u.uFlip, 1);                // 输出到屏幕：正向采样
    gl.uniform2f(P.u.uSrc, sw, sh);
    gl.uniform2f(P.u.uOut, this.canvas.width, this.canvas.height);
    gl.uniform1f(P.u.uTime, t);
    gl.uniform1f(P.u.uCurvature, o.curvature);
    gl.uniform1f(P.u.uScan, o.scanline);
    gl.uniform1f(P.u.uScanPeriod, o.scanPeriod);
    gl.uniform1f(P.u.uMask, o.mask);
    gl.uniform1f(P.u.uMaskSize, o.maskSize);
    gl.uniform1f(P.u.uAberr, o.aberration);
    gl.uniform1f(P.u.uBloom, o.bloom);
    gl.uniform1f(P.u.uVig, o.vignette);
    gl.uniform1f(P.u.uGlare, o.glare);
    gl.uniform1f(P.u.uNoise, o.noise);
    gl.uniform1f(P.u.uFlicker, o.flicker);
    gl.uniform1f(P.u.uBright, o.brightness);
    gl.uniform1f(P.u.uSat, o.saturation);
    gl.uniform1f(P.u.uJitter, (Math.random() - 0.5) * 2 * o.jitter);
    gl.uniform1f(P.u.uBar, o.bar);
    gl.uniform1f(P.u.uCollapse, this._collapse);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  CRTDisplay.prototype._bindQuad = function (P) {
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quad);
    gl.enableVertexAttribArray(P.a.aPos);
    gl.vertexAttribPointer(P.a.aPos, 2, gl.FLOAT, false, 0, 0);
  };

  CRTDisplay.prototype._isGLSource = function () {
    for (var k in this._proxies) if (/webgl/.test(k)) return true;
    return false;
  };

  /* ---------- 无 WebGL 时的降级 ---------- */
  CRTDisplay.prototype._initFallback = function () {
    this._fb2d = this._origGetContext.call(this.canvas, '2d');
    if (this.opts.fallback === 'css') this._injectCSS();
    console.warn('[CRTDisplay] 未取得 WebGL，已降级为 ' + this.opts.fallback + ' 模式（仍有扫描线/暗角/反光，无曲面畸变）');
  };

  CRTDisplay.prototype._injectCSS = function () {
    if (document.getElementById('__crt_css__')) { this.canvas.classList.add('crt-fallback'); return; }
    var css = [
      '.crt-fallback{border-radius:14px;box-shadow:inset 0 0 26px 8px rgba(0,0,0,.85),inset 0 0 90px 20px rgba(0,0,0,.4);}',
      '.crt-fb-wrap{position:relative;display:inline-block;line-height:0;isolation:isolate;}',
      '.crt-fb-wrap>.crt-fallback{filter:brightness(1.3) saturate(1.1);}',
      '.crt-fb-wrap::before,.crt-fb-wrap::after{content:"";position:absolute;inset:0;border-radius:14px;pointer-events:none;}',
      '.crt-fb-wrap::before{background:repeating-linear-gradient(to bottom,rgba(0,0,0,.38) 0 1px,rgba(0,0,0,0) 1px 3px),',
      'repeating-linear-gradient(90deg,rgba(255,0,0,.25) 0 1px,rgba(0,255,0,.25) 1px 2px,rgba(0,0,255,.25) 2px 3px);',
      'mix-blend-mode:multiply;opacity:.6;z-index:2;}',
      '.crt-fb-wrap::after{background:radial-gradient(120% 100% at 50% 50%,rgba(0,0,0,0) 45%,rgba(0,0,0,.35) 78%,rgba(0,0,0,.9) 100%),',
      'radial-gradient(38% 30% at 26% 18%,rgba(255,255,255,.10),rgba(255,255,255,0) 70%);z-index:3;}'
    ].join('');
    var st = document.createElement('style');
    st.id = '__crt_css__'; st.textContent = css;
    document.head.appendChild(st);

    var wrap = document.createElement('div');
    wrap.className = 'crt-fb-wrap';
    this.canvas.parentNode && this.canvas.parentNode.insertBefore(wrap, this.canvas);
    wrap.appendChild(this.canvas);
    this.canvas.classList.add('crt-fallback');
  };

  CRTDisplay.prototype._renderFallback = function () {
    var ctx = this._fb2d, c = this.canvas;
    if (!ctx) return;
    var w = c.width, h = c.height, src = this.source;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (this.opts.fallback === 'warp') this._warpBlit(ctx, src, w, h);
    else ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
  };

  /* 2D 重采样近似曲面：先按行做水平弯曲，再按列做垂直弯曲 */
  CRTDisplay.prototype._warpBlit = function (ctx, src, w, h) {
    var mid = this._tmp || (this._tmp = document.createElement('canvas'));
    if (mid.width !== w || mid.height !== h) { mid.width = w; mid.height = h; }
    var m = mid.getContext('2d');
    m.clearRect(0, 0, w, h);
    var k = this.opts.curvature, step = 2, x, y, u, v, r2, scale, sy;
    for (y = 0; y < h; y += step) {
      v = (y + step * 0.5) / h * 2 - 1;
      r2 = v * v;                                  // 该行按 u=0 估算水平缩放
      scale = 1 / (1 + k * k * r2);
      m.drawImage(src, 0, y, w, step, (w - w * scale) * 0.5, y, w * scale, step);
    }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    for (x = 0; x < w; x += step) {
      u = (x + step * 0.5) / w * 2 - 1;
      r2 = u * u;
      scale = 1 / (1 + k * k * r2);
      sy = (h - h * scale) * 0.5;
      ctx.drawImage(mid, x, 0, step, h, x, sy, step, h * scale);
    }
  };

  /* ============================== 公开 API ============================== */

  /** 修改参数，例如 crt.setOptions({ curvature: 0.2 }) */
  CRTDisplay.prototype.setOptions = function (o) {
    for (var k in o) if (k in DEFAULTS) this.opts[k] = o[k];
    if (o && ('outputScale' in o)) this._syncSize(true);
    return this;
  };

  /** 手动合成一帧（autoRender:false 时用） */
  CRTDisplay.prototype.draw = CRTDisplay.prototype.render;

  /** 关机 / 开机（带 CRT 关机收缩动画） */
  CRTDisplay.prototype.power = function (on) {
    this._power = on !== false;
    this._collapseTarget = this._power ? 0 : 1;
    return this;
  };

  /** 屏幕坐标（CSS 像素）→ 源画布坐标：畸变后点击位置的正确映射 */
  CRTDisplay.prototype.screenToSource = function (sx, sy) {
    var r = this.canvas.getBoundingClientRect();
    var tu = (sx - r.left) / r.width, tv = (sy - r.top) / r.height;  // 目标：屏幕空间 0~1
    var k = this.opts.curvature, su = tu, sv = tv, i, ox, oy, a, b, cx, cy;
    for (i = 0; i < 8; i++) {              // 定点迭代反解 curve()：找 curve(s) == t
      ox = su * 2 - 1; oy = sv * 2 - 1;
      a = Math.abs(oy) * k; b = Math.abs(ox) * k;
      cx = (ox + ox * a * a) * 0.5 + 0.5;
      cy = (oy + oy * b * b) * 0.5 + 0.5;
      su += (tu - cx); sv += (tv - cy);
      if (Math.abs(tu - cx) < 1e-6 && Math.abs(tv - cy) < 1e-6) break;
    }
    return { x: su * this.source.width, y: sv * this.source.height };
  };

  /** 源画布坐标 → 屏幕坐标（正向 curve） */
  CRTDisplay.prototype.sourceToScreen = function (x, y) {
    var u = x / this.source.width * 2 - 1, v = y / this.source.height * 2 - 1;
    var k = this.opts.curvature;
    var ox = Math.abs(v) * k, oy = Math.abs(u) * k;
    u += u * ox * ox; v += v * oy * oy;
    var r = this.canvas.getBoundingClientRect();
    return { x: (u * 0.5 + 0.5) * r.width + r.left, y: (v * 0.5 + 0.5) * r.height + r.top };
  };

  /** 源画布（想直接操作像素时用） */
  CRTDisplay.prototype.sourceCanvas = function () { return this.source; };

  /** 拆掉包装，恢复原生 canvas */
  CRTDisplay.prototype.dispose = function () {
    if (this._disposed) return;
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    delete this.canvas.width;      // 恢复原型上的 accessor
    delete this.canvas.height;
    delete this.canvas.getContext;
    delete this.canvas.getCRT;
    delete this.canvas.__crt;
    if (this.gl) {
      if (this._hist.length) for (var i = 0; i < 2; i++) {
        this.gl.deleteTexture(this._hist[i].tex); this.gl.deleteFramebuffer(this._hist[i].fbo);
      }
      this.gl.deleteTexture(this._srcTex);
      this.gl.deleteProgram(this.present.program);
      this.gl.deleteProgram(this.persist.program);
      this.gl.deleteBuffer(this._quad);
    }
  };

  CRTDisplay.defaults = DEFAULTS;
  return CRTDisplay;
});
