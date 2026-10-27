// ==================== 项目 JSON -> JavaScript 代码生成 ====================

const STYLE_HELPER = `const STYLE_HREF = new URL('./styles/panel_style.css?v=20261029', import.meta.url).href;

function ensureStyles() {
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .some((link) => link.href === STYLE_HREF);
    if (existing) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_HREF;
    link.dataset.cockpitStyle = 'true';
    document.head.appendChild(link);
}`;

function formatLiteral(value, indent = 2) {
    return JSON.stringify(value, null, indent)
        .replace(/^(\s*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:');
}

function formatInlineLiteral(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => formatInlineLiteral(item)).join(', ')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value).map(([key, item]) => {
            const safeKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
            return `${safeKey}: ${formatInlineLiteral(item)}`;
        });
        return `{ ${entries.join(', ')} }`;
    }
    return JSON.stringify(value);
}

function indentBlock(text, spaces) {
    const pad = ' '.repeat(spaces);
    return String(text)
        .split('\n')
        .map((line) => (line ? pad + line : line))
        .join('\n');
}

function makeUniqueName(base, usedNames) {
    let name = base;
    let index = 2;
    while (usedNames.has(name)) {
        name = `${base}${index}`;
        index += 1;
    }
    usedNames.add(name);
    return name;
}

function componentVariableName(type, counters, usedNames) {
    const count = (counters.get(type) || 0) + 1;
    counters.set(type, count);
    const base = type.charAt(0).toLowerCase() + type.slice(1);
    return makeUniqueName(`${base}${count}`, usedNames);
}

function collectDisplays(project) {
    const displays = [];
    (project.panels || []).forEach((panel) => {
        (panel.components || []).forEach((component) => {
            if (component.type === 'Display') {
                displays.push({ panel, component });
            }
        });
    });
    return displays;
}

function buildHeader(project, mode) {
    const modeText = mode === 'module'
        ? 'JavaScript 模块（通用挂载）'
        : '可读组件代码（逐组件创建）';
    const projectName = String(project.name || '未命名项目').replace(/[\r\n]+/g, ' ');

    return [
        '// ============================================================',
        '// 由「驾驶舱界面编辑器」生成',
        `// 项目：${projectName}`,
        `// 导出类型：${modeText}`,
        '//',
        '// 使用前请确保本文件位于项目根目录，并且存在：',
        '//   ./scripts/panels.js',
        '//   ./styles/panel_style.css',
        '//',
        '// 页面中使用：',
        "//   import { mount } from './your-file.js';",
        "//   mount(document.getElementById('app'));",
        '//',
        '// 说明：仅包含界面结构和初始值，不包含自定义事件代码。',
        '// ============================================================',
    ].join('\n');
}

function buildDisplayFunction(functionName, componentId, indent = 0) {
    const lines = [
        `// Display 绘制占位：${componentId}`,
        `function ${functionName}(display) {`,
        '    const ctx = display.getContext();',
        '    const canvas = display.getCanvas();',
        '',
        '    // TODO: 在此绘制显示屏内容。',
        "    // 示例：ctx.fillStyle = '#0a0c10';",
        '    //       ctx.fillRect(0, 0, canvas.width, canvas.height);',
        '}',
    ];
    return indent > 0 ? indentBlock(lines.join('\n'), indent) : lines.join('\n');
}

function buildRendererMap(displays, functionNames) {
    if (!displays.length) return 'const displayRenderers = {};';
    const lines = ['const displayRenderers = {'];
    displays.forEach(({ component }) => {
        lines.push(`    ${JSON.stringify(component.id)}: ${functionNames.get(component.id)},`);
    });
    lines.push('};');
    return lines.join('\n');
}

/**
 * 端口 A：JavaScript 模块，内嵌项目 JSON，只生成通用 mountProject 调用。
 */
export function generateJavaScriptModule(project) {
    const displays = collectDisplays(project);
    const usedNames = new Set();
    const functionNames = new Map();
    displays.forEach(({ component }, index) => {
        const name = makeUniqueName(`drawDisplay${index + 1}`, usedNames);
        functionNames.set(component.id, name);
    });

    const blocks = [
        buildHeader(project, 'module'),
        '',
        "import { mountProject } from './scripts/panels.js';",
        '',
        STYLE_HELPER,
        '',
        `export const project = ${formatLiteral(project)};`,
        '',
    ];

    displays.forEach(({ component }) => {
        blocks.push(buildDisplayFunction(functionNames.get(component.id), component.id));
        blocks.push('');
    });

    blocks.push(buildRendererMap(displays, functionNames));
    blocks.push('');
    blocks.push('export function mount(container = document.body) {');
    blocks.push('    ensureStyles();');
    blocks.push('    return mountProject(container, project, { displayRenderers });');
    blocks.push('}');
    blocks.push('');
    blocks.push('// 如需页面加载后自动挂载，可取消下一行注释：');
    blocks.push('// mount();');
    blocks.push('');
    return blocks.join('\n');
}

