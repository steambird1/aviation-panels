/*!
 * demo.js —— html/mechanical-gauge.html 的演示逻辑
 * 依赖 scripts/mechanical-gauge.js（页面里先引入仪表脚本，再引入本文件）
 */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  document.addEventListener('DOMContentLoaded', function () {

    /* ---------- 主仪表 ---------- */
    var gauge = new MechanicalGauge($('#gauge'), {
      value: 1500,
      alarm: 6000,
      unit: 'r/min'
    });

    var valueSlider = $('#valueSlider');
    var valueOut = $('#valueOut');
    var alarmSlider = $('#alarmSlider');
    var alarmOut = $('#alarmOut');
    var digitalBox = $('#digitalBox');

    valueSlider.max = gauge.getRange().max;
    alarmSlider.max = gauge.getRange().max;

    function syncOutputs() {
      valueOut.textContent = Math.round(gauge.getValue());
      alarmOut.textContent = Math.round(gauge.getAlarm());
    }

    valueSlider.addEventListener('input', function () {
      stopAuto();
      gauge.setValue(parseFloat(valueSlider.value), false);
      syncOutputs();
    });
    alarmSlider.addEventListener('input', function () {
      stopAuto();
      gauge.setAlarm(parseFloat(alarmSlider.value), false);
      syncOutputs();
    });
    digitalBox.addEventListener('change', function () {
      gauge.showDigital = digitalBox.checked;
      gauge.draw();
    });

    $('#btnZero').addEventListener('click', function () {
      stopAuto(); gauge.setValue(0, true); valueSlider.value = 0; syncOutputs();
    });
    $('#btnFull').addEventListener('click', function () {
      stopAuto(); gauge.setValue(gauge.getRange().max, true);
      valueSlider.value = gauge.getRange().max; syncOutputs();
    });
    $('#btnRandom').addEventListener('click', function () {
      stopAuto();
      var v = Math.round(Math.random() * gauge.getRange().max);
      gauge.setValue(v, true);
      valueSlider.value = v; syncOutputs();
    });

    /* ---------- 自动演示：依次走过四个分段，直观感受非线性刻度 ---------- */
    var sequence = [0, 1000, 2000, 3000, 4000, 5500, 6500, 8000, 3200, 800];
    var seqIndex = 0, timer = null, autoBtn = $('#btnAuto');

    function stepOnce() {
      var v = sequence[seqIndex % sequence.length];
      seqIndex++;
      gauge.setValue(v, true);
      valueSlider.value = v;
      syncOutputs();
    }
    function startAuto() {
      if (timer) return;
      autoBtn.classList.add('on');
      autoBtn.textContent = '停止演示';
      stepOnce();
      timer = setInterval(stepOnce, 1400);
    }
    function stopAuto() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      autoBtn.classList.remove('on');
      autoBtn.textContent = '自动演示';
    }
    autoBtn.addEventListener('click', function () { timer ? stopAuto() : startAuto(); });

    syncOutputs();

    /* ---------- 刻度分段图例（由仪表自身数据生成） ---------- */
    var tbody = $('#legendBody');
    gauge.getScaleInfo().forEach(function (s, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="swatch" style="background:' + s.color + '"></span>第 ' + (i + 1) + ' 段</td>' +
        '<td>' + s.min + ' ~ ' + s.max + '</td>' +
        '<td>' + s.degSpan.toFixed(1) + '°</td>' +
        '<td>' + s.valuePerDeg.toFixed(1) + '</td>' +
        '<td>×' + s.ratio.toFixed(2) + '</td>' +
        '<td>次 ' + s.minorStep + ' / 主 ' + s.majorStep + '</td>';
      tbody.appendChild(tr);
    });

    /* ---------- 四个固定值的对照小表 ---------- */
    $$('canvas[data-value]').forEach(function (cv) {
      new MechanicalGauge(cv, {
        value: parseFloat(cv.getAttribute('data-value')),
        alarm: parseFloat(cv.getAttribute('data-alarm') || '6500'),
        unit: cv.getAttribute('data-unit') || 'r/min'
      });
    });
  });
})();
