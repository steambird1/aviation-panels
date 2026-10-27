/* =============================================================================
 * vnav.js —— 垂直导航（VNAV）面板绘制
 * -----------------------------------------------------------------------------
 * 绘制在「其它导航信息区域」（下方预留区）内。数值计算全部来自 navprofile.js。
 *
 * 用法：由 navdisplay.js 通过 options.extraRenderer 注入并回调：
 *     nd.setOption('extraRenderer', new ND.VNavPanel({...}));
 *
 * 面板布局（rect = 预留区矩形）：
 *   ┌────────┬──────────────────────────────────────────┐
 *   │        │  横轴 = 沿航迹距离（与上半部分同一 pxPerNm） │
 *   │ 高度条 │  白线 = 高度趋势（含加速度的二次曲线）       │
 *   │ (刻度) │  地形填充 = 绿/黄/红（按接近率）            │
 *   │        │  紫色虚线 = 目标高度/升降率轨迹（可分段）    │
 *   │        │  青色虚线 = 最低下降高度 MDA                │
 *   └────────┴──────────────────────────────────────────┘
 *
 * 输入（input.vnav）见 draw() 上方的注释块。
 * ========================================================================== */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VNavPanel = api;
})(typeof self !== 'undefined' ? self : this, function (rootScope) {
  'use strict';

  var NP = (typeof module === 'object' && module.exports)
    ? require('./navprofile.js')
    : (rootScope && rootScope.NavProfile);

  var DEFAULTS = {
    fontFamily: '"Courier New", Courier, monospace',
    fontSizeTick: 8,          // 高度带数字
    fontSizeLabel: 8,         // 航路点名称 / MDA / TGT 标注

    tapeWidth: 36,            // 高度条宽度
    majorTickPx: 22,          // 相邻两个大刻度的像素间距（决定纵向缩放）
    minorPerMajor: 5,         // 两个大刻度之间小刻度分成的份数
    tickMajorLen: 9,
    tickMinorLen: 4,
    showAltReadout: true,     // 中心处的当前高度读数框
    readoutWidth: 26,

    trendWidthRatio: 0.2,     // 趋势线长度 = 剩余宽度 * 该比例（约 1/5）
    trendArrow: true,
    trendArrowLen: 5,

    terrainThresholds: null,  // 缺省用 NavProfile.DEFAULT_THREAT
    terrainSteps: 160,        // 地形采样点数
    profileSteps: 120,

    showMdaLabel: true,
    showTargetLabel: true,

    colors: {
      white: '#ffffff',
      grey: '#909090',
      magenta: '#ff44ff',      // 目标轨迹
      cyan: '#22e0e0',         // MDA
      green: '#30ff30',
      yellow: '#ffd400',
      red: '#ff3c30',
      terrainGreen: '#1f7a1f',
      terrainYellow: '#b08a00',
      terrainRed: '#c02020'
    }
  };

  function merge(base, ext) {
    var out = {}, k;
    if (base) for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (ext) for (k in ext) if (Object.prototype.hasOwnProperty.call(ext, k)) out[k] = ext[k];
    return out;
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function colorOf(colors, name) {
    switch (name) {
      case 'red': return colors.red;
      case 'yellow': return colors.yellow;
      case 'green': return colors.green;
      case 'cyan': return colors.cyan;
      case 'magenta': return colors.magenta;
      default: return colors.white;
    }
  }

  /* ------------------------------------------------------------------------ */
  function VNavPanel(options) {
    this.options = merge(DEFAULTS, options);
  }

  /**
   * 输入（input.vnav）：
   * {
   *   show: true,
   *   majorDivFt: 1000,          // 大刻度分度值（100 / 500 / 1000 / 2000 / 5000）
   *   altFt: 8400,               // 当前高度（ft）
   *   vsMs: 4.0,                 // 垂直速度 m/s（正 = 爬升）
   *   accMs2: 0.15,              // 垂直加速度 m/s²（正 = 爬升率在增大）
   *   groundSpeedMs: 230,        // 地速 m/s（把时间换算成横轴距离）
   *   terrain: {                 // 地形（可为 null）
   *     elevation: Float32Array(W*H),  // 屏幕空间高程（ft），复用地形雷达栅格
   *     sample: function(xNM, yNM)     // 或世界坐标采样函数，返回 ft
   *   },
   *   target: {                  // null -> 不显示
   *     altFt: 6000, rateFpm: -1800,
   *     stages: [{altFt, rateFpm}, ...]   // 可选，分阶段
   *   },
   *   mdaFt: 1200,               // 最低下降高度（ft），null -> 不显示
   *   waypoints: [{name, distNm, altFt?}],   // 沿航迹的航路点
   *   showWaypoints: true
   * }
   */
  VNavPanel.prototype.draw = function (ctx, rect, L, input) {
    var v = input && input.vnav;
    if (!v || v.show === false) return this;
    var o = this.options, C = o.colors;
    var alt0 = isNum(v.altFt) ? v.altFt : 0;
    var majorDiv = isNum(v.majorDivFt) && v.majorDivFt > 0 ? v.majorDivFt : 1000;
    var gs = isNum(v.groundSpeedMs) && v.groundSpeedMs > 1e-6 ? v.groundSpeedMs : 230;

    var x0 = rect.x, y0 = rect.y, rw = rect.w, rh = rect.h;
    var tapeW = Math.min(o.tapeWidth, Math.floor(rw * 0.4));
    var plotX = x0 + tapeW, plotW = rw - tapeW;
    var cy = y0 + rh / 2;                       // 高度条的一半处 = 当前高度
    var pxPerFt = o.majorTickPx / majorDiv;
    var pxPerNm = (L && L.pxPerNm) ? L.pxPerNm : 1;
    var maxDistNm = plotW / pxPerNm;

    function yOf(ft) { return cy - (ft - alt0) * pxPerFt; }
    function xOf(d) { return plotX + d * pxPerNm; }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, rw, rh);
    ctx.clip();
    ctx.textBaseline = 'middle';

    // 与上半部分的分隔线
    ctx.strokeStyle = C.grey;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + 0.5);
    ctx.lineTo(x0 + rw, y0 + 0.5);
    ctx.stroke();

    // ---- 地形 ----
    var prof = null;
    if (v.terrain && !(input && input.mapFault)) {
      var samples = NP.sampleTerrainTrack(v.terrain, {
        L: L, aircraft: (input && input.aircraft) || { x: 0, y: 0 },
        trackDeg: (input && isNum(input.track)) ? input.track : 0,
        maxDistNm: maxDistNm, steps: o.terrainSteps,
        canvasW: (L && L.W) || rect.w, canvasH: (L && L.H) || 253
      });
      prof = NP.terrainProfileWithThreat(samples, {
        alt0Ft: alt0, vsMs: v.vsMs, accMs2: v.accMs2, gsMs: gs
      }, o.terrainThresholds);
      this._drawTerrain(ctx, prof, plotX, plotW, y0, rh, xOf, yOf);
    }

    // ---- 最低下降高度（青色虚线）----
    if (isNum(v.mdaFt)) {
      var ym = yOf(v.mdaFt);
      if (ym > y0 && ym < y0 + rh) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = C.cyan;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotX, ym);
        ctx.lineTo(x0 + rw, ym);
        ctx.stroke();
        ctx.restore();
        if (o.showMdaLabel) {
          ctx.font = o.fontSizeLabel + 'px ' + o.fontFamily;
          ctx.textAlign = 'left';
          ctx.fillStyle = C.cyan;
          ctx.fillText('MDA', plotX + 2, ym - 6);
        }
      }
    }

    // ---- 目标高度 / 目标升降率（紫色虚线，可能分阶段）----
    var stages = NP.normalizeStages(v.target);
    if (stages) {
      var tp = NP.targetProfile(alt0, stages, gs, maxDistNm, o.profileSteps);
      if (tp) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = C.magenta;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (var i = 0; i < tp.length; i++) {
          var px = xOf(tp[i].distNm), py = yOf(tp[i].altFt);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
        // 每个阶段的目标高度处画一个小横线 + 数值
        ctx.font = o.fontSizeLabel + 'px ' + o.fontFamily;
        ctx.fillStyle = C.magenta;
        ctx.textAlign = 'right';
        for (var k = 0; k < stages.length; k++) {
          var ya = yOf(stages[k].altFt);
          if (ya <= y0 || ya >= y0 + rh) continue;
          ctx.save();
          ctx.strokeStyle = C.magenta;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0 + rw - 6, ya);
          ctx.lineTo(x0 + rw, ya);
          ctx.stroke();
          ctx.restore();
          if (o.showTargetLabel) ctx.fillText(String(Math.round(stages[k].altFt)), x0 + rw - 7, ya);
        }
      }
    }

    // ---- 航路点（可开关）----
    if (v.showWaypoints && v.waypoints && v.waypoints.length) {
      this._drawWaypoints(ctx, v.waypoints, plotX, plotW, y0, rh, xOf, maxDistNm);
    }

    // ---- 高度趋势线（白色，含加速度 -> 二次曲线）----
    // 一端固定在高度条的一半处（cy），长度约为剩余宽度的 1/5
    this._drawTrend(ctx, {
      alt0Ft: alt0, vsMs: v.vsMs, accMs2: v.accMs2, gsMs: gs,
      plotX: plotX, plotW: plotW, cy: cy, pxPerNm: pxPerNm, pxPerFt: pxPerFt
    });

    // ---- 高度条（左侧刻度带）----
    this._drawTape(ctx, {
      alt0Ft: alt0, majorDivFt: majorDiv, pxPerFt: pxPerFt, cy: cy,
      x0: x0, tapeW: tapeW, y0: y0, rh: rh
    });

    ctx.restore();
    return this;
  };

  /* ---------------- 地形 ---------------- */
  VNavPanel.prototype._drawTerrain = function (ctx, prof, plotX, plotW, y0, rh, xOf, yOf) {
    var o = this.options, C = o.colors;
    var bottom = y0 + rh;
    var fillOf = {
      green: C.terrainGreen, yellow: C.terrainYellow, red: C.terrainRed
    };
    var lineOf = { green: C.green, yellow: C.yellow, red: C.red };

    // 填充：逐段竖条
    for (var i = 0; i < prof.length; i++) {
      var p = prof[i];
      if (!isNum(p.elevFt)) continue;
      var x = xOf(p.distNm);
      var xn = (i + 1 < prof.length) ? xOf(prof[i + 1].distNm) : plotX + plotW;
      var y = yOf(p.elevFt);
      if (y >= bottom) continue;
      var yy = Math.max(y0, y);
      ctx.fillStyle = fillOf[p.level] || fillOf.green;
      ctx.fillRect(Math.floor(x), yy, Math.max(1, Math.ceil(xn - x)), bottom - yy);
    }
    // 轮廓线
    ctx.lineWidth = 1;
    var started = false;
    for (var k = 0; k < prof.length; k++) {
      var q = prof[k];
      if (!isNum(q.elevFt)) { started = false; continue; }
      var px = xOf(q.distNm), py = yOf(q.elevFt);
      if (py > bottom + 2 || py < y0 - 40) { started = false; continue; }
      if (!started) { ctx.beginPath(); ctx.moveTo(px, py); started = true; }
      else { ctx.lineTo(px, py); }
    }
    if (started) { ctx.strokeStyle = C.green; ctx.stroke(); }
  };

  /* ---------------- 高度趋势线 ---------------- */
  /**
   * 白线：h(d) = h0 + v·t + ½·a·t²，t = d·1852 / 地速。
   * 一端固定在高度条的一半处（cy），横向长度约为剩余宽度的 trendWidthRatio。
   */
  VNavPanel.prototype._drawTrend = function (ctx, p) {
    var o = this.options, C = o.colors;
    var spanPx = p.plotW * o.trendWidthRatio;
    if (!(spanPx > 2)) return;
    var maxDistNm = spanPx / p.pxPerNm;
    var pts = NP.trendProfile(p.alt0Ft, p.vsMs, p.accMs2, p.gsMs, maxDistNm, 40);

    function px(d) { return p.plotX + d * p.pxPerNm; }
    function py(ft) { return p.cy - (ft - p.alt0Ft) * p.pxPerFt; }

    ctx.save();
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = px(pts[i].distNm), y = py(pts[i].altFt);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 末端小箭头，指示变化趋势方向
    if (o.trendArrow && pts.length >= 2) {
      var a = pts[pts.length - 2], b = pts[pts.length - 1];
      var dx = px(b.distNm) - px(a.distNm), dy = py(b.altFt) - py(a.altFt);
      var dl = Math.sqrt(dx * dx + dy * dy);
      if (dl > 1e-6) {
        var ux = dx / dl, uy = dy / dl, L2 = o.trendArrowLen;
        var bx = px(b.distNm), by = py(b.altFt);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - ux * L2 - uy * L2 * 0.5, by - uy * L2 + ux * L2 * 0.5);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - ux * L2 + uy * L2 * 0.5, by - uy * L2 - ux * L2 * 0.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  /* ---------------- 高度条 ---------------- */
  VNavPanel.prototype._drawTape = function (ctx, p) {
    var o = this.options, C = o.colors;
    var edge = p.x0 + p.tapeW;                 // 刻度带右边缘（也是绘图区左边界）
    var top = p.y0, bot = p.y0 + p.rh;

    ctx.save();
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(edge + 0.5, top);
    ctx.lineTo(edge + 0.5, bot);
    ctx.stroke();

    var ticks = NP.altitudeTicks(p.alt0Ft, p.cy, p.pxPerFt, top, bot,
      p.majorDivFt, o.minorPerMajor);
    var i, t;

    // 小刻度
    ctx.strokeStyle = C.grey;
    ctx.beginPath();
    for (i = 0; i < ticks.minor.length; i++) {
      t = ticks.minor[i];
      if (t.y < top || t.y > bot) continue;
      ctx.moveTo(edge - o.tickMinorLen, Math.round(t.y) + 0.5);
      ctx.lineTo(edge, Math.round(t.y) + 0.5);
    }
    ctx.stroke();

    // 大刻度 + 数字
    ctx.font = o.fontSizeTick + 'px ' + o.fontFamily;
    ctx.textAlign = 'right';
    var labelSkip = this._labelSkipPx(p.majorDivFt, p.pxPerFt, o.fontSizeTick);
    var lastLabY = -1e9;
    ctx.strokeStyle = C.white;
    ctx.fillStyle = C.white;
    for (i = 0; i < ticks.major.length; i++) {
      t = ticks.major[i];
      if (t.y < top || t.y > bot) continue;
      var yr = Math.round(t.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(edge - o.tickMajorLen, yr);
      ctx.lineTo(edge, yr);
      ctx.stroke();
      // 读数框位置不画数字（会被框盖住）
      if (o.showAltReadout && Math.abs(t.y - p.cy) < labelSkip * 0.5) continue;
      if (Math.abs(t.y - lastLabY) < o.fontSizeTick + 1) continue;
      ctx.fillText(String(Math.round(t.ft)), edge - o.tickMajorLen - 2, t.y);
      lastLabY = t.y;
    }

    // 中心：当前高度读数框 + 指示三角
    if (o.showAltReadout) {
      var bw = Math.min(o.readoutWidth, p.tapeW - 2), bh = 12;
      var bx = edge - o.tickMajorLen - bw, by = p.cy - bh / 2;
      ctx.fillStyle = '#000000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = C.white;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = C.white;
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(p.alt0Ft)), edge - o.tickMajorLen - 3, p.cy);
      // 指向右的小三角
      ctx.beginPath();
      ctx.moveTo(edge + 1, p.cy - 4);
      ctx.lineTo(edge + 6, p.cy);
      ctx.lineTo(edge + 1, p.cy + 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  VNavPanel.prototype._labelSkipPx = function (majorDivFt, pxPerFt, fontSize) {
    var spacing = Math.abs(majorDivFt * pxPerFt);
    return Math.max(fontSize + 2, spacing);
  };

  /* ---------------- 航路点 ---------------- */
  VNavPanel.prototype._drawWaypoints = function (ctx, wps, plotX, plotW, y0, rh, xOf, maxDistNm) {
    var o = this.options, C = o.colors;
    ctx.save();
    ctx.font = o.fontSizeLabel + 'px ' + o.fontFamily;
    ctx.textAlign = 'left';
    var lastRight = -1e9;
    for (var i = 0; i < wps.length; i++) {
      var w = wps[i];
      if (!isNum(w.distNm) || w.distNm <= 0 || w.distNm > maxDistNm) continue;
      var x = xOf(w.distNm);
      if (x > plotX + plotW) continue;
      // 竖直短虚线
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = C.grey;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y0 + 10);
      ctx.lineTo(Math.round(x) + 0.5, y0 + rh - 2);
      ctx.stroke();
      ctx.restore();
      if (!w.name) continue;
      var tw = ctx.measureText(w.name).width;
      if (x < lastRight + 3) continue;               // 避免名称互相压盖
      ctx.fillStyle = C.white;
      ctx.fillText(w.name, x + 1, y0 + 5);
      lastRight = x + 1 + tw;
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------------ */
  VNavPanel.DEFAULTS = DEFAULTS;
  VNavPanel.prototype.setOption = function (k, v) { this.options[k] = v; return this; };
  VNavPanel.prototype.getOptions = function () { return this.options; };

  return VNavPanel;
});
