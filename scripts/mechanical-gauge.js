/*!
 * mechanical-gauge.js
 * 132 × 132 机械指针仪表（非线性四段刻度 0 ~ 8000）
 *
 * 刻度特性：
 *   0~2000 / 2000~4000 / 4000~6000 / 6000~8000 四段「分别分段」绘制，
 *   四段占的圆心角依次递减（权重 1 : 0.7 : 0.49 : 0.343），
 *   因此指针走过同样的弧长，越靠后的分段代表的数值变化越大。
 *
 * 指针：
 *   白色指针    = 当前值
 *   红白相间指针 = 警戒值（设定值 / 报警阈值）
 *
 * 用法（无依赖，纯 Canvas 2D）：
 *   var g = new MechanicalGauge(canvasEl, { value: 1800, alarm: 6000, unit: 'r/min' });
 *   g.setValue(5200, true);   // 第二个参数为 true 时带机械阻尼动画
 *   g.setAlarm(6500, true);
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var BASE = 132;                            // 设计基准尺寸 132 × 132
  var CX = BASE / 2, CY = BASE / 2;

  var START_ANGLE = Math.PI * 135 / 180;     // 刻度起点：左下方
  var SWEEP_ANGLE = Math.PI * 270 / 180;     // 总扫过角 270°，缺口留在正下方

  // 几何尺寸（均以 132 × 132 为基准，绘制时按实际尺寸等比缩放）
  var GEO = {
    bezelOuter: 65.5,   // 表壳外圈
    bezelInner: 60,     // 表盘直径
    bandR: 57,          // 分段色带半径
    bandW: 4,           // 分段色带宽度
    tickOut: 54,        // 刻度线外端
    majorLen: 8.5,      // 主刻度长度
    majorW: 1.7,
    minorLen: 4,        // 次刻度长度
    minorW: 0.9,
    boundLen: 11,       // 分段界线的加长刻度
    labelR: 38.5,       // 数字标签半径
    needleTip: 47,      // 白色指针长度
    needleW: 3.8,       // 白色指针根部半宽
    needleTail: 14,     // 白色指针尾长（配重）
    needleTailW: 2.2,
    alarmBase: 7,       // 警戒指针起点
    alarmTip: 52.5,     // 警戒指针长度（伸到刻度区，便于对准读数）
    alarmW: 2.6,        // 警戒指针根部半宽
    alarmTipW: 0.9,
    hub: 7.5            // 中心轴
  };

  // 四段刻度的默认定义：weight 为占角权重，越小 → 同样的角位移代表的数值越大
  function defaultSegments() {
    return [
      { min: 0,    max: 2000, weight: 1.000, minorStep: 100, majorStep: 500,  color: '#35c46a' },
      { min: 2000, max: 4000, weight: 0.700, minorStep: 200, majorStep: 500,  color: '#ffd24a' },
      { min: 4000, max: 6000, weight: 0.490, minorStep: 250, majorStep: 1000, color: '#ff9a3c' },
      { min: 6000, max: 8000, weight: 0.343, minorStep: 500, majorStep: 1000, color: '#ff4b4b' }
    ];
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ *
   *  刻度换算
   * ------------------------------------------------------------------ */

  function buildScale(list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].weight;
    var acc = 0;
    for (i = 0; i < list.length; i++) {
      list[i].t0 = acc / total;
      acc += list[i].weight;
      list[i].t1 = acc / total;
      list[i].degSpan = (list[i].t1 - list[i].t0) * SWEEP_ANGLE * 180 / Math.PI;
    }
    return list;
  }

  /* ------------------------------------------------------------------ *
   *  构造
   * ------------------------------------------------------------------ */

  function MechanicalGauge(canvas, options) {
    if (!canvas) throw new Error('MechanicalGauge: 需要传入 canvas 元素');
    options = options || {};

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = options.size || BASE;
    this.unit = options.unit || 'r/min';
    this.showDigital = options.showDigital === true;

    this.segments = buildScale(options.segments || defaultSegments());
    this.rangeMin = this.segments[0].min;
    this.rangeMax = this.segments[this.segments.length - 1].max;

    this.value = clamp(options.value != null ? options.value : 0, this.rangeMin, this.rangeMax);
    this.alarm = clamp(options.alarm != null ? options.alarm : this.rangeMax * 0.75,
                       this.rangeMin, this.rangeMax);
    this.targetValue = this.value;
    this.targetAlarm = this.alarm;
    this.velValue = 0;
    this.velAlarm = 0;

    // 机械阻尼参数：轻微过冲后回稳，模拟真实指针
    this.stiffness = options.stiffness || 0.16;
    this.damping = options.damping || 0.70;

    this._raf = null;
    this._resize();
    this.draw();
  }

  MechanicalGauge.prototype._resize = function () {
    var dpr = (global.devicePixelRatio || 1);
    var s = this.size;
    this.canvas.width = Math.round(s * dpr);
    this.canvas.height = Math.round(s * dpr);
    this.canvas.style.width = s + 'px';
    this.canvas.style.height = s + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  MechanicalGauge.prototype.setSize = function (px) {
    this.size = px;
    this._resize();
    this.draw();
    return this;
  };

  MechanicalGauge.prototype.getRange = function () {
    return { min: this.rangeMin, max: this.rangeMax };
  };

  MechanicalGauge.prototype.getValue = function () { return this.value; };
  MechanicalGauge.prototype.getAlarm = function () { return this.alarm; };

  /** 数值 → 归一化角度位置 [0,1]（分段线性，段内等分） */
  MechanicalGauge.prototype.valueToT = function (v) {
    var segs = this.segments;
    v = clamp(v, this.rangeMin, this.rangeMax);
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (v <= s.max || i === segs.length - 1) {
        var f = clamp((v - s.min) / (s.max - s.min), 0, 1);
        return s.t0 + (s.t1 - s.t0) * f;
      }
    }
    return 0;
  };

  /** 数值 → canvas 弧度 */
  MechanicalGauge.prototype.valueToAngle = function (v) {
    return START_ANGLE + SWEEP_ANGLE * this.valueToT(v);
  };

  /** 四段刻度信息，便于外部生成图例 */
  MechanicalGauge.prototype.getScaleInfo = function () {
    var first = this.segments[0];
    return this.segments.map(function (s) {
      return {
        min: s.min,
        max: s.max,
        degSpan: s.degSpan,
        valuePerDeg: (s.max - s.min) / s.degSpan,
        ratio: first.degSpan / s.degSpan,   // 相对第一段的「读数放大倍率」
        minorStep: s.minorStep,
        majorStep: s.majorStep,
        color: s.color
      };
    });
  };

  MechanicalGauge.prototype.setValue = function (v, animate) {
    this.targetValue = clamp(v, this.rangeMin, this.rangeMax);
    if (!animate) {
      this.value = this.targetValue;
      this.velValue = 0;
      this._requestFrame();
    } else {
      this._loop();
    }
    return this;
  };

  MechanicalGauge.prototype.setAlarm = function (v, animate) {
    this.targetAlarm = clamp(v, this.rangeMin, this.rangeMax);
    if (!animate) {
      this.alarm = this.targetAlarm;
      this.velAlarm = 0;
      this._requestFrame();
    } else {
      this._loop();
    }
    return this;
  };

  MechanicalGauge.prototype.isAlarm = function () {
    return this.value >= this.alarm;
  };

  MechanicalGauge.prototype.destroy = function () {
    if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = null; }
  };

  MechanicalGauge.prototype._requestFrame = function () {
    var self = this;
    if (this._raf) return;
    this._raf = global.requestAnimationFrame(function () {
      self._raf = null;
      self.draw();
    });
  };

  MechanicalGauge.prototype._loop = function () {
    var self = this;
    if (this._raf) return;
    this._raf = global.requestAnimationFrame(function step() {
      var k = self.stiffness, d = self.damping;

      self.velValue = (self.velValue + (self.targetValue - self.value) * k) * d;
      self.value += self.velValue;
      self.velAlarm = (self.velAlarm + (self.targetAlarm - self.alarm) * k) * d;
      self.alarm += self.velAlarm;

      var settled =
        Math.abs(self.targetValue - self.value) < 1 && Math.abs(self.velValue) < 1 &&
        Math.abs(self.targetAlarm - self.alarm) < 1 && Math.abs(self.velAlarm) < 1;

      if (settled) {
        self.value = self.targetValue; self.velValue = 0;
        self.alarm = self.targetAlarm; self.velAlarm = 0;
        self._raf = null;
        self.draw();
        return;
      }
      self.draw();
      self._raf = global.requestAnimationFrame(step);
    });
  };

  /* ------------------------------------------------------------------ *
   *  绘制
   * ------------------------------------------------------------------ */

  MechanicalGauge.prototype.draw = function () {
    var ctx = this.ctx, s = this.size;
    ctx.save();
    ctx.clearRect(0, 0, s, s);
    ctx.scale(s / BASE, s / BASE);
    this._drawFace();
    this._drawSegmentBands();
    this._drawTicks();
    this._drawLabels();
    this._drawAlarmNeedle();
    this._drawMainNeedle();
    this._drawHub();
    this._drawReadout();
    this._drawGlass();
    ctx.restore();
  };

  // 表壳 + 表盘
  MechanicalGauge.prototype._drawFace = function () {
    var ctx = this.ctx;
    var bez = ctx.createLinearGradient(
      CX - GEO.bezelOuter, CY - GEO.bezelOuter,
      CX + GEO.bezelOuter, CY + GEO.bezelOuter);
    bez.addColorStop(0, '#f4f6f9');
    bez.addColorStop(0.32, '#adb4be');
    bez.addColorStop(0.62, '#5c636e');
    bez.addColorStop(1, '#1d2128');
    ctx.beginPath();
    ctx.arc(CX, CY, GEO.bezelOuter, 0, TAU);
    ctx.fillStyle = bez;
    ctx.fill();

    var dial = ctx.createRadialGradient(CX - 14, CY - 16, 4, CX, CY, GEO.bezelInner + 2);
    dial.addColorStop(0, '#2f353e');
    dial.addColorStop(0.55, '#1b1f26');
    dial.addColorStop(1, '#0d1015');
    ctx.beginPath();
    ctx.arc(CX, CY, GEO.bezelInner, 0, TAU);
    ctx.fillStyle = dial;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(CX, CY, GEO.bezelInner - 0.6, 0, TAU);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.stroke();
  };

  // 四段彩色圆弧（段间留出小缺口，体现「分别分段」）
  MechanicalGauge.prototype._drawSegmentBands = function () {
    var ctx = this.ctx, segs = this.segments;
    var gap = 0.013; // 弧度
    ctx.lineCap = 'butt';
    for (var i = 0; i < segs.length; i++) {
      var a0 = START_ANGLE + SWEEP_ANGLE * segs[i].t0 + gap;
      var a1 = START_ANGLE + SWEEP_ANGLE * segs[i].t1 - gap;
      ctx.beginPath();
      ctx.arc(CX, CY, GEO.bandR, a0, a1);
      ctx.lineWidth = GEO.bandW;
      ctx.strokeStyle = segs[i].color;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  // 刻度线：每段独立的主/次刻度密度
  MechanicalGauge.prototype._drawTicks = function () {
    var ctx = this.ctx, segs = this.segments;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var steps = Math.round((s.max - s.min) / s.minorStep);
      for (var k = 0; k <= steps; k++) {
        var v = s.min + k * s.minorStep;
        var isBoundary = (k === 0 || k === steps);
        var isMajor = (Math.round(v) % s.majorStep === 0);
        var len = isBoundary ? GEO.boundLen : (isMajor ? GEO.majorLen : GEO.minorLen);
        var wid = isBoundary ? 2.0 : (isMajor ? GEO.majorW : GEO.minorW);
        var col = isBoundary ? 'rgba(255,255,255,.95)'
                             : (isMajor ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.38)');
        this._tick(v, len, wid, col);
      }
    }
  };

  MechanicalGauge.prototype._tick = function (v, len, wid, color) {
    var ctx = this.ctx;
    var a = this.valueToAngle(v);
    var c = Math.cos(a), s = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(CX + c * GEO.tickOut, CY + s * GEO.tickOut);
    ctx.lineTo(CX + c * (GEO.tickOut - len), CY + s * (GEO.tickOut - len));
    ctx.lineWidth = wid;
    ctx.strokeStyle = color;
    ctx.lineCap = 'butt';
    ctx.stroke();
  };

  // 数字标签：每 1000 一个
  MechanicalGauge.prototype._drawLabels = function () {
    var ctx = this.ctx;
    ctx.font = 'bold 8px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var step = 1000;
    for (var v = this.rangeMin; v <= this.rangeMax + 0.5; v += step) {
      var val = Math.round(v);
      var isBoundary = this.segments.some(function (s) {
        return val === s.min || val === s.max;
      });
      var a = this.valueToAngle(val);
      var x = CX + Math.cos(a) * GEO.labelR;
      var y = CY + Math.sin(a) * GEO.labelR;
      ctx.fillStyle = isBoundary ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.6)';
      ctx.fillText(String(val), x, y);
    }
  };

  // 警戒指针：红白相间
  MechanicalGauge.prototype._drawAlarmNeedle = function () {
    var ctx = this.ctx;
    var a = this.valueToAngle(this.alarm);
    var c = Math.cos(a), s = Math.sin(a);
    var px = -s, py = c;                       // 垂直方向
    var r0 = GEO.alarmBase, r1 = GEO.alarmTip;
    var w0 = GEO.alarmW, w1 = GEO.alarmTipW;
    var bands = 7;
    var colors = ['#e6232b', '#f2f4f7'];

    function quad(f0, f1, overlap) {
      var a0 = r0 + (r1 - r0) * f0;
      var a1 = r0 + (r1 - r0) * f1 + overlap;
      var h0 = w0 + (w1 - w0) * f0;
      var h1 = w0 + (w1 - w0) * f1;
      ctx.beginPath();
      ctx.moveTo(CX + c * a0 + px * h0, CY + s * a0 + py * h0);
      ctx.lineTo(CX + c * a1 + px * h1, CY + s * a1 + py * h1);
      ctx.lineTo(CX + c * a1 - px * h1, CY + s * a1 - py * h1);
      ctx.lineTo(CX + c * a0 - px * h0, CY + s * a0 - py * h0);
      ctx.closePath();
    }

    ctx.save();
    // 先画带阴影的整体轮廓，避免色带之间出现阴影接缝
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 2.5;
    ctx.shadowOffsetX = 1.2;
    ctx.shadowOffsetY = 1.8;
    quad(0, 1, 0);
    ctx.fillStyle = '#f2f4f7';
    ctx.fill();
    ctx.restore();

    ctx.save();
    for (var i = 0; i < bands; i++) {
      quad(i / bands, (i + 1) / bands, i === bands - 1 ? 0 : 0.35);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
    }
    ctx.restore();

    // 细轮廓，增强机械感
    ctx.save();
    quad(0, 1, 0);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.stroke();
    ctx.restore();
  };

  // 当前值指针：白色
  MechanicalGauge.prototype._drawMainNeedle = function () {
    var ctx = this.ctx;
    var a = this.valueToAngle(this.value);
    var c = Math.cos(a), s = Math.sin(a);
    var px = -s, py = c;
    var tip = GEO.needleTip, w = GEO.needleW;
    var tail = GEO.needleTail, tw = GEO.needleTailW;

    ctx.beginPath();
    ctx.moveTo(CX + c * tip, CY + s * tip);
    ctx.lineTo(CX + px * w, CY + py * w);
    ctx.lineTo(CX - c * tail + px * tw, CY - s * tail + py * tw);
    ctx.lineTo(CX - c * tail - px * tw, CY - s * tail - py * tw);
    ctx.lineTo(CX - px * w, CY - py * w);
    ctx.closePath();

    var g = ctx.createLinearGradient(
      CX + px * w, CY + py * w,
      CX - px * w, CY - py * w);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#eef1f5');
    g.addColorStop(1, '#b9c0c9');

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1.5;
    ctx.shadowOffsetY = 2.2;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.stroke();
  };

  // 中心轴
  MechanicalGauge.prototype._drawHub = function () {
    var ctx = this.ctx;
    var g = ctx.createRadialGradient(CX - 2.5, CY - 3, 0.5, CX, CY, GEO.hub);
    g.addColorStop(0, '#fdfdfd');
    g.addColorStop(0.5, '#b9bfc7');
    g.addColorStop(1, '#565c65');
    ctx.beginPath();
    ctx.arc(CX, CY, GEO.hub, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CX, CY, 3.2, 0, TAU);
    ctx.fillStyle = '#1e222a';
    ctx.fill();
  };

  // 底部数字读数窗（超警戒时变红）
  MechanicalGauge.prototype._drawReadout = function () {
    if (!this.showDigital) return;
    var ctx = this.ctx;
    var w = 46, h = 15, x = CX - w / 2, y = 99;
    var alarming = this.isAlarm();

    roundRect(ctx, x, y, w, h, 3);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fill();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = alarming ? 'rgba(255,90,90,.9)' : 'rgba(255,255,255,.18)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px Consolas, Menlo, "SF Mono", monospace';
    ctx.fillStyle = alarming ? '#ff5b5b' : '#ffd15c';
    ctx.fillText(String(Math.round(this.value)), CX, y + h / 2 + 0.5);

    ctx.font = '7px Arial, Helvetica, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.fillText(this.unit, CX, y - 6);
  };

  // 玻璃反光
  MechanicalGauge.prototype._drawGlass = function () {
    var ctx = this.ctx;
    var g = ctx.createRadialGradient(CX - 16, CY - 20, 3, CX - 6, CY - 8, 68);
    g.addColorStop(0, 'rgba(255,255,255,.13)');
    g.addColorStop(0.45, 'rgba(255,255,255,.04)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(CX, CY, GEO.bezelInner, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
  };

  MechanicalGauge.BASE = BASE;
  MechanicalGauge.defaultSegments = defaultSegments;

  global.MechanicalGauge = MechanicalGauge;
})(typeof window !== 'undefined' ? window : this);
