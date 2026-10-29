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
    // 分辨率无关：字号与固定像素尺寸按该倍率放大（253 画布时为 1，884x524 时约 1.8）
    uiScale: 1,
    // 大刻度间距单独缩放：面板高度只从 110 增到 135，若按 uiScale 全幅放大，
    // 可见高度带（英尺）反而变窄。默认 1（253 时即 22px）。
    tickScale: 1,
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
      cyan: '#22e0e0',         // 包络（另一份地形数据）
      mda: '#ffd400',          // 最低下降高度（黄）
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
  /** 固定像素尺寸 -> 实际像素 */
  function sz(o, v) { return v * o.uiScale; }
  /** 字号 -> CSS font 字符串 */
  function fontOf(o, px) { return (px * o.uiScale).toFixed(2) + 'px ' + o.fontFamily; }
  /** 线宽：随 uiScale 放大但夹在 [1, 3.5] */
  function lwOf(o, v) { return Math.max(1, Math.min(3.5, v * o.uiScale)); }
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
   *   envelope: {                // 包络：“另一个地形数据”，接口与 terrain 一致（可为 null）
   *     elevation: Float32Array(W*H),   // 屏幕空间（ft）
   *     sample: function(xNM, yNM)      // 或世界坐标采样，返回 ft
   *   },                         // 恒 >= terrain（内部逐点取 max 强制保证）
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
    var tapeW = Math.min(sz(o, o.tapeWidth), Math.floor(rw * 0.4));
    var plotX = x0 + tapeW, plotW = rw - tapeW;
    var cy = y0 + rh / 2;                       // 高度条的一半处 = 当前高度
    var pxPerFt = (o.majorTickPx * o.tickScale) / majorDiv;
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
    ctx.lineWidth = lwOf(o, 1);
    ctx.beginPath();
    ctx.moveTo(x0, y0 + 0.5);
    ctx.lineTo(x0 + rw, y0 + 0.5);
    ctx.stroke();

    // ---- 沿航迹采样（地形 / 包络共用同一组采样点）----
    var sampleOpt = {
      L: L, aircraft: (input && input.aircraft) || { x: 0, y: 0 },
      trackDeg: (input && isNum(input.track)) ? input.track : 0,
      maxDistNm: maxDistNm, steps: o.terrainSteps,
      canvasW: (L && L.W) || rect.w, canvasH: (L && L.H) || 253
    };
    var samples = null, envRaw = null;
    if (!(input && input.mapFault)) {
      if (v.terrain) samples = NP.sampleTerrainTrack(v.terrain, sampleOpt);
      if (v.envelope) envRaw = NP.sampleTerrainTrack(v.envelope, sampleOpt);
    }

    // ---- 地形（填充 + 按接近率着色）----
    if (samples) {
      var prof = NP.terrainProfileWithThreat(samples, {
        alt0Ft: alt0, vsMs: v.vsMs, accMs2: v.accMs2, gsMs: gs
      }, o.terrainThresholds);
      this._drawTerrain(ctx, prof, plotX, plotW, y0, rh, xOf, yOf);
    }

    // ---- 包络（青色曲线，画在地形填充之上）----
    if (envRaw) {
      // envelopeProfile 逐点取 max，保证包络恒 >= 真实地形
      this._drawEnvelope(ctx, NP.envelopeProfile(envRaw, samples),
        plotX, plotW, y0, rh, xOf, yOf);
    }

    // ---- 最低下降高度（黄色虚线）----
    if (isNum(v.mdaFt)) {
      var ym = yOf(v.mdaFt);
      if (ym > y0 && ym < y0 + rh) {
        ctx.save();
        ctx.setLineDash([sz(o, 4), sz(o, 3)]);
        ctx.strokeStyle = C.mda;
        ctx.lineWidth = lwOf(o, 1);
        ctx.beginPath();
        ctx.moveTo(plotX, ym);
        ctx.lineTo(x0 + rw, ym);
        ctx.stroke();
        ctx.restore();
        if (o.showMdaLabel) {
          ctx.font = fontOf(o, o.fontSizeLabel);
          ctx.textAlign = 'left';
          ctx.fillStyle = C.mda;
          ctx.fillText('MDA', plotX + sz(o, 2), ym - sz(o, 6));
        }
      }
    }

    // ---- 目标高度 / 目标升降率（紫色虚线，可能分阶段）----
    var stages = NP.normalizeStages(v.target);
    if (stages) {
      var tp = NP.targetProfile(alt0, stages, gs, maxDistNm, o.profileSteps);
      if (tp) {
        ctx.save();
        ctx.setLineDash([sz(o, 5), sz(o, 4)]);
        ctx.strokeStyle = C.magenta;
        ctx.lineWidth = lwOf(o, 1.2);
        ctx.beginPath();
        for (var i = 0; i < tp.length; i++) {
          var px = xOf(tp[i].distNm), py = yOf(tp[i].altFt);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
        // 每个阶段的目标高度处画一个小横线 + 数值
        ctx.font = fontOf(o, o.fontSizeLabel);
        ctx.fillStyle = C.magenta;
        ctx.textAlign = 'right';
        for (var k = 0; k < stages.length; k++) {
          var ya = yOf(stages[k].altFt);
          if (ya <= y0 || ya >= y0 + rh) continue;
          ctx.save();
          ctx.strokeStyle = C.magenta;
          ctx.lineWidth = lwOf(o, 1);
          ctx.beginPath();
          ctx.moveTo(x0 + rw - sz(o, 6), ya);
          ctx.lineTo(x0 + rw, ya);
          ctx.stroke();
          ctx.restore();
          if (o.showTargetLabel) {
            ctx.fillText(String(Math.round(stages[k].altFt)), x0 + rw - sz(o, 7), ya);
          }
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

    // 与包络曲线使用同一组采样点，逐点连成折线（而不是逐段阶梯填充）。
    // 若按“每段竖条取本段采样值”画阶梯，在陡降处阶梯会保持高位、而包络折线已经降下来，
    // 于是包络曲线会落到地形填充顶边之下（余度小时尤其明显）。
    var pts = [], i;
    for (i = 0; i < prof.length; i++) {
      var p = prof[i];
      if (!isNum(p.elevFt)) { pts.push(null); continue; }   // 无数据 -> 断开
      pts.push({ x: xOf(p.distNm), y: yOf(p.elevFt), level: p.level });
    }

    // 按等级把连续的同色段分组，逐段填充多边形（相邻段共享一条边，避免出现缝隙）
    var a = 0;
    while (a < pts.length) {
      if (!pts[a]) { a++; continue; }
      var lv = pts[a].level, b = a;
      while (b + 1 < pts.length && pts[b + 1] && pts[b + 1].level === lv) b++;
      var end = (b + 1 < pts.length && pts[b + 1]) ? b + 1 : b;   // 多带一点，与下一段共享边
      this._fillRun(ctx, pts, a, end, bottom, fillOf[lv] || fillOf.green);
      a = b + 1;
    }

    // 轮廓线
    ctx.save();
    ctx.strokeStyle = C.green;
    ctx.lineWidth = lwOf(o, 1);
    var started = false;
    for (i = 0; i < pts.length; i++) {
      var q = pts[i];
      if (!q || q.y > bottom + sz(o, 2) || q.y < y0 - sz(o, 40)) { started = false; continue; }
      if (!started) { ctx.beginPath(); ctx.moveTo(q.x, q.y); started = true; }
      else { ctx.lineTo(q.x, q.y); }
    }
    if (started) ctx.stroke();
    ctx.restore();
  };

  /** 用折线顶边填充一段（顶边与包络曲线同源，保证两者不会相互穿越） */
  VNavPanel.prototype._fillRun = function (ctx, pts, a, b, bottom, color) {
    if (b <= a) return;
    // 左右各外扩 0.5px：相邻等级段之间重叠一条边，避免抗锯齿留出暗色缝隙
    var x0 = pts[a].x - 0.5, x1 = pts[b].x + 0.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, pts[a].y);
    for (var i = a + 1; i <= b; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(x1, pts[b].y);
    ctx.lineTo(x1, bottom);
    ctx.lineTo(x0, bottom);
    ctx.closePath();
    ctx.fill();
  };

  /* ---------------- 包络曲线（青色，只画线，不填充）---------------- */
  VNavPanel.prototype._drawEnvelope = function (ctx, prof, plotX, plotW, y0, rh, xOf, yOf) {
    var o = this.options, C = o.colors;
    if (!prof || !prof.length) return;
    var bottom = y0 + rh;
    ctx.save();
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = lwOf(o, 1.2);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < prof.length; i++) {
      var p = prof[i];
      if (!isNum(p.elevFt)) { started = false; continue; }
      var x = xOf(p.distNm), y = yOf(p.elevFt);
      if (y > bottom + sz(o, 4) || y < y0 - sz(o, 60)) { started = false; continue; }
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.restore();
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
    ctx.lineWidth = lwOf(o, 1.5);
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
    ctx.lineWidth = lwOf(o, 1);
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
      ctx.moveTo(edge - sz(o, o.tickMinorLen), Math.round(t.y) + 0.5);
      ctx.lineTo(edge, Math.round(t.y) + 0.5);
    }
    ctx.stroke();

    // 大刻度 + 数字
    ctx.font = fontOf(o, o.fontSizeTick);
    ctx.textAlign = 'right';
    var fsTick = sz(o, o.fontSizeTick);
    var labelSkip = this._labelSkipPx(p.majorDivFt, p.pxPerFt, fsTick);
    var lastLabY = -1e9;
    ctx.strokeStyle = C.white;
    ctx.fillStyle = C.white;
    for (i = 0; i < ticks.major.length; i++) {
      t = ticks.major[i];
      if (t.y < top || t.y > bot) continue;
      var yr = Math.round(t.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(edge - sz(o, o.tickMajorLen), yr);
      ctx.lineTo(edge, yr);
      ctx.stroke();
      // 读数框位置不画数字（会被框盖住）
      if (o.showAltReadout && Math.abs(t.y - p.cy) < labelSkip * 0.5) continue;
      if (Math.abs(t.y - lastLabY) < fsTick + 1) continue;
      ctx.fillText(String(Math.round(t.ft)), edge - sz(o, o.tickMajorLen) - sz(o, 2), t.y);
      lastLabY = t.y;
    }

    // 中心：当前高度读数框 + 指示三角
    if (o.showAltReadout) {
      var bw = Math.min(sz(o, o.readoutWidth), p.tapeW - sz(o, 2)), bh = sz(o, 12);
      var bx = edge - sz(o, o.tickMajorLen) - bw, by = p.cy - bh / 2;
      ctx.fillStyle = '#000000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = C.white;
      ctx.lineWidth = lwOf(o, 1);
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.fillStyle = C.white;
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(p.alt0Ft)), edge - sz(o, o.tickMajorLen) - sz(o, 3), p.cy);
      // 指向右的小三角
      ctx.beginPath();
      ctx.moveTo(edge + sz(o, 1), p.cy - sz(o, 4));
      ctx.lineTo(edge + sz(o, 6), p.cy);
      ctx.lineTo(edge + sz(o, 1), p.cy + sz(o, 4));
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
    ctx.font = fontOf(o, o.fontSizeLabel);
    ctx.textAlign = 'left';
    var lastRight = -1e9;
    for (var i = 0; i < wps.length; i++) {
      var w = wps[i];
      if (!isNum(w.distNm) || w.distNm <= 0 || w.distNm > maxDistNm) continue;
      var x = xOf(w.distNm);
      if (x > plotX + plotW) continue;
      // 竖直短虚线
      ctx.save();
      ctx.setLineDash([sz(o, 2), sz(o, 3)]);
      ctx.strokeStyle = C.grey;
      ctx.lineWidth = lwOf(o, 1);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y0 + sz(o, 10));
      ctx.lineTo(Math.round(x) + 0.5, y0 + rh - sz(o, 2));
      ctx.stroke();
      ctx.restore();
      if (!w.name) continue;
      var tw = ctx.measureText(w.name).width;
      if (x < lastRight + sz(o, 3)) continue;        // 避免名称互相压盖
      ctx.fillStyle = C.white;
      ctx.fillText(w.name, x + sz(o, 1), y0 + sz(o, 5));
      lastRight = x + sz(o, 1) + tw;
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------------ */
  VNavPanel.DEFAULTS = DEFAULTS;
  VNavPanel.prototype.setOption = function (k, v) { this.options[k] = v; return this; };
  VNavPanel.prototype.getOptions = function () { return this.options; };

  return VNavPanel;
});
