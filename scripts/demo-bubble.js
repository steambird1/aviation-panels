/*!
 * demo.js — 气泡水准仪演示页逻辑
 * 依赖：../scripts/bubble-level.js（提供全局 BubbleLevel）
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var RANGE = 2; // 满量程 ±2°

  var lvH = new BubbleLevel($('lv-h'), {
    range: RANGE,
    unit: '°',
    speed: 2.4,
    label: 'H'
  });

  var lvV = new BubbleLevel($('lv-v'), {
    range: RANGE,
    unit: '°',
    speed: 1.6,
    orientation: 'vertical'
  });

  var levels = [lvH, lvV];

  // ---------------------------------------------------------- 控件
  var elTarget = $('target');
  var elSpeed = $('speed');
  var outTarget = $('out-target');
  var outSpeed = $('out-speed');
  var outNow = $('out-now');
  var outState = $('out-state');

  var mode = 'manual'; // manual | sweep | random
  var timer = null;

  function setTarget(v, syncSlider) {
    v = Math.max(-RANGE, Math.min(RANGE, v));
    levels.forEach(function (lv) { lv.setReading(v); });
    outTarget.textContent = (v >= 0 ? '+' : '') + v.toFixed(2) + '°';
    if (syncSlider !== false) elTarget.value = String(v);
  }

  function setSpeed(v) {
    lvH.speed = v;
    lvV.speed = v * 0.7; // 竖直管液体阻力更大，走得慢一点
    outSpeed.textContent = v.toFixed(1) + ' °/s';
    var s2 = document.getElementById('out-speed2');
    if (s2) s2.textContent = v.toFixed(1);
  }

  function setMode(next) {
    mode = next;
    ['manual', 'sweep', 'random'].forEach(function (m) {
      $('btn-' + m).classList.toggle('active', m === mode);
    });
    if (timer) { clearInterval(timer); timer = null; }
    if (mode === 'random') {
      timer = setInterval(function () {
        setTarget(+(Math.random() * 2 - 1) * RANGE * 0.95);
      }, 900);
      setTarget(+(Math.random() * 2 - 1) * RANGE * 0.95);
    }
    if (mode === 'sweep') {
      timer = setInterval(function () {
        var t = Date.now() / 1000;
        setTarget(RANGE * 0.92 * Math.sin(t * 0.85) * Math.cos(t * 0.27));
      }, 60);
    }
  }

  elTarget.addEventListener('input', function () {
    if (mode !== 'manual') setMode('manual');
    setTarget(parseFloat(elTarget.value), false);
  });

  elSpeed.addEventListener('input', function () {
    setSpeed(parseFloat(elSpeed.value));
  });

  ['manual', 'sweep', 'random'].forEach(function (m) {
    $('btn-' + m).addEventListener('click', function () { setMode(m); });
  });

  document.querySelectorAll('[data-step]').forEach(function (b) {
    b.addEventListener('click', function () {
      setMode('manual');
      setTarget(parseFloat(b.getAttribute('data-step')));
    });
  });

  var paused = false;
  $('btn-pause').addEventListener('click', function () {
    paused = !paused;
    levels.forEach(function (lv) { paused ? lv.stop() : lv.start(); });
    $('btn-pause').textContent = paused ? '继续 ▶' : '暂停 ⏸';
  });

  var zoom = 1;
  $('btn-zoom').addEventListener('click', function () {
    zoom = zoom === 1 ? 2 : 1;
    levels.forEach(function (lv) {
      lv.canvas.style.width = (132 * zoom) + 'px';
      lv.canvas.style.height = (132 * zoom) + 'px';
    });
    $('btn-zoom').textContent = zoom === 1 ? '放大 ×2' : '还原 ×1';
  });

  // ---------------------------------------------------------- 附加显示开关（默认关闭）
  function bindOpt(id, key) {
    var el = $(id);
    el.checked = false;
    el.addEventListener('change', function () {
      levels.forEach(function (lv) { lv.setOption(key, el.checked); });
    });
  }
  bindOpt('opt-readout', 'showReadout');
  bindOpt('opt-target', 'showTargetMark');

  // ---------------------------------------------------------- 状态回显
  setInterval(function () {
    var v = lvH.getReading();
    outNow.textContent = (v >= 0 ? '+' : '') + v.toFixed(3) + '°';
    var d = Math.abs(v - lvH.getTarget());
    outState.textContent = d < 0.02 ? '已稳定 · 气泡居中' : '跟随中 · 偏差 ' + d.toFixed(2) + '°';
    outState.className = 'state ' + (d < 0.02 ? 'ok' : 'busy');
  }, 100);

  // ---------------------------------------------------------- 初始化
  setSpeed(parseFloat(elSpeed.value));
  setMode('manual');
  setTarget(1.2);
  lvH.snapTo(-RANGE);
  lvV.snapTo(-RANGE);
})();
