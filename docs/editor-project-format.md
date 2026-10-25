# 驾驶舱界面编辑器项目文件格式

本文档描述 `editor.html` 导出的 JSON 项目文件格式，以及如何从代码中加载和渲染项目。

- 文件类型：JSON
- 编码：UTF-8
- 当前版本：`1`
- 建议扩展名：`.json`
- 项目文件只描述**界面结构与初始状态**，不包含事件代码。

---

## 1. 顶层结构

```json
{
  "version": 1,
  "name": "未命名项目",
  "panels": []
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `version` | number | 否 | `1` | 项目格式版本。当前只支持 v1，读取时会被规范化为 `1`。 |
| `name` | string | 否 | `"未命名项目"` | 项目名称，用于编辑器显示和导出文件名。 |
| `panels` | array | **是** | — | 面板数组，至少需要包含一个面板。 |

### TypeScript 结构

```ts
interface EditorProject {
  version: number;
  name: string;
  panels: EditorPanel[];
}

interface EditorPanel {
  id: string;
  columns: number;
  rows: number;
  cellSize: number;
  gap: number;
  components: EditorComponent[];
}

interface EditorComponent {
  id: string;
  type: ComponentType;
  grid: GridPosition;
  props: Record<string, unknown>;
}

interface GridPosition {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

type ComponentType =
  | 'ButtonSimple'
  | 'ButtonWithLights'
  | 'IndicatorLight'
  | 'IndicatorLightGroup'
  | 'KnobDiscrete'
  | 'KnobContinuous'
  | 'KnobInfinite'
  | 'Lever'
  | 'LeverContinuous'
  | 'Display';
```

---

## 2. 面板（Panel）

```json
{
  "id": "main-panel",
  "columns": 16,
  "rows": 10,
  "cellSize": 46,
  "gap": 8,
  "components": []
}
```

| 字段 | 类型 | 必填 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `id` | string | 否 | `panel-N` | 全局唯一 | 面板 ID，用于面板选择、调试和引用。 |
| `columns` | number | 否 | `16` | `1 ~ 64` | 网格列数。 |
| `rows` | number | 否 | `10` | `1 ~ 64` | 网格行数。 |
| `cellSize` | number | 否 | `46` | `20 ~ 160` | 单元格边长，单位 px。 |
| `gap` | number | 否 | `8` | `0 ~ 40` | 单元格间距，单位 px。 |
| `components` | array | 否 | `[]` | — | 面板内的组件数组。 |

### 面板像素尺寸

```text
面板内容宽度 = columns × cellSize + (columns - 1) × gap
面板内容高度 = rows × cellSize + (rows - 1) × gap
```

面板还包含 CSS 内边距和边框，因此实际 DOM 尺寸会略大。

### 网格坐标

网格坐标从 `1` 开始：

- `row = 1` 表示第一行
- `col = 1` 表示第一列
- 组件占据：

```text
行范围：row ~ row + rowSpan - 1
列范围：col ~ col + colSpan - 1
```

编辑器默认不允许组件重叠。导入已有项目时如果检测到重叠，会给出提示，但不会自动修改组件位置。

---

## 3. 组件通用结构

```json
{
  "id": "btn-ap1",
  "type": "ButtonSimple",
  "grid": {
    "row": 1,
    "col": 1,
    "rowSpan": 1,
    "colSpan": 2
  },
  "props": {
    "text": "AP1",
    "label": "AUTOPILOT 1",
    "labelPosition": "top",
    "labelOrientation": "horizontal"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 否 | 组件实例 ID，项目中全局唯一。会用于 `updateDisplay()`、`getComponentByName()` 等 API。 |
| `type` | string | **是** | 组件类型，必须是下方支持的类型之一。 |
| `grid` | object | 否 | 网格位置与跨度。缺省为 `1 × 1`，位于左上角。 |
| `props` | object | 否 | 组件构造参数。缺失字段会使用该类型的默认值。 |

### grid 字段

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `row` | number | `1` | 起始行，从 1 开始。 |
| `col` | number | `1` | 起始列，从 1 开始。 |
| `rowSpan` | number | `1` | 跨越行数，最小为 1。 |
| `colSpan` | number | `1` | 跨越列数，最小为 1。 |

编辑器会确保网格范围不超出所在面板。如果导入文件中的范围越界，会被自动收拢到面板边界内。

---

## 4. 通用文本标识属性

所有组件都支持以下标签属性：

| 字段 | 类型 | 默认值 | 可选值 | 说明 |
| --- | --- | --- | --- | --- |
| `label` | string | 因组件而异 | — | 组件外部文本标签。空字符串表示不显示。 |
| `labelPosition` | string | `"top"` | `"top"` / `"bottom"` / `"left"` / `"right"` | 标签相对组件的位置。 |
| `labelOrientation` | string | `"horizontal"` | `"horizontal"` / `"vertical"` | 标签文字方向。`vertical` 仅在标签位于左侧或右侧时生效。 |

---

## 5. 颜色格式

颜色字段支持两种写法：

1. 内置颜色名：

```json
"green"
"amber"
"blue"
"red"
"white"
"cyan"
```

2. 任意合法 CSS 颜色：

```json
"#ff8800"
"rgba(255, 136, 0, 0.9)"
```

内置颜色名对应组件库中的 CSS 变量，例如：

| 颜色名 | CSS 变量 |
| --- | --- |
| `green` | `var(--color-green)` |
| `amber` | `var(--color-amber)` |
| `blue` | `var(--color-blue)` |
| `red` | `var(--color-red)` |
| `white` | `var(--color-white)` |
| `cyan` | `var(--color-cyan)` |

---

## 6. 组件类型

支持的 `type`：

| type | 中文名称 | 默认网格 |
| --- | --- | --- |
| `ButtonSimple` | 普通按钮 | `2 × 1` |
| `ButtonWithLights` | 带灯按钮 | `2 × 1` |
| `IndicatorLight` | 指示灯 | `2 × 1` |
| `IndicatorLightGroup` | 指示灯组 | `3 × 3` |
| `KnobDiscrete` | 离散旋钮 | `2 × 2` |
| `KnobContinuous` | 连续旋钮 | `2 × 2` |
| `KnobInfinite` | 无限旋钮 | `2 × 2` |
| `Lever` | 离散拨杆 | `1 × 3` |
| `LeverContinuous` | 连续拨杆 | `4 × 1` |
| `Display` | 显示屏 | `3 × 3` |

> `默认网格` 是编辑器从组件库拖入组件时使用的初始跨度。JSON 中的 `grid` 字段才是最终布局依据。`Display` 的默认跨度还会根据 `width`、`height` 和当前面板的 `cellSize`、`gap` 自动换算。

---

### 6.1 ButtonSimple — 普通按钮

```json
{
  "id": "btn-ap1",
  "type": "ButtonSimple",
  "grid": { "row": 1, "col": 1, "rowSpan": 1, "colSpan": 2 },
  "props": {
    "text": "AP1",
    "label": "AUTOPILOT 1",
    "labelPosition": "top",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `text` | string | `"BTN"` | 按钮内部文本。 |
| `label` | string | `"BUTTON"` | 外部标签。 |
| `labelPosition` | string | `"top"` | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | 标签方向。 |

---

### 6.2 ButtonWithLights — 带灯按钮

```json
{
  "id": "btn-fd",
  "type": "ButtonWithLights",
  "grid": { "row": 2, "col": 1, "rowSpan": 1, "colSpan": 2 },
  "props": {
    "text": "FD",
    "upperLightColor": "green",
    "lowerLightColor": "amber",
    "upperLightText": "ON",
    "lowerLightText": "FAULT",
    "initialUpperBrightness": 80,
    "initialLowerBrightness": 0,
    "label": "FLIGHT DIR",
    "labelPosition": "top",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `text` | string | `"BTN"` | — | 按钮内部文本。 |
| `upperLightColor` | string | `"green"` | CSS 颜色 | 上方指示灯颜色。 |
| `lowerLightColor` | string | `"amber"` | CSS 颜色 | 下方指示灯颜色。 |
| `upperLightText` | string | `"ON"` | — | 上方指示灯文本。 |
| `lowerLightText` | string | `"FAULT"` | — | 下方指示灯文本。 |
| `initialUpperBrightness` | number | `0` | `0 ~ 100` | 上方指示灯初始亮度。 |
| `initialLowerBrightness` | number | `0` | `0 ~ 100` | 下方指示灯初始亮度。 |
| `label` | string | `"BUTTON"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

---

### 6.3 IndicatorLight — 独立指示灯

```json
{
  "id": "light-warn",
  "type": "IndicatorLight",
  "grid": { "row": 1, "col": 3, "rowSpan": 1, "colSpan": 2 },
  "props": {
    "text": "WARN",
    "backgroundColor": "red",
    "foregroundColor": "white",
    "initialBrightness": 0,
    "label": "MASTER WARN",
    "labelPosition": "bottom",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `text` | string | `"LIGHT"` | — | 指示灯内部文本。 |
| `backgroundColor` | string | `"green"` | CSS 颜色 | 点亮时的背景 / 发光颜色。 |
| `foregroundColor` | string | `"white"` | CSS 颜色 | 文字颜色。 |
| `initialBrightness` | number | `0` | `0 ~ 100` | 初始亮度。`0` 为熄灭，仍保留暗淡背景。 |
| `label` | string | `"INDICATOR"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

`IndicatorLight` 的亮灯区域会铺满整个组件区域。

运行时可通过 `updateDisplay()` 更新：

```js
updateDisplay({
  cmpName: 'light-warn',
  upperLight: 90,
});
```

---

### 6.4 KnobDiscrete — 离散旋钮

```json
{
  "id": "knob-mode",
  "type": "KnobDiscrete",
  "grid": { "row": 3, "col": 1, "rowSpan": 2, "colSpan": 2 },
  "props": {
    "positions": ["OFF", "STBY", "AUTO", "ON"],
    "initialPosition": 2,
    "diameter": 48,
    "arcStartAngle": 200,
    "arcEndAngle": 340,
    "label": "MODE",
    "labelPosition": "top",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `positions` | string[] | `["OFF", "AUTO", "ON"]` | 非空数组 | 档位文本。 |
| `initialPosition` | number | `1` | `0 ~ positions.length - 1` | 初始档位，索引从 0 开始。 |
| `diameter` | number | `50` | `24 ~ 160` | 旋钮直径，单位 px。 |
| `arcStartAngle` | number | `210` | `-360 ~ 360` | 刻度弧起始角度。 |
| `arcEndAngle` | number | `330` | `-360 ~ 360` | 刻度弧结束角度。 |
| `label` | string | `"KNOB"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

---

### 6.5 KnobContinuous — 连续旋钮

```json
{
  "id": "knob-hdg",
  "type": "KnobContinuous",
  "grid": { "row": 3, "col": 3, "rowSpan": 2, "colSpan": 2 },
  "props": {
    "minValue": 0,
    "maxValue": 360,
    "initialValue": 270,
    "diameter": 48,
    "arcStartAngle": 200,
    "arcEndAngle": 340,
    "valueDisplayPrecision": 0,
    "label": "HEADING",
    "labelPosition": "top",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `minValue` | number | `0` | — | 最小值。 |
| `maxValue` | number | `100` | — | 最大值。 |
| `initialValue` | number | `50` | — | 初始值，组件会限制在 `minValue ~ maxValue` 内。 |
| `diameter` | number | `50` | `24 ~ 160` | 旋钮直径，单位 px。 |
| `arcStartAngle` | number | `210` | `-360 ~ 360` | 刻度弧起始角度。 |
| `arcEndAngle` | number | `330` | `-360 ~ 360` | 刻度弧结束角度。 |
| `valueDisplayPrecision` | number | `0` | `0 ~ 4` | 当前值显示的小数位数。 |
| `label` | string | `"KNOB"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

---

### 6.6 KnobInfinite — 无限旋钮

```json
{
  "id": "knob-baro",
  "type": "KnobInfinite",
  "grid": { "row": 8, "col": 3, "rowSpan": 2, "colSpan": 2 },
  "props": {
    "initialValue": 29.92,
    "valuePerRevolution": 1,
    "diameter": 48,
    "valueDisplayPrecision": 2,
    "label": "BARO",
    "labelPosition": "bottom",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `initialValue` | number | `0` | — | 初始值。 |
| `valuePerRevolution` | number | `100` | — | 每旋转 360° 对应的数值变化量。 |
| `diameter` | number | `50` | `24 ~ 160` | 旋钮直径，单位 px。 |
| `valueDisplayPrecision` | number | `0` | `0 ~ 4` | 当前值显示的小数位数。 |
| `label` | string | `"KNOB"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

---

### 6.7 Lever — 离散拨杆

```json
{
  "id": "lever-gear",
  "type": "Lever",
  "grid": { "row": 6, "col": 9, "rowSpan": 3, "colSpan": 1 },
  "props": {
    "positions": ["DOWN", "UP"],
    "initialPosition": 0,
    "orientation": "vertical",
    "slotLength": 90,
    "label": "LANDING GEAR",
    "labelPosition": "top",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `positions` | string[] | `["DOWN", "UP"]` | 非空数组 | 档位文本。 |
| `initialPosition` | number | `0` | `0 ~ positions.length - 1` | 初始档位索引。 |
| `orientation` | string | `"vertical"` | `"vertical"` / `"horizontal"` | 拨杆方向。 |
| `slotLength` | number | `90` | `40 ~ 240` | 槽道长度，单位 px。 |
| `label` | string | `"LEVER"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

---

### 6.8 LeverContinuous — 连续拨杆

```json
{
  "id": "lever-trim",
  "type": "LeverContinuous",
  "grid": { "row": 4, "col": 3, "rowSpan": 1, "colSpan": 4 },
  "props": {
    "minValue": -5,
    "maxValue": 10,
    "initialValue": 0,
    "orientation": "horizontal",
    "slotLength": 120,
    "valueDisplayPrecision": 1,
    "label": "PITCH TRIM",
    "labelPosition": "left",
    "labelOrientation": "vertical"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `minValue` | number | `0` | — | 最小值。 |
| `maxValue` | number | `100` | — | 最大值。 |
| `initialValue` | number | `50` | — | 初始值，组件会限制在 `minValue ~ maxValue` 内。 |
| `orientation` | string | `"horizontal"` | `"vertical"` / `"horizontal"` | 拨杆方向。 |
| `slotLength` | number | `100` | `40 ~ 240` | 槽道长度，单位 px。 |
| `valueDisplayPrecision` | number | `0` | `0 ~ 4` | 当前值显示的小数位数。 |
| `label` | string | `"LEVER"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

---

### 6.9 Display — 显示屏

```json
{
  "id": "display-pfd",
  "type": "Display",
  "grid": { "row": 1, "col": 5, "rowSpan": 3, "colSpan": 3 },
  "props": {
    "width": 132,
    "height": 132,
    "label": "PFD",
    "labelPosition": "top",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `width` | number | `132` | `32 ~ 800` | Canvas 宽度，单位 px。 |
| `height` | number | `132` | `32 ~ 800` | Canvas 高度，单位 px。 |
| `label` | string | `"DISPLAY"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

`Display` 在项目文件中只保存 Canvas 尺寸，**不保存 Canvas 绘制内容**。

绘制内容需要在运行时通过组件实例完成：

```js
import { AttitudeIndication } from './scripts/att.js';

const display = result.components.get('display-pfd');
const attitude = new AttitudeIndication(display.getCanvas());
attitude.updateDisplay(5, -10);
```

编辑器导出 JavaScript 代码时，会为每个 `Display` 生成空的绘制占位函数，供后续手工补充。

---

### 6.10 IndicatorLightGroup — 指示灯组

`IndicatorLightGroup` 将多颗指示灯排布成表格状灯阵。整个组件占据一个较大的控件区域，而每颗灯只占据所在单元格的一部分。

```json
{
  "id": "light-group",
  "type": "IndicatorLightGroup",
  "grid": { "row": 1, "col": 1, "rowSpan": 3, "colSpan": 3 },
  "props": {
    "rows": 3,
    "columns": 3,
    "texts": ["APU", "BLEED", "FUEL", "HYD", "ELEC", "NAV", "COM", "CAB", "GPU"],
    "brightness": [85, 0, 0, 0, 80, 0, 0, 0, 65],
    "backgroundColor": "green",
    "foregroundColor": "white",
    "gap": 4,
    "label": "SYSTEM LIGHTS",
    "labelPosition": "top",
    "labelOrientation": "horizontal"
  }
}
```

| 属性 | 类型 | 默认值 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `rows` | number | `3` | `1 ~ 8` | 灯阵行数。 |
| `columns` | number | `3` | `1 ~ 8` | 灯阵列数。 |
| `texts` | string[] | `["1","2","3","4","5","6","7","8","9"]` | — | 每颗灯的文本，**按行优先**排列。缺少的项为空字符串。 |
| `brightness` | number[] | `[80,0,0,0,80,0,0,0,80]` | 每项 `0 ~ 100` | 每颗灯的初始亮度，按行优先排列。缺少的灯为熄灭状态。 |
| `backgroundColor` | string | `"green"` | CSS 颜色 | 灯组内所有灯的点亮颜色。 |
| `foregroundColor` | string | `"white"` | CSS 颜色 | 灯组内所有灯的文字颜色。 |
| `gap` | number | `4` | `0 ~ 20` | 单元格间距，单位 px。 |
| `label` | string | `"LIGHT GROUP"` | — | 外部标签。 |
| `labelPosition` | string | `"top"` | — | 标签位置。 |
| `labelOrientation` | string | `"horizontal"` | — | 标签方向。 |

灯阵索引从 `0` 开始，按行优先排列：

```text
0  1  2
3  4  5
6  7  8
```

单颗灯的亮灯区域只占所在单元格的一部分（约 64%），单元格本身保持暗色，从而形成传统指示灯组的外观。

#### 运行时更新

单颗灯：

```js
const group = getComponentByName('light-group');

group.setLightBrightness(4, 90);
```

整组灯：

```js
group.setBrightnesses([100, 0, 0, 0, 100, 0, 0, 0, 100]);
// 未提供的索引会设为 0
// 或：
group.setAllBrightness(0);
```

通过全局 `updateDisplay()`：

```js
updateDisplay({
  cmpName: 'light-group',
  lights: [100, 0, 0, 0, 100, 0, 0, 0, 100],
});

updateDisplay({
  cmpName: 'light-group',
  lightIndex: 4,
  brightness: 90,
});
```

读取状态：

```js
group.getBrightness(4);   // 单颗灯亮度
group.getBrightnesses();  // 整个灯组亮度数组
```

---

## 7. 完整示例

```json
{
  "version": 1,
  "name": "A320 演示面板",
  "panels": [
    {
      "id": "main-panel",
      "columns": 16,
      "rows": 10,
      "cellSize": 46,
      "gap": 8,
      "components": [
        {
          "id": "btn-ap1",
          "type": "ButtonSimple",
          "grid": { "row": 1, "col": 1, "rowSpan": 1, "colSpan": 2 },
          "props": {
            "text": "AP1",
            "label": "AUTOPILOT 1",
            "labelPosition": "top",
            "labelOrientation": "horizontal"
          }
        },
        {
          "id": "light-warn",
          "type": "IndicatorLight",
          "grid": { "row": 1, "col": 3, "rowSpan": 1, "colSpan": 2 },
          "props": {
            "text": "WARN",
            "backgroundColor": "red",
            "foregroundColor": "white",
            "initialBrightness": 0,
            "label": "MASTER WARN",
            "labelPosition": "bottom",
            "labelOrientation": "horizontal"
          }
        },
        {
          "id": "display-pfd",
          "type": "Display",
          "grid": { "row": 1, "col": 5, "rowSpan": 3, "colSpan": 3 },
          "props": {
            "width": 132,
            "height": 132,
            "label": "PFD",
            "labelPosition": "top",
            "labelOrientation": "horizontal"
          }
        },
        {
          "id": "btn-fd",
          "type": "ButtonWithLights",
          "grid": { "row": 2, "col": 1, "rowSpan": 1, "colSpan": 2 },
          "props": {
            "text": "FD",
            "upperLightColor": "green",
            "lowerLightColor": "amber",
            "upperLightText": "ON",
            "lowerLightText": "FAULT",
            "initialUpperBrightness": 80,
            "initialLowerBrightness": 0,
            "label": "FLIGHT DIR",
            "labelPosition": "top",
            "labelOrientation": "horizontal"
          }
        },
        {
          "id": "knob-mode",
          "type": "KnobDiscrete",
          "grid": { "row": 3, "col": 1, "rowSpan": 2, "colSpan": 2 },
          "props": {
            "positions": ["OFF", "STBY", "AUTO", "ON"],
            "initialPosition": 2,
            "diameter": 48,
            "arcStartAngle": 200,
            "arcEndAngle": 340,
            "label": "MODE",
            "labelPosition": "top",
            "labelOrientation": "horizontal"
          }
        },
        {
          "id": "knob-hdg",
          "type": "KnobContinuous",
          "grid": { "row": 3, "col": 3, "rowSpan": 2, "colSpan": 2 },
          "props": {
            "minValue": 0,
            "maxValue": 360,
            "initialValue": 270,
            "diameter": 48,
            "arcStartAngle": 200,
            "arcEndAngle": 340,
            "valueDisplayPrecision": 0,
            "label": "HEADING",
            "labelPosition": "top",
            "labelOrientation": "horizontal"
          }
        },
        {
          "id": "lever-gear",
          "type": "Lever",
          "grid": { "row": 6, "col": 1, "rowSpan": 3, "colSpan": 1 },
          "props": {
            "positions": ["DOWN", "UP"],
            "initialPosition": 0,
            "orientation": "vertical",
            "slotLength": 90,
            "label": "LANDING GEAR",
            "labelPosition": "top",
            "labelOrientation": "horizontal"
          }
        }
      ]
    },
    {
      "id": "secondary-panel",
      "columns": 8,
      "rows": 5,
      "cellSize": 44,
      "gap": 8,
      "components": [
        {
          "id": "lever-trim",
          "type": "LeverContinuous",
          "grid": { "row": 1, "col": 1, "rowSpan": 1, "colSpan": 4 },
          "props": {
            "minValue": -5,
            "maxValue": 10,
            "initialValue": 0,
            "orientation": "horizontal",
            "slotLength": 120,
            "valueDisplayPrecision": 1,
            "label": "PITCH TRIM",
            "labelPosition": "left",
            "labelOrientation": "vertical"
          }
        },
        {
          "id": "knob-baro",
          "type": "KnobInfinite",
          "grid": { "row": 1, "col": 5, "rowSpan": 2, "colSpan": 2 },
          "props": {
            "initialValue": 29.92,
            "valuePerRevolution": 1,
            "diameter": 48,
            "valueDisplayPrecision": 2,
            "label": "BARO",
            "labelPosition": "bottom",
            "labelOrientation": "horizontal"
          }
        },
        {
          "id": "light-group",
          "type": "IndicatorLightGroup",
          "grid": { "row": 3, "col": 1, "rowSpan": 2, "colSpan": 2 },
          "props": {
            "rows": 2,
            "columns": 2,
            "texts": ["APU", "BLEED", "HYD", "ELEC"],
            "brightness": [100, 0, 0, 80],
            "backgroundColor": "green",
            "foregroundColor": "white",
            "gap": 4,
            "label": "SYSTEM LIGHTS",
            "labelPosition": "top",
            "labelOrientation": "horizontal"
          }
        }
      ]
    }
  ]
}
```

---

## 8. 校验与规范化规则

编辑器打开 JSON 或从 `localStorage` 恢复项目时，会执行以下规范化：

1. 根节点必须是对象。
2. `panels` 必须是数组且至少包含一个面板。
3. 缺少的面板字段使用默认值。
4. `columns`、`rows`、`cellSize`、`gap` 会被限制到合法范围。
5. 面板 ID 和组件 ID 会做唯一化处理；重复时自动追加 `-2`、`-3` 等后缀。
6. 未知组件类型会被跳过，并产生警告。
7. 无效组件对象会被跳过。
8. 组件 `grid` 会被限制在所属面板边界内。
9. 缺失或无效的 `props` 字段会回退到该组件的默认值。
10. 不属于该组件类型的未知 `props` 字段会被忽略。
11. 数字属性会被转换为数值，并按组件字段范围限制。
12. `positions` 为空时会回退到该组件的默认档位。
13. 档位类组件的 `initialPosition` 会被限制在 `0 ~ positions.length - 1`。
14. 检测到组件重叠时产生警告，但不会自动调整已有布局。
15. `version` 会被规范化为当前版本 `1`。
16. `name` 为空时会回退为 `"未命名项目"`。

对于 `IndicatorLightGroup`，`texts` 和 `brightness` 会按 `rows × columns` 使用：缺少的项按空文本 / `0` 亮度处理，多余的项会被忽略。

> 编辑器导入时对重叠只提示、不强制修正；但之后在编辑器中拖动或缩放组件时会继续阻止产生新的重叠。

---

## 9. 本地自动保存

编辑器自动保存使用以下 `localStorage` 键：

```text
cockpit-editor.project.v1
```

行为：

- 编辑后约 300ms 自动保存。
- 重新打开 `editor.html` 时会自动恢复。
- 点击“新建”会覆盖本地保存内容。
- 点击“打开”导入 JSON 时会同时更新本地保存内容。
- 点击“保存 JSON”导出当前项目。
- 点击“导出 JS”生成可运行代码或可读组件代码，但**不会**改变项目 JSON。

---

## 10. 从代码加载项目

### 10.1 使用 mountProject 渲染整个项目

```html
<link rel="stylesheet" href="./styles/panel_style.css" />

<div id="app"></div>

<script type="module">
  import { mountProject } from './scripts/panels.js';

  const project = await fetch('./my-project.json').then((response) => response.json());

  const result = mountProject(document.getElementById('app'), project, {
    displayRenderers: {
      'display-pfd': (display) => {
        const ctx = display.getContext();
        const canvas = display.getCanvas();

        // 在这里绘制显示屏内容
        ctx.fillStyle = '#0a0c10';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      },
    },
  });

  console.log(result.root);
  console.log(result.panels);     // Map<panelId, Panel>
  console.log(result.components); // Map<componentId, Component>
</script>
```

`mountProject()` 返回：

```ts
{
  root: HTMLElement;
  panels: Map<string, Panel>;
  components: Map<string, Component>;
}
```

### 10.2 使用 Panel.fromJSON 加载单个面板

```js
import { Panel } from './scripts/panels.js';

const panelJson = project.panels[0];

const panel = Panel.fromJSON('panel-container', panelJson);
```

`panel-container` 必须是页面中已存在的容器元素 ID。

---

## 11. 不包含事件代码

项目 JSON 不包含任何事件、回调或脚本字段，例如：

```json
"onClick": "doSomething()"
"events": { ... }
"script": "..."
```

这些字段不会被编辑器识别。

如果需要行为逻辑，请在页面代码中通过组件实例或 ID 自行绑定：

```js
import { getComponentByName, updateDisplay } from './scripts/panels.js';

const button = getComponentByName('btn-ap1');

button.on('click', () => {
  updateDisplay({
    cmpName: 'light-warn',
    upperLight: 90,
  });
});
```

---

## 12. 版本兼容

当前格式版本为 `1`。

- 编辑器会将读取到的 `version` 统一规范化为 `1`。
- 未知顶层字段会被忽略。
- 未知组件类型会被跳过并给出警告。
- 如果未来增加新的组件类型或字段，建议递增 `version` 并在此文档中补充说明。