/**
 * 端口 D：可读组件代码，按面板/组件逐条生成 new Xxx(...) 与 addComponent(...)。
 */
export function generateReadableJavaScript(project) {
    const usedNames = new Set([
        'mount', 'container', 'projectRoot', 'mountKey', 'ensureStyles', 'STYLE_HREF',
    ]);
    const counters = new Map();
    const displayFunctions = new Map();
    const usedTypes = new Set(['Panel']);

    (project.panels || []).forEach((panel) => {
        (panel.components || []).forEach((component) => {
            usedTypes.add(component.type);
        });
    });

    const importNames = Array.from(usedTypes).sort().join(', ');
    const lines = [
        buildHeader(project, 'readable'),
        '',
        `import { ${importNames} } from './scripts/panels.js';`,
        '',
        STYLE_HELPER,
        '',
        'export function mount(container = document.body) {',
        '    ensureStyles();',
        '',
        "    const projectRoot = document.createElement('div');",
        "    projectRoot.className = 'main-panel-div';",
        "    projectRoot.style.display = 'flex';",
        "    projectRoot.style.flexWrap = 'wrap';",
        "    projectRoot.style.gap = '30px';",
        "    projectRoot.style.alignItems = 'flex-start';",
        '    container.appendChild(projectRoot);',
        '',
        '    const mountKey = Math.random().toString(36).slice(2, 8);',
        '    const panels = new Map();',
        '    const components = new Map();',
    ];

    (project.panels || []).forEach((panel, panelIndex) => {
        const panelNumber = panelIndex + 1;
        const panelHostName = `panel${panelNumber}Host`;
        const panelName = `panel${panelNumber}`;
        const panelOptions = {
            columns: panel.columns,
            rows: panel.rows,
            cellSize: panel.cellSize,
            gap: panel.gap,
            panelId: panel.id,
        };

        lines.push('');
        lines.push(`    // ==================== 面板 ${panelNumber}：${panel.id} ====================`);
        lines.push(`    const ${panelHostName} = document.createElement('div');`);
        lines.push(`    ${panelHostName}.id = \`cockpit-panel-host-\${mountKey}-${panelNumber}\`;`);
        lines.push(`    projectRoot.appendChild(${panelHostName});`);
        lines.push('');
        lines.push(
            `    const ${panelName} = new Panel(${panelHostName}.id, ` +
            `${formatLiteral(panelOptions, 2).replace(/\n/g, '\n    ')});`
        );
        lines.push(`    panels.set(${JSON.stringify(panel.id)}, ${panelName});`);

        (panel.components || []).forEach((component) => {
            const variableName = componentVariableName(component.type, counters, usedNames);
            lines.push('');
            lines.push(`    // ${component.type}：${component.id}`);
            lines.push(
                `    const ${variableName} = new ${component.type}(${JSON.stringify(component.id)}, ` +
                `${formatLiteral(component.props, 2).replace(/\n/g, '\n    ')});`
            );
            lines.push(
                `    ${panelName}.addComponent(${variableName}, ` +
                `${formatInlineLiteral(component.grid)});`
            );
            lines.push(`    components.set(${JSON.stringify(component.id)}, ${variableName});`);

            if (component.type === 'Display') {
                const drawName = makeUniqueName(
                    `drawDisplay${displayFunctions.size + 1}`,
                    usedNames
                );
                displayFunctions.set(component.id, drawName);
                lines.push('');
                lines.push(buildDisplayFunction(drawName, component.id, 4));
                lines.push(`    ${drawName}(${variableName});`);
            }
        });
    });

    lines.push('');
    lines.push('    return {');
    lines.push('        root: projectRoot,');
    lines.push('        panels,');
    lines.push('        components,');
    lines.push('    };');
    lines.push('}');
    lines.push('');
    lines.push('// 如需页面加载后自动挂载，可取消下一行注释：');
    lines.push('// mount();');
    lines.push('');
    return lines.join('\n');
}
