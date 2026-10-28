/*!
 * bubble-level.js — 132 × 132 Canvas 气泡水准仪（Bubble / Spirit Level）
 *
 * 特性：
 *   · 绿色液体管身（渐变 + 端面暗部 + 玻璃反光），管内一颗会移动的气泡
 *   · 刻度线：中央 0 位双线 + 主/次刻度 + 数字标注
 *   · 气泡以「有限速率 + 阻尼弹簧」跟随外部动态给定的读数，带轻微液面抖动
 *   · 可选项：底部读数窗 showReadout、目标读数三角形 showTargetMark（两者默认关闭）
 *
 * 用法：
 *   const lv = new BubbleLevel(canvasEl, { range: 2, speed: 2.4, orientation: 'vertical' });
 *   lv.setReading(-1.2);   // 动态给定读数，气泡按速率跟随
 *   lv.snapTo(0);          // 立即归零
 *   lv.setOption('showReadout', true);     // 打开底部度数窗口
 *   lv.setOption({ showTargetMark: true }); // 打开目标三角形提示
 *   lv.stop(); lv.start();
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BubbleLevel = api.BubbleLevel;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 132; // 设计基准尺寸

  var COLOR = {
    shellTop: '#5d6d78',
    shellMid: '#39444c',
    shellBottom: '#212b31',
    shellEdge: 'rgba(255,255,255,0.16)',
    recess0: '#0d1312',
    recess1: '#1c2624',
    liquid0: '#84dd92',
    liquid1: '#41ab52',
    liquid2: '#1a6f36',
    liquid3: '#093c21',
    bubbleCore: 'rgba(255,255,255,0.98)',
    bubbleMid: 'rgba(228,248,232,0.95)',
    bubbleEdge: 'rgba(146,212,163,0.90)',
    tickMajor: 'rgba(255,255,255,0.92)',
    tickMinor: 'rgba(255,255,255,0.45)',
    zeroMark: '#ffca28',
    glass0: 'rgba(255,255,255,0.30)',
    glass1: 'rgba(255,255,255,0.08)',
    glass2: 'rgba(0,0,0,0.22)',
    panel: '#07120d',
    panelEdge: '#1e3b2a',
    text: '#8ef2a6',
    textDim: '#4f7c64',
    warn: '#ffca28'
  };

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  /** 胶囊形（水准管外形）：中心 (cx,cy)，沿 x 方向长 len，粗 h */
  function capsulePath(ctx, cx, cy, len, h) {
    roundRectPath(ctx, cx - len / 2, cy - h / 2, len, h, h / 2);
  }

  function BubbleLevel(canvas, options) {
    if (!canvas) throw new Error('BubbleLevel: 需要一个 canvas 元素');
    options = options || {};

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = num(options.size, BASE);
    this.dpr = num(options.dpr, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.dpr = clamp(this.dpr, 1, 3);

    // ---- 行为参数 ----
    this.range = Math.abs(num(options.range, 2));          // 满量程（读数单位）
    this.unit = options.unit == null ? '°' : options.unit; // 读数单位符号
    this.speed = Math.abs(num(options.speed, 2.4));        // 最大移动速率（读数单位 / 秒）
    this.stiffness = Math.abs(num(options.stiffness, 26)); // 跟随刚度（越大越“硬”）
    this.dampingRatio = num(options.dampingRatio, 0.62);   // 阻尼比（<1 有轻微过冲，像真气泡）
    this.jitter = Math.abs(num(options.jitter, 0.5));      // 液面抖动强度
    this.vertical = options.orientation === 'vertical';
    // 默认关闭：底部度数读数窗、目标读数三角形提示（均可通过选项或 setOption 打开）
    this.showReadout = options.showReadout === true;
    this.showTargetMark = options.showTargetMark === true;
    this.label = options.label || '';
    this.onFrame = options.onFrame || null;

    // ---- 状态 ----
    var lim = this.range * 1.06;
    this.value = clamp(num(options.value, 0), -lim, lim);   // 当前读数（气泡实际位置）
    this.target = clamp(num(options.target, this.value), -this.range, this.range);
    this.velocity = 0;

    this._raf = null;
    this._last = 0;
    this._acc = 0;
    this._wobble = 0;

    this._resize();
    if (options.autoStart !== false) this.start();
  }

  BubbleLevel.prototype._resize = function () {
    var c = this.canvas;
    var px = Math.round(this.size * this.dpr);
    if (c.width !== px || c.height !== px) { c.width = px; c.height = px; }
    if (!c.style.width) { c.style.width = this.size + 'px'; c.style.height = this.size + 'px'; }
  };

  /** 管体几何（随尺寸等比缩放）。去掉读数窗后管体自动垂直居中 */
  BubbleLevel.prototype._geo = function (u) {
    var cy = this.showReadout ? 54 * u : 66 * u;
    if (this.vertical) {
      return { cx: 66 * u, cy: cy, len: 76 * u, h: 34 * u, bLen: 22 * u, bH: 22 * u };
    }
    return { cx: 66 * u, cy: cy, len: 100 * u, h: 36 * u, bLen: 24 * u, bH: 24 * u };
  };

  /** 气泡中心可移动范围的一半（px） */
  BubbleLevel.prototype._travel = function (u, g) {
    return (g.len - g.bLen) / 2 - 3 * u;
  };

  // ---------------------------------------------------------------- 物理
  BubbleLevel.prototype._step = function (dt) {
    var k = this.stiffness;
    var c = 2 * this.dampingRatio * Math.sqrt(k);
    var err = this.target - this.value;

    // 阻尼弹簧 + 液面扰动（让气泡有“晃”的感觉）
    this._wobble += (Math.random() * 2 - 1) * this.jitter * dt * 6;
    this._wobble *= Math.exp(-dt * 6);

    var a = k * err - c * this.velocity + this._wobble;
    this.velocity += a * dt;

    // 速率限制：气泡不会瞬移
    var maxV = this.speed;
    if (this.velocity > maxV) this.velocity = maxV;
    if (this.velocity < -maxV) this.velocity = -maxV;

    this.value += this.velocity * dt;

    var lim = this.range * 1.02;
    if (this.value > lim) { this.value = lim; this.velocity = 0; }
    if (this.value < -lim) { this.value = -lim; this.velocity = 0; }
  };

  BubbleLevel.prototype._tick = function (now) {
    this._raf = null;
    if (!this._last) this._last = now;
    var dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.25) dt = 0.25;

    this._acc += dt;
    var h = 1 / 120, guard = 0;
    while (this._acc >= h && guard++ < 60) { this._step(h); this._acc -= h; }
    if (guard >= 60) this._acc = 0;

    this.draw();
    if (this.onFrame) this.onFrame(this.value, this.target, this);

    if (this._running) {
      var self = this;
      this._raf = (typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : function (f) { return setTimeout(function () { f(Date.now()); }, 16); }
      )(function (t) { self._tick(t); });
    }
  };

  BubbleLevel.prototype.start = function () {
    if (this._running) return this;
    this._running = true;
    this._last = 0;
    var self = this;
    this._raf = (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : function (f) { return setTimeout(function () { f(Date.now()); }, 16); }
    )(function (t) { self._tick(t); });
    return this;
  };

  BubbleLevel.prototype.stop = function () {
    this._running = false;
    if (this._raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._raf);
    this._raf = null;
    return this;
  };

  BubbleLevel.prototype.destroy = function () {
    this.stop();
    this.onFrame = null;
    return this;
  };

  /** 动态给定读数（气泡按有限速率跟随） */
  BubbleLevel.prototype.setReading = function (v) {
    this.target = clamp(num(v, 0), -this.range, this.range);
    return this;
  };
  BubbleLevel.prototype.setTarget = BubbleLevel.prototype.setReading;

  /** 直接把气泡放到某读数，不经过过渡 */
  BubbleLevel.prototype.snapTo = function (v) {
    this.value = clamp(num(v, 0), -this.range * 1.02, this.range * 1.02);
    this.target = clamp(this.value, -this.range, this.range);
    this.velocity = 0;
    this.draw();
    return this;
  };

  BubbleLevel.prototype.getReading = function () { return this.value; };
  BubbleLevel.prototype.getTarget = function () { return this.target; };
  BubbleLevel.prototype.isLevel = function () { return Math.abs(this.value) < this.range * 0.02; };

  /** 运行时开关：setOption('showReadout', true) / setOption({showTargetMark:true}) */
  BubbleLevel.prototype.setOption = function (key, value) {
    if (typeof key === 'object' && key) {
      for (var k in key) if (Object.prototype.hasOwnProperty.call(key, k)) this[k] = key[k];
    } else {
      this[key] = value;
    }
    this.draw();
    return this;
  };

  // ---------------------------------------------------------------- 绘制
  BubbleLevel.prototype.draw = function () {
    var ctx = this.ctx;
    var u = this.size / BASE;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.lineJoin = 'round';

    var g = this._geo(u);
    this._drawShell(g, u);
    this._drawVial(g, u);
    if (this.showReadout) this._drawReadout(g, u);
  };

  /** 外壳 + 安装凹槽 */
  BubbleLevel.prototype._drawShell = function (g, u) {
    var ctx = this.ctx, S = this.size;
    var x = 5 * u, y = 5 * u, w = S - 10 * u, h = S - 10 * u;

    var sg = ctx.createLinearGradient(0, y, 0, y + h);
    sg.addColorStop(0, COLOR.shellTop);
    sg.addColorStop(0.55, COLOR.shellMid);
    sg.addColorStop(1, COLOR.shellBottom);
    roundRectPath(ctx, x, y, w, h, 13 * u);
    ctx.fillStyle = sg; ctx.fill();
    ctx.lineWidth = 1 * u; ctx.strokeStyle = COLOR.shellEdge; ctx.stroke();

    // 凹槽
    var rw = this.vertical ? g.h + 12 * u : g.len + 12 * u;
    var rh = this.vertical ? g.len + 12 * u : g.h + 12 * u;
    var rx = g.cx - rw / 2, ry = g.cy - rh / 2;
    roundRectPath(ctx, rx, ry, rw, rh, 12 * u);
    var rg = ctx.createLinearGradient(0, ry, 0, ry + rh);
    rg.addColorStop(0, COLOR.recess0);
    rg.addColorStop(1, COLOR.recess1);
    ctx.fillStyle = rg; ctx.fill();
    ctx.lineWidth = 1 * u; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
  };

  /** 水准管：液体 + 气泡 + 刻度 + 玻璃 */
  BubbleLevel.prototype._drawVial = function (g, u) {
    var ctx = this.ctx;
    var L = g.len, H = g.h, R = H / 2;
    var travel = this._travel(u, g);
    var full = this.range || 1;

    var bx = clamp(this.value / full, -1.06, 1.06) * travel;
    var tx = clamp(this.target / full, -1.06, 1.06) * travel;
    var pairX = g.bLen / 2 + 2 * u;   // 中央 0 位双线位置
    var step = travel / full;         // 1 个读数单位对应的像素

    ctx.save();
    ctx.translate(g.cx, g.cy);
    if (this.vertical) ctx.rotate(-Math.PI / 2); // 竖直管：正读数向上

    // ---- 液体 ----
    capsulePath(ctx, 0, 0, L, H);
    ctx.save();
    ctx.clip();

    var lg = ctx.createLinearGradient(0, -R, 0, R);
    lg.addColorStop(0, COLOR.liquid0);
    lg.addColorStop(0.38, COLOR.liquid1);
    lg.addColorStop(0.78, COLOR.liquid2);
    lg.addColorStop(1, COLOR.liquid3);
    ctx.fillStyle = lg;
    ctx.fillRect(-L / 2, -R, L, H);

    // 两端暗部，体现液体装在管里
    var eg = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
    eg.addColorStop(0, 'rgba(0,0,0,0.40)');
    eg.addColorStop(0.14, 'rgba(0,0,0,0)');
    eg.addColorStop(0.86, 'rgba(0,0,0,0)');
    eg.addColorStop(1, 'rgba(0,0,0,0.40)');
    ctx.fillStyle = eg;
    ctx.fillRect(-L / 2, -R, L, H);

    // ---- 气泡 ----
    ctx.beginPath();
    ctx.ellipse(bx, 1.4 * u, g.bLen / 2, g.bH / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3,38,18,0.38)';
    ctx.fill();

    var bg = ctx.createRadialGradient(
      bx - g.bLen * 0.14, -g.bH * 0.2, 0.6 * u,
      bx, 0, g.bLen * 0.56
    );
    bg.addColorStop(0, COLOR.bubbleCore);
    bg.addColorStop(0.5, COLOR.bubbleMid);
    bg.addColorStop(1, COLOR.bubbleEdge);
    ctx.beginPath();
    ctx.ellipse(bx, 0, g.bLen / 2, g.bH / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 1 * u; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
    // 弯液面暗边
    ctx.beginPath();
    ctx.ellipse(bx, 0, g.bLen / 2 - 0.6 * u, g.bH / 2 - 0.6 * u, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(6,52,28,0.30)'; ctx.lineWidth = 1 * u; ctx.stroke();
    // 气泡高光
    ctx.save();
    ctx.translate(bx - g.bLen * 0.2, -g.bH * 0.24);
    ctx.rotate(-0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, g.bLen * 0.17, g.bH * 0.09, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
    ctx.restore();

    // ---- 刻度线 ----
    var halves = Math.round(full * 2);
    ctx.lineCap = 'round';
    for (var i = -halves; i <= halves; i++) {
      var v = i / 2;
      if (Math.abs(v) > full + 1e-9) continue;
      var px = v * step;
      if (Math.abs(px) < pairX + 2 * u) continue;      // 中央区域留给 0 位双线
      var major = Math.abs(v % 1) < 1e-9;
      var half = major ? R * 0.72 : R * 0.40;
      ctx.strokeStyle = major ? COLOR.tickMajor : COLOR.tickMinor;
      ctx.lineWidth = (major ? 1.3 : 0.9) * u;
      ctx.beginPath();
      ctx.moveTo(px, -half); ctx.lineTo(px, half);
      ctx.stroke();
    }

    // 中央 0 位双线
    ctx.strokeStyle = COLOR.zeroMark;
    ctx.lineWidth = 1.4 * u;
    [-pairX, pairX].forEach(function (px) {
      ctx.beginPath();
      ctx.moveTo(px, -R * 0.82); ctx.lineTo(px, R * 0.82);
      ctx.stroke();
    });

    // ---- 玻璃质感 ----
    var gl = ctx.createLinearGradient(0, -R, 0, R);
    gl.addColorStop(0, COLOR.glass0);
    gl.addColorStop(0.26, COLOR.glass1);
    gl.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    gl.addColorStop(0.52, 'rgba(0,0,0,0.10)');
    gl.addColorStop(1, COLOR.glass2);
    ctx.fillStyle = gl;
    ctx.fillRect(-L / 2, -R, L, H);

    ctx.save();
    ctx.rotate(-0.1);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRectPath(ctx, -L / 2 + 7 * u, -R + 2.2 * u, L - 14 * u, 4.6 * u, 2.3 * u);
    ctx.fill();
    ctx.restore();

    ctx.restore(); // end clip

    // ---- 数字标注（在管壁之外，故须在裁剪恢复后绘制；竖管空间不够，跳过）----
    if (!this.vertical) {
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.font = (7.5 * u) + 'px "DejaVu Sans Mono", Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('0', 0, R + 10 * u);
      for (var m = 1; m <= Math.ceil(full); m++) {
        var mx = m * step;
        if (mx > travel + 0.5 * u) break;
        ctx.fillText(String(m), mx, R + 10 * u);
        ctx.fillText('-' + m, -mx, R + 10 * u);
      }
    }

    // ---- 管壁 ----
    capsulePath(ctx, 0, 0, L, H);
    ctx.lineWidth = 2 * u; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
    capsulePath(ctx, 0, 0, L - 1 * u, H - 1 * u);
    ctx.lineWidth = 1 * u; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.stroke();

    // ---- 目标读数指示（外部给定值）----
    if (this.showTargetMark && Math.abs(this.target - this.value) > this.range * 0.008) {
      ctx.save();
      ctx.translate(tx, -R - 6 * u);
      ctx.beginPath();
      ctx.moveTo(0, 3.4 * u); ctx.lineTo(-3 * u, -1.6 * u); ctx.lineTo(3 * u, -1.6 * u);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,202,40,0.85)';
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  };

  /** 底部读数窗 */
  BubbleLevel.prototype._drawReadout = function (g, u) {
    var ctx = this.ctx;
    var y0 = this.vertical ? 102 * u : 86 * u;
    var h = this.vertical ? 20 * u : 32 * u;
    var x = 16 * u, w = this.size - 32 * u;

    roundRectPath(ctx, x, y0, w, h, 5 * u);
    var pg = ctx.createLinearGradient(0, y0, 0, y0 + h);
    pg.addColorStop(0, '#0b1a13');
    pg.addColorStop(1, COLOR.panel);
    ctx.fillStyle = pg; ctx.fill();
    ctx.lineWidth = 1 * u; ctx.strokeStyle = COLOR.panelEdge; ctx.stroke();

    // 状态灯
    var ok = this.isLevel();
    ctx.beginPath();
    ctx.arc(x + 6 * u, y0 + 6.5 * u, 2.2 * u, 0, Math.PI * 2);
    ctx.fillStyle = ok ? '#7cff9d' : 'rgba(120,150,135,0.25)';
    ctx.fill();

    var big = this.vertical ? 12 * u : 15 * u;
    var small = this.vertical ? 6.5 * u : 7.5 * u;
    var mono = '"DejaVu Sans Mono", Menlo, Consolas, monospace';

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ok ? '#b9ffcb' : COLOR.text;
    ctx.font = 'bold ' + big + 'px ' + mono;
    ctx.fillText(fmt(this.value) + this.unit, x + 12 * u, y0 + (this.vertical ? 14 : 21) * u);

    ctx.fillStyle = COLOR.textDim;
    ctx.font = small + 'px ' + mono;
    ctx.textAlign = 'right';
    ctx.fillText('SET ' + fmt(this.target) + this.unit, x + w - 6 * u, y0 + (this.vertical ? 19.5 : 29.5) * u);

    if (this.label && !this.vertical) {
      ctx.textAlign = 'left';
      ctx.fillText(this.label, x + 12 * u, y0 + 29.5 * u);
    }
  };

  function fmt(v) {
    var s = (v >= 0 ? '+' : '-');
    var a = Math.abs(v);
    return s + a.toFixed(2);
  }

  BubbleLevel.BASE = BASE;
  BubbleLevel.COLOR = COLOR;

  return { BubbleLevel: BubbleLevel };
});
