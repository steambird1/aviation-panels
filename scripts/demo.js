/* =============================================================================
 * demo.js —— 导航显示演示页面逻辑
 * 依赖：navdisplay.js（全局 ND）
 * -----------------------------------------------------------------------------
 * 演示内容包括：
 *   - 航路（含转弯半径圆角）、航路点（下一个点紫色）、导航台 + 径向线、其余点状信息
 *   - 气象雷达 WXR / 地形雷达 TERR（逐像素 Uint8Array）
 *   - HDG / MAP 故障旗、风向风速、可调比例尺、可开关的“其它导航信息区域”
 * ========================================================================== */
(function () {
  'use strict';

  var W = 253, H = 253;
  var canvas = document.getElementById('nd');
  var nd = new ND.NavDisplay(canvas, {});

  /* ---------------------------------------------------------------------------
   * 1. 航路（世界坐标，x = 东 NM，y = 北 NM）
   *    飞机起始位置原点，航向 040，沿 ALPHA -> BRAVO 飞行
   * ------------------------------------------------------------------------ */
  function wp(name, x, y) { return { name: name, x: x, y: y }; }

  var ROUTE_POINTS = [
    wp('ALPHA', -5.14, -6.13),
    wp('BRAVO', 5.14, 6.13),
    wp('CHARLIE', 16.73, 9.24),
    wp('DELTA', 20.15, 18.64),
    wp('ECHO', 30.54, 24.64),
    wp('FOXTROT', 35.54, 33.30)
  ];

  /* 导航台（含径向线方位）与其余点状信息 */
  var NAVAIDS = [
    { kind: 'navaid', navaidType: 'VOR', name: 'XYZ', x: -2, y: 13, radial: 90 },
    { kind: 'navaid', navaidType: 'NDB', name: 'ABC', x: 11, y: 15, radial: 210 },
    { kind: 'navaid', navaidType: 'VOR', name: 'QQQ', x: 18, y: 3, radial: 320 }
  ];
  var POIS = [
    { kind: 'poi', name: 'FIX1', x: 2, y: 17 },
    { kind: 'poi', name: 'FIX2', x: 17, y: 9 },
    { kind: 'poi', name: 'ARPT', x: 9, y: 4 }
  ];

  /* ---------------------------------------------------------------------------
   * 2. 雷达回波源（世界坐标中的椭圆团，用于生成逐像素数据）
   * ------------------------------------------------------------------------ */
  var WXR_CELLS = [
    { x: 12, y: 15, r: 7.5, peak: 1.00, seed: 1.1 },
    { x: 20, y: 6, r: 5.5, peak: 0.85, seed: 2.4 },
    { x: 26, y: 22, r: 6.5, peak: 0.95, seed: 3.7 },
    { x: 4, y: 24, r: 5.0, peak: 0.70, seed: 0.6 }
  ];
  var TERR_CELLS = [
    { x: 10, y: 12, r: 10.0, peak: 1.00, seed: 1.7 },
    { x: 24, y: 20, r: 9.0, peak: 0.90, seed: 2.9 },
    { x: 30, y: 6, r: 7.0, peak: 0.75, seed: 4.2 },
    { x: 2, y: 20, r: 8.0, peak: 0.80, seed: 5.5 }
  ];

  function levelOf(v) {
    if (v < 0.10) return 0;
    if (v < 0.32) return 1;   // 深绿
    if (v < 0.52) return 2;   // 浅绿
    if (v < 0.72) return 3;   // 黄
    if (v < 0.90) return 4;   // 红
    return 5;                 // 深红
  }

  function fieldLevel(cells, x, y) {
    var best = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var dx = (x - c.x) / c.r, dy = (y - c.y) / c.r;
      var d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      var v = (1 - d2) * c.peak;
      v *= 0.72 + 0.28 * Math.sin(x * 1.9 + c.seed) * Math.cos(y * 1.6 - c.seed * 0.7);
      if (v > best) best = v;
    }
    return levelOf(best);
  }

  function colorByLevel(lv) {
    if (lv >= 4) return 'red';
    if (lv >= 2) return 'yellow';
    return 'green';
  }

  /* ---------------------------------------------------------------------------
   * 3. 状态
   * ------------------------------------------------------------------------ */
  var state = {
    heading: 40,
    drift: 0,
    headingFault: false,
    mapFault: false,
    rangeNm: 20,
    windDir: 300,
    windSpeed: 18,
    radarMode: 'wxr',
    arcSpan: 45,
    navaidRadials: true,
    extraInfo: false,
    showNames: true,
    animate: false,
    turnRadius: 2.0,
    s: 8                     // 沿航路已飞距离（NM），8 NM 时飞机在原点
  };

  var radarBuf = new Uint8Array(W * H);   // 逐像素雷达数据：0..5
  var radarMaxLevel = 0;

  /* ---------------------------------------------------------------------------
   * 4. 沿航路行走（用于飞行演示）
   * ------------------------------------------------------------------------ */
  function currentRoute() {
    var pts = ROUTE_POINTS.map(function (p, i) {
      var q = { x: p.x, y: p.y, name: p.name };
      // 中间航路点带转弯半径（首尾点不需要）
      if (i > 0 && i < ROUTE_POINTS.length - 1) q.turnRadius = state.turnRadius;
      return q;
    });
    return pts;
  }

  function flatten(segs) {
    var pts = [], cum = [0], total = 0, i, k;
    for (i = 0; i < segs.length; i++) {
      var sp = segs[i].pts;
      for (k = (i === 0 ? 0 : 1); k < sp.length; k++) {
        pts.push({ x: sp[k].x, y: sp[k].y, leg: segs[i].leg });
      }
    }
    for (i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cum.push(total);
    }
    return { pts: pts, cum: cum, total: total };
  }

  function posAt(walk, s) {
    var n = walk.cum.length;
    var i = 1;
    while (i < n - 1 && walk.cum[i] < s) i++;
    var a = walk.pts[i - 1], b = walk.pts[i];
    var seg = walk.cum[i] - walk.cum[i - 1];
    var t = seg > 1e-9 ? Math.max(0, Math.min(1, (s - walk.cum[i - 1]) / seg)) : 0;
    var dx = b.x - a.x, dy = b.y - a.y;
    return {
      x: a.x + dx * t,
      y: a.y + dy * t,
      leg: b.leg,
      bearing: ND.util.norm360(Math.atan2(dx, dy) * 180 / Math.PI)
    };
  }

  /* ---------------------------------------------------------------------------
   * 5. 生成雷达逐像素数据（屏幕像素 -> 世界坐标 -> 强度等级）
   * ------------------------------------------------------------------------ */
  function updateRadarBuffer() {
    var mode = state.radarMode;
    if (mode === 'off') return;
    var cells = (mode === 'terr') ? TERR_CELLS : WXR_CELLS;

    var walk = flatten(ND.buildRoutePath(currentRoute()));
    var p = posAt(walk, state.s);
    var L = nd.getLayout();
    var track = state.heading + state.drift;
    var t = ND.util.rad(track);
    var ct = Math.cos(t), st = Math.sin(t), scale = L.pxPerNm;
    var cx = L.cx, acY = L.acY, r = L.r;

    radarBuf.fill(0);
    radarMaxLevel = 0;

    for (var y = 0; y < H; y++) {
      var dy = y - acY;
      if (dy < -r || dy > r) continue;                 // 弧外的像素不计算
      var half = Math.sqrt(r * r - dy * dy);
      var x0 = Math.max(0, Math.ceil(cx - half));
      var x1 = Math.min(W - 1, Math.floor(cx + half));
      var uy = (acY - y) / scale;                      // 屏幕上分量(NM)
      for (var x = x0; x <= x1; x++) {
        var ux = (x - cx) / scale;                     // 屏幕右分量(NM)
        var ex = ux * ct + uy * st;                    // 东
        var ny = -ux * st + uy * ct;                   // 北
        var lv = fieldLevel(cells, p.x + ex, p.y + ny);
        radarBuf[y * W + x] = lv;
        if (lv > radarMaxLevel) radarMaxLevel = lv;
      }
    }
  }

  /* ---------------------------------------------------------------------------
   * 6. 组装输入并绘制
   * ------------------------------------------------------------------------ */
  var lastPos = { x: 0, y: 0, leg: 0 };

  function buildInput() {
    var routePts = currentRoute();
    var walk = flatten(ND.buildRoutePath(routePts));
    var p = posAt(walk, state.s);
    lastPos = p;

    return {
      heading: state.heading,
      track: ND.util.norm360(state.heading + state.drift),
      headingFault: state.headingFault,
      mapFault: state.mapFault,
      rangeNm: state.rangeNm,
      aircraft: { x: p.x, y: p.y },
      wind: { dir: state.windDir, speed: state.windSpeed },
      route: { show: true, activeIndex: p.leg + 1, points: routePts },
      points: NAVAIDS.concat(POIS),
      navaidRadials: state.navaidRadials,
      showNames: state.showNames,
      radar: {
        mode: state.radarMode,
        data: radarBuf,
        terrain: {
          lines: [
            { text: '4200', color: colorByLevel(radarMaxLevel) },
            { text: '1800', color: colorByLevel(Math.max(0, radarMaxLevel - 2)) }
          ]
        }
      },
      extraInfo: { show: state.extraInfo, height: 110, side: 'bottom' }
    };
  }

  function render() {
    updateRadarBuffer();
    var input = buildInput();
    nd.draw(input);

    out.hdg.textContent = ND.util.fmt3(input.track);
    out.wpt.textContent = (input.route.points[input.route.activeIndex] || {}).name || '-';
    out.pos.textContent = p2(lastPos.x) + ', ' + p2(lastPos.y);
    out.lvl.textContent = state.radarMode === 'off' ? '-' : String(radarMaxLevel);
  }
  function p2(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  /* ---------------------------------------------------------------------------
   * 7. 界面
   * ------------------------------------------------------------------------ */
  var $ = function (id) { return document.getElementById(id); };
  var out = { hdg: $('outHdg'), wpt: $('outWpt'), pos: $('outPos'), lvl: $('outLvl') };

  function bindRange(id, key, fmt) {
    var el = $(id), lab = $(id + 'Val');
    function sync() {
      state[key] = parseFloat(el.value);
      if (lab) lab.textContent = fmt ? fmt(state[key]) : el.value;
      render();
    }
    el.addEventListener('input', sync);
    return { el: el, lab: lab, sync: sync, fmt: fmt };
  }
  function bindCheck(id, key, after) {
    var el = $(id);
    el.addEventListener('change', function () {
      state[key] = el.checked;
      if (after) after();
      render();
    });
    return el;
  }

  var cHdg = bindRange('rngHdg', 'heading', function (v) { return ND.util.fmt3(v); });
  bindRange('rngDrift', 'drift', function (v) { return (v > 0 ? '+' : '') + v + '°'; });
  bindRange('rngWindDir', 'windDir', function (v) { return ND.util.fmt3(v) + '°'; });
  bindRange('rngWindSpd', 'windSpeed');
  bindRange('rngTurn', 'turnRadius', function (v) { return v.toFixed(1) + ' NM'; });

  bindCheck('chkHdgFault', 'headingFault');
  bindCheck('chkMapFault', 'mapFault');
  bindCheck('chkRadials', 'navaidRadials');
  bindCheck('chkNames', 'showNames');
  bindCheck('chkExtra', 'extraInfo');

  var chkAnimate = bindCheck('chkAnimate', 'animate', function () {
    cHdg.el.disabled = state.animate;
  });

  $('selRange').addEventListener('change', function () {
    state.rangeNm = parseFloat(this.value);
    $('selRangeVal').textContent = state.rangeNm + ' NM';
    render();
  });

  $('selRadar').addEventListener('change', function () {
    state.radarMode = this.value;
    render();
  });

  // 航向弧跨度：跨度越小 -> 弧越平缓、弧上方两个空角越小、地图半径越大
  $('selSpan').addEventListener('change', function () {
    state.arcSpan = parseFloat(this.value);
    nd.setOption('arcSpanDeg', state.arcSpan);
    render();
    $('selSpanVal').textContent = 'r' + nd.getLayout().r.toFixed(0);
  });

  $('chkZoom').addEventListener('change', function () {
    var z = this.checked ? 2 : 1;
    canvas.style.width = (W * z) + 'px';
    canvas.style.height = (H * z) + 'px';
    canvas.style.imageRendering = 'pixelated';
  });

  $('btnReset').addEventListener('click', function () {
    state.s = 8;
    state.heading = 40;
    cHdg.el.value = 40;
    cHdg.lab.textContent = '040';
    render();
  });

  /* 初始化控件显示 */
  $('selRange').value = String(state.rangeNm);
  $('selRangeVal').textContent = state.rangeNm + ' NM';
  $('selRadar').value = state.radarMode;
  $('selSpan').value = String(state.arcSpan);
  $('selSpanVal').textContent = 'r' + nd.getLayout().r.toFixed(0);
  $('rngHdg').value = state.heading;
  $('rngTurn').value = state.turnRadius;
  ['rngHdg', 'rngDrift', 'rngWindDir', 'rngWindSpd', 'rngTurn'].forEach(function (id) {
    var ev = document.createEvent('Event');
    ev.initEvent('input', true, true);
    $(id).dispatchEvent(ev);
  });

  /* ---------------------------------------------------------------------------
   * 8. 飞行演示
   * ------------------------------------------------------------------------ */
  var lastT = 0;
  function loop(ts) {
    if (state.animate) {
      if (!lastT) lastT = ts;
      var dt = Math.min(0.1, (ts - lastT) / 1000);
      lastT = ts;
      var walk = flatten(ND.buildRoutePath(currentRoute()));
      state.s += dt * 3;                       // 3 NM/s
      if (state.s > walk.total) state.s = 0;   // 到终点后回到起点
      var p = posAt(walk, state.s);
      state.heading = Math.round(p.bearing);
      cHdg.el.value = state.heading;
      cHdg.lab.textContent = ND.util.fmt3(state.heading);
      render();
    } else {
      lastT = 0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  render();
})();
