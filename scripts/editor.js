// ==================== 驾驶舱界面编辑器 ====================
import { Panel, createComponentInstance } from './panels.js';
import {
    COMPONENT_GROUPS,
    STORAGE_KEY,
    createProject,
    createPanelModel,
    getComponentDefinition,
    getComponentLabel,
    getDefaultGrid,
    makeUniqueId,
    normalizeProject,
    normalizeComponentProps,
    cloneProps,
    clampInt,
} from './editor-schema.js';
import {
    generateJavaScriptModule,
    generateReadableJavaScript,
} from './project-codegen.js';

const HISTORY_LIMIT = 60;
const AUTOSAVE_DELAY = 300;
const HISTORY_DELAY = 350;
const MARQUEE_THRESHOLD = 4;
const GRID_HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const COLOR_HEX = {
    green: '#40c860',
    amber: '#e8a830',
    blue: '#5098e0',
    red: '#e04848',
    white: '#f0f2f6',
    cyan: '#40c8c8',
};

// ==================== DOM ====================
const dom = {
    canvas: document.getElementById('editor-canvas'),
    paletteGroups: document.getElementById('palette-groups'),
    inspector: document.getElementById('inspector-content'),
    inspectorKind: document.getElementById('inspector-kind'),
    projectName: document.getElementById('project-name'),
    fileInput: document.getElementById('file-input'),
    workspaceHint: document.getElementById('workspace-hint'),
    statusSelection: document.getElementById('status-selection'),
    statusMessage: document.getElementById('status-message'),
    statusStorage: document.getElementById('status-storage'),
    toastContainer: document.getElementById('toast-container'),
};

// ==================== 状态 ====================
const state = {
    project: createProject(),
    selected: null, // {kind:'component'|'components'|'panel', panelId, componentId?/componentIds?}
    activePanelId: null,
    panelViews: new Map(),
    componentViews: new Map(),
    history: [],
    historyIndex: -1,
    historyTimer: 0,
    autosaveTimer: 0,
    preview: false,
    drag: null,
    marquee: null,
    clipboard: null,
    paletteDragType: null,
    paletteMarker: null,
    pendingRebuilds: new Map(),
};

// ==================== 基础工具 ====================
function createEl(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function toast(message, type = 'info', duration = 2800) {
    const item = createEl('div', `toast${type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : ''}`, message);
    dom.toastContainer.appendChild(item);
    window.setTimeout(() => {
        item.remove();
    }, duration);
}

function setMessage(message) {
    dom.statusMessage.textContent = message || '就绪';
}

function setStorageStatus(text, mode = '') {
    dom.statusStorage.textContent = text;
    dom.statusStorage.classList.remove('is-saving', 'is-saved');
    if (mode) dom.statusStorage.classList.add(mode);
}

function sanitizeFileName(name) {
    return String(name || 'cockpit-project').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'cockpit-project';
}

function normalizeIdText(value) {
    return String(value || '').trim().replace(/\s+/g, '-');
}

function collectUsedComponentIds() {
    const ids = new Set();
    state.project.panels.forEach((panel) => {
        panel.components.forEach((component) => ids.add(component.id));
    });
    return ids;
}

function collectUsedPanelIds() {
    return new Set(state.project.panels.map((panel) => panel.id));
}

function findPanelModel(panelId) {
    return state.project.panels.find((panel) => panel.id === panelId) || null;
}

function findComponentModel(panelId, componentId) {
    const panel = findPanelModel(panelId);
    if (!panel) return null;
    return panel.components.find((component) => component.id === componentId) || null;
}

function findComponentLocation(componentId) {
    for (const panel of state.project.panels) {
        const component = panel.components.find((item) => item.id === componentId);
        if (component) return { panel, component };
    }
    return null;
}

function getSelectedComponentIds(selection = state.selected) {
    if (!selection) return [];
    if (selection.kind === 'component') return [selection.componentId];
    if (selection.kind === 'components') return [...selection.componentIds];
    return [];
}

function getSelectedPanelId(selection = state.selected) {
    return selection?.panelId || null;
}

function getSelectedComponentModels() {
    const panelId = getSelectedPanelId();
    if (!panelId) return [];
    return getSelectedComponentIds()
        .map((id) => findComponentModel(panelId, id))
        .filter(Boolean);
}

function isComponentSelected(panelId, componentId) {
    return getSelectedPanelId() === panelId &&
        getSelectedComponentIds().includes(componentId);
}

function getGroupBounds(components) {
    const minRow = Math.min(...components.map((component) => component.grid.row));
    const minCol = Math.min(...components.map((component) => component.grid.col));
    const maxRow = Math.max(...components.map((component) =>
        component.grid.row + component.grid.rowSpan - 1));
    const maxCol = Math.max(...components.map((component) =>
        component.grid.col + component.grid.colSpan - 1));
    return {
        row: minRow,
        col: minCol,
        rowSpan: maxRow - minRow + 1,
        colSpan: maxCol - minCol + 1,
    };
}

function isGroupFree(panel, grids, excludeIds = []) {
    const excluded = new Set(excludeIds);
    return grids.every((grid) => {
        if (grid.row < 1 || grid.col < 1) return false;
        if (grid.row + grid.rowSpan - 1 > panel.rows) return false;
        if (grid.col + grid.colSpan - 1 > panel.columns) return false;
        return !panel.components.some((component) =>
            !excluded.has(component.id) && rectsOverlap(component.grid, grid)
        );
    });
}

function isTextInputTarget(target) {
    return target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' ||
            target.tagName === 'TEXTAREA' || target.isContentEditable);
}

function parseArrayInput(value) {
    return String(value || '')
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseNumberArrayInput(value) {
    return String(value || '')
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
}

function toHexColor(color) {
    const text = String(color || '').trim().toLowerCase();
    if (COLOR_HEX[text]) return COLOR_HEX[text];
    if (/^#[0-9a-f]{6}$/.test(text)) return text;
    if (/^#[0-9a-f]{3}$/.test(text)) {
        return '#' + text.slice(1).split('').map((char) => char + char).join('');
    }
    return '#40c860';
}

function getOptionValue(option) {
    return typeof option === 'string' ? option : option.value;
}

function getOptionLabel(option) {
    return typeof option === 'string' ? option : option.label;
}

// ==================== 历史记录 / 自动保存 ====================
function snapshotProject() {
    return JSON.stringify(state.project);
}

function resetHistory() {
    window.clearTimeout(state.historyTimer);
    state.history = [snapshotProject()];
    state.historyIndex = 0;
    updateToolbar();
}

function pushHistory() {
    window.clearTimeout(state.historyTimer);
    const snapshot = snapshotProject();
    if (state.historyIndex >= 0 && state.history[state.historyIndex] === snapshot) {
        updateToolbar();
        return;
    }
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    if (state.history.length > HISTORY_LIMIT) {
        state.history.shift();
    }
    state.historyIndex = state.history.length - 1;
    updateToolbar();
}

function scheduleHistory(delay = HISTORY_DELAY) {
    window.clearTimeout(state.historyTimer);
    state.historyTimer = window.setTimeout(() => {
        pushHistory();
        scheduleAutosave();
    }, delay);
}

function undo() {
    if (state.drag || state.marquee || state.preview) return;
    window.clearTimeout(state.historyTimer);
    pushHistory();
    if (state.historyIndex <= 0) return;
    state.historyIndex -= 1;
    restoreSnapshot(state.history[state.historyIndex]);
    setMessage('已撤销');
}

function redo() {
    if (state.drag || state.marquee || state.preview) return;
    window.clearTimeout(state.historyTimer);
    pushHistory();
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex += 1;
    restoreSnapshot(state.history[state.historyIndex]);
    setMessage('已重做');
}

function restoreSnapshot(snapshot) {
    try {
        const raw = JSON.parse(snapshot);
        const result = normalizeProject(raw);
        const previous = state.selected;
        state.project = result.project;
        renderAll();
        restoreSelectionAfterProjectChange(previous);
        syncProjectChrome();
        updateToolbar();
        scheduleAutosave();
    } catch (error) {
        console.error(error);
        toast('恢复历史记录失败', 'error');
    }
}

function restoreSelectionAfterProjectChange(previous) {
    if (!previous) {
        selectNothing();
        return;
    }
    if (previous.kind === 'component') {
        const location = findComponentLocation(previous.componentId);
        if (location) {
            selectComponent(location.panel.id, previous.componentId);
            return;
        }
    }
    if (previous.kind === 'components') {
        const panel = findPanelModel(previous.panelId);
        const ids = previous.componentIds.filter((id) =>
            findComponentModel(previous.panelId, id)
        );
        if (panel && ids.length) {
            selectComponents(previous.panelId, ids, previous.primaryId);
            return;
        }
    }
    if (previous.kind === 'panel' && findPanelModel(previous.panelId)) {
        selectPanel(previous.panelId);
        return;
    }
    selectNothing();
}

function scheduleAutosave() {
    window.clearTimeout(state.autosaveTimer);
    setStorageStatus('正在保存…', 'is-saving');
    state.autosaveTimer = window.setTimeout(() => {
        saveToLocalStorage();
    }, AUTOSAVE_DELAY);
}

function saveToLocalStorage() {
    try {
        window.localStorage.setItem(STORAGE_KEY, snapshotProject());
        setStorageStatus('本地自动保存已开启', 'is-saved');
    } catch (error) {
        console.warn(error);
        setStorageStatus('本地保存失败', '');
        toast('浏览器本地存储不可用，请手动导出 JSON', 'error');
    }
}

function loadFromLocalStorage() {
    try {
        const text = window.localStorage.getItem(STORAGE_KEY);
        if (!text) return null;
        const parsed = JSON.parse(text);
        return normalizeProject(parsed);
    } catch (error) {
        console.warn('读取本地项目失败:', error);
        return null;
    }
}

// ==================== 项目 / 面板渲染 ====================
function renderAll() {
    clearDragArtifacts();
    clearMarqueeArtifacts();
    destroyAllViews();
    dom.canvas.replaceChildren();

    if (!state.project.panels.length) {
        dom.canvas.appendChild(createEl('div', 'editor-empty-state', '还没有面板，请点击“添加面板”。'));
        return;
    }

    state.project.panels.forEach((panelModel) => {
        createPanelView(panelModel);
    });

    refreshSelectionUI();
    updateStatus();
}

function destroyAllViews() {
    state.componentViews.forEach((view) => {
        try {
            view.component.destroy();
        } catch (error) {
            console.warn(error);
        }
    });
    state.componentViews.clear();

    state.panelViews.forEach((view) => {
        view.hostEl.remove();
    });
    state.panelViews.clear();

    removePaletteMarker();
    state.pendingRebuilds.forEach((timer) => window.clearTimeout(timer));
    state.pendingRebuilds.clear();
}

function createPanelView(panelModel) {
    const host = createEl('div', 'editor-panel-host');
    host.dataset.panelId = panelModel.id;
    host.id = `editor-panel-host-${panelModel.id.replace(/[^\w-]/g, '_')}`;
    dom.canvas.appendChild(host);

    const panel = new Panel(host.id, {
        columns: panelModel.columns,
        rows: panelModel.rows,
        cellSize: panelModel.cellSize,
        gap: panelModel.gap,
        panelId: panelModel.id,
    });

    const panelDiv = panel.panelDiv;
    panelDiv.classList.add('editor-panel');
    panelDiv.dataset.panelId = panelModel.id;
    panelDiv.style.setProperty('--cell-size', `${panelModel.cellSize}px`);
    panelDiv.style.setProperty('--grid-step', `${panelModel.cellSize + panelModel.gap}px`);

    const gridEl = createEl('div', 'editor-grid-overlay');
    panelDiv.appendChild(gridEl);

    const view = {
        model: panelModel,
        panel,
        hostEl: host,
        panelDiv,
        gridEl,
    };
    state.panelViews.set(panelModel.id, view);

    panelDiv.addEventListener('pointerdown', (event) => {
        if (state.preview || state.drag || state.marquee) return;
        if (event.button !== 0) return;
        if (event.target === panelDiv || event.target === gridEl) {
            event.stopPropagation();
            beginMarquee(event, view);
        }
    });

    bindPanelDropTarget(view);
    panelModel.components.forEach((componentModel) => {
        createComponentView(view, componentModel);
    });

    return view;
}

function createComponentView(panelView, componentModel) {
    const component = createComponentInstance(
        componentModel.type,
        componentModel.id,
        cloneProps(componentModel.props)
    );
    panelView.panel.addComponent(component, { ...componentModel.grid });

    const wrapper = component.wrapperDiv;
    wrapper.classList.add('editor-component-wrapper');
    wrapper.dataset.componentId = componentModel.id;
    wrapper.dataset.componentType = componentModel.type;

    const overlay = createEl('div', 'editor-component-hit');
    overlay.dataset.componentId = componentModel.id;
    overlay.title = `${getComponentLabel(componentModel.type)} · ${componentModel.id}`;

    const badge = createEl('span', 'editor-component-badge', getComponentLabel(componentModel.type));
    overlay.appendChild(badge);

    GRID_HANDLE_NAMES.forEach((handleName) => {
        const handle = createEl('span', 'resize-handle');
        handle.dataset.handle = handleName;
        overlay.appendChild(handle);
    });

    wrapper.appendChild(overlay);

    const view = {
        model: componentModel,
        panelId: panelView.model.id,
        component,
        wrapper,
        overlay,
    };
    state.componentViews.set(componentModel.id, view);

    overlay.addEventListener('pointerdown', (event) => {
        if (state.preview || state.drag || state.marquee || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const modifier = event.shiftKey || event.ctrlKey || event.metaKey;
        if (modifier) {
            toggleComponentSelection(panelView.model.id, componentModel.id);
            return;
        }

        const alreadySelected = isComponentSelected(
            panelView.model.id,
            componentModel.id
        );
        if (!alreadySelected) {
            selectComponent(panelView.model.id, componentModel.id);
        }
        const componentIds = alreadySelected
            ? getSelectedComponentIds()
            : [componentModel.id];
        beginMoveDrag(event, view, componentIds);
    });

    overlay.querySelectorAll('.resize-handle').forEach((handleEl) => {
        handleEl.addEventListener('pointerdown', (event) => {
            if (state.preview || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            selectComponent(panelView.model.id, componentModel.id);
            beginResizeDrag(event, view, handleEl.dataset.handle);
        });
    });

    return view;
}

// ==================== 面板拖放（从组件库） ====================
function bindPanelDropTarget(panelView) {
    const { panelDiv, model } = panelView;

    panelDiv.addEventListener('dragover', (event) => {
        if (state.preview) return;
        const type = state.paletteDragType || event.dataTransfer?.getData('application/x-cockpit-component');
        if (!type || !getComponentDefinition(type)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        showPaletteMarker(panelView, type, event.clientX, event.clientY);
    });

    panelDiv.addEventListener('dragleave', (event) => {
        if (!panelDiv.contains(event.relatedTarget)) {
            removePaletteMarker();
        }
    });

    panelDiv.addEventListener('drop', (event) => {
        if (state.preview) return;
        const type = event.dataTransfer?.getData('application/x-cockpit-component') ||
            state.paletteDragType;
        if (!type || !getComponentDefinition(type)) return;
        event.preventDefault();
        const cell = pointToCell(panelView, event.clientX, event.clientY);
        removePaletteMarker();
        state.paletteDragType = null;
        addComponent(type, model.id, { row: cell.row, col: cell.col });
    });
}

function showPaletteMarker(panelView, type, clientX, clientY) {
    const cell = pointToCell(panelView, clientX, clientY);
    const defaultGrid = getDefaultGrid(type, panelView.model);
    const grid = clampGridToPanel(panelView.model, {
        row: cell.row,
        col: cell.col,
        rowSpan: defaultGrid.rowSpan,
        colSpan: defaultGrid.colSpan,
    });

    if (!state.paletteMarker) {
        state.paletteMarker = createEl('div', 'editor-drop-marker');
    }
    if (state.paletteMarker.parentElement !== panelView.panelDiv) {
        panelView.panelDiv.appendChild(state.paletteMarker);
    }
    positionOverlayElement(panelView, state.paletteMarker, grid);
    state.paletteMarker.classList.toggle(
        'is-invalid',
        !isGridFree(panelView.model, grid)
    );
}

function removePaletteMarker() {
    if (state.paletteMarker) {
        state.paletteMarker.remove();
        state.paletteMarker = null;
    }
}

// ==================== 框选 ====================
function beginMarquee(event, panelView) {
    if (state.preview || state.drag || state.marquee) return;

    const marqueeEl = createEl('div', 'editor-marquee');
    marqueeEl.style.display = 'none';
    document.body.appendChild(marqueeEl);

    state.marquee = {
        panelId: panelView.model.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        active: false,
        el: marqueeEl,
    };
    state.activePanelId = panelView.model.id;
    document.body.classList.add('is-marquee-dragging');
    window.addEventListener('pointermove', onMarqueeMove);
    window.addEventListener('pointerup', onMarqueeEnd);
    window.addEventListener('pointercancel', onMarqueeCancel);
    capturePointer(panelView.panelDiv, event);
    if (event.cancelable) event.preventDefault();
    setMessage('拖动框选组件；松开完成');
}

function onMarqueeMove(event) {
    const marquee = state.marquee;
    if (!marquee) return;
    if (marquee.pointerId !== undefined && event.pointerId !== undefined &&
        event.pointerId !== marquee.pointerId) return;
    if (event.cancelable) event.preventDefault();

    marquee.currentX = event.clientX;
    marquee.currentY = event.clientY;
    const dx = Math.abs(marquee.currentX - marquee.startX);
    const dy = Math.abs(marquee.currentY - marquee.startY);

    if (!marquee.active && (dx > MARQUEE_THRESHOLD || dy > MARQUEE_THRESHOLD)) {
        marquee.active = true;
        marquee.el.style.display = 'block';
    }
    if (!marquee.active) return;

    const left = Math.min(marquee.startX, marquee.currentX);
    const top = Math.min(marquee.startY, marquee.currentY);
    marquee.el.style.left = `${left}px`;
    marquee.el.style.top = `${top}px`;
    marquee.el.style.width = `${dx}px`;
    marquee.el.style.height = `${dy}px`;
}

function getMarqueeRect(marquee) {
    return {
        left: Math.min(marquee.startX, marquee.currentX),
        top: Math.min(marquee.startY, marquee.currentY),
        right: Math.max(marquee.startX, marquee.currentX),
        bottom: Math.max(marquee.startY, marquee.currentY),
    };
}

function onMarqueeEnd(event) {
    const marquee = state.marquee;
    if (!marquee) return;
    if (marquee.pointerId !== undefined && event.pointerId !== undefined &&
        event.pointerId !== marquee.pointerId) return;

    const panelId = marquee.panelId;
    const active = marquee.active;
    const rect = getMarqueeRect(marquee);
    clearMarqueeArtifacts();

    if (!active) {
        selectPanel(panelId);
        return;
    }

    const panelView = state.panelViews.get(panelId);
    if (!panelView) return;

    const selectedIds = panelView.model.components
        .filter((component) => {
            const view = state.componentViews.get(component.id);
            if (!view) return false;
            const bounds = view.wrapper.getBoundingClientRect();
            return bounds.left >= rect.left &&
                bounds.right <= rect.right &&
                bounds.top >= rect.top &&
                bounds.bottom <= rect.bottom;
        })
        .map((component) => component.id);

    if (selectedIds.length) {
        selectComponents(panelId, selectedIds, selectedIds[0]);
        setMessage(`已框选 ${selectedIds.length} 个组件`);
    } else {
        selectNothing();
        setMessage('框选范围内没有组件');
    }
}

function onMarqueeCancel(event) {
    const marquee = state.marquee;
    if (!marquee) return;
    if (marquee.pointerId !== undefined && event?.pointerId !== undefined &&
        event.pointerId !== marquee.pointerId) return;
    clearMarqueeArtifacts();
    setMessage('已取消框选');
}

function clearMarqueeArtifacts() {
    if (!state.marquee) return;
    state.marquee.el?.remove();
    window.removeEventListener('pointermove', onMarqueeMove);
    window.removeEventListener('pointerup', onMarqueeEnd);
    window.removeEventListener('pointercancel', onMarqueeCancel);
    state.marquee = null;
    document.body.classList.remove('is-marquee-dragging');
}

// ==================== 选择 ====================
function selectComponent(panelId, componentId) {
    state.selected = { kind: 'component', panelId, componentId };
    state.activePanelId = panelId;
    refreshSelectionUI();
    renderInspector();
    updateStatus();
}

function selectComponents(panelId, componentIds, primaryId = null) {
    const uniqueIds = [...new Set(componentIds)].filter((id) =>
        findComponentModel(panelId, id)
    );
    if (!uniqueIds.length) {
        selectNothing();
        return;
    }
    if (uniqueIds.length === 1) {
        selectComponent(panelId, uniqueIds[0]);
        return;
    }
    const primary = uniqueIds.includes(primaryId) ? primaryId : uniqueIds[0];
    state.selected = {
        kind: 'components',
        panelId,
        componentIds: uniqueIds,
        primaryId: primary,
    };
    state.activePanelId = panelId;
    refreshSelectionUI();
    renderInspector();
    updateStatus();
}

function toggleComponentSelection(panelId, componentId) {
    const currentIds = getSelectedPanelId() === panelId
        ? getSelectedComponentIds()
        : [];
    const ids = new Set(currentIds);
    if (ids.has(componentId)) ids.delete(componentId);
    else ids.add(componentId);

    const nextIds = [...ids];
    if (!nextIds.length) {
        selectNothing();
    } else if (nextIds.length === 1) {
        selectComponent(panelId, nextIds[0]);
    } else {
        selectComponents(panelId, nextIds, nextIds[0]);
    }
}

function selectPanel(panelId) {
    state.selected = { kind: 'panel', panelId };
    state.activePanelId = panelId;
    refreshSelectionUI();
    renderInspector();
    updateStatus();
}

function selectNothing() {
    state.selected = null;
    refreshSelectionUI();
    renderInspector();
    updateStatus();
}

function refreshSelectionUI() {
    const selected = state.selected;
    const selectedIds = new Set(getSelectedComponentIds(selected));
    const selectedPanelId = getSelectedPanelId(selected);
    const isMulti = selected?.kind === 'components' && selectedIds.size > 1;

    state.componentViews.forEach((view) => {
        const isSelected = selectedIds.has(view.model.id) &&
            view.panelId === selectedPanelId;
        view.overlay.classList.toggle('is-selected', isSelected);
        view.overlay.classList.toggle('is-multi-selected', isSelected && isMulti);
        view.wrapper.classList.toggle('is-editor-selected', isSelected);
    });
    state.panelViews.forEach((view) => {
        const isSelected = selected?.kind === 'panel' && selected.panelId === view.model.id;
        view.hostEl.classList.toggle('is-selected', isSelected);
    });
}

function updateStatus() {
    const selected = state.selected;
    if (!selected) {
        dom.statusSelection.textContent = '未选择对象';
        dom.workspaceHint.textContent = '选择面板或组件开始编辑';
        return;
    }
    if (selected.kind === 'panel') {
        dom.statusSelection.textContent = `面板：${selected.panelId}`;
        dom.workspaceHint.textContent = '面板已选中，可在右侧修改网格参数';
        return;
    }
    if (selected.kind === 'components') {
        dom.statusSelection.textContent = `已选择 ${selected.componentIds.length} 个组件`;
        dom.workspaceHint.textContent = '拖动任一选中组件可整组移动；Shift / Ctrl 点击增减选择';
        return;
    }
    const component = findComponentModel(selected.panelId, selected.componentId);
    if (!component) {
        dom.statusSelection.textContent = '未选择对象';
        dom.workspaceHint.textContent = '选择面板或组件开始编辑';
        return;
    }
    dom.statusSelection.textContent = `组件：${getComponentLabel(component.type)} · ${component.id}`;
    dom.workspaceHint.textContent = `第 ${component.grid.row} 行 / 第 ${component.grid.col} 列 · 拖动移动，拖动边角缩放`;
}

// ==================== 属性面板 ====================
function renderInspector() {
    dom.inspector.replaceChildren();
    const selected = state.selected;

    if (selected?.kind === 'component') {
        const location = findComponentLocation(selected.componentId);
        if (!location) {
            selectNothing();
            return;
        }
        dom.inspectorKind.textContent = '组件';
        renderComponentInspector(location.panel, location.component);
        return;
    }

    if (selected?.kind === 'components') {
        const panel = findPanelModel(selected.panelId);
        const components = selected.componentIds
            .map((id) => findComponentModel(selected.panelId, id))
            .filter(Boolean);
        if (!panel || !components.length) {
            selectNothing();
            return;
        }
        if (components.length === 1) {
            selectComponent(selected.panelId, components[0].id);
            return;
        }
        dom.inspectorKind.textContent = '多选';
        renderMultiComponentInspector(panel, components);
        return;
    }

    if (selected?.kind === 'panel') {
        const panel = findPanelModel(selected.panelId);
        if (!panel) {
            selectNothing();
            return;
        }
        dom.inspectorKind.textContent = '面板';
        renderPanelInspector(panel);
        return;
    }

    dom.inspectorKind.textContent = '项目';
    renderProjectInspector();
}

function createObjectHead(icon, title, subtitle) {
    const head = createEl('div', 'inspector-object-head');
    head.appendChild(createEl('div', 'inspector-object-icon', icon));
    const copy = createEl('div', 'inspector-object-copy');
    copy.appendChild(createEl('strong', '', title));
    copy.appendChild(createEl('small', '', subtitle));
    head.appendChild(copy);
    return head;
}

function createFieldRow(field, value, handlers = {}) {
    const row = createEl('div', 'field-row');
    const label = createEl('label');
    label.appendChild(document.createTextNode(field.label));
    row.appendChild(label);

    let input;
    const commit = () => {
        if (handlers.onCommit) handlers.onCommit();
    };

    if (field.type === 'boolean') {
        const wrap = createEl('div', 'field-checkbox');
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = value === true;
        const checkId = `field-check-${Math.random().toString(36).slice(2, 9)}`;
        input.id = checkId;
        const checkboxLabel = createEl('label', '', field.checkboxLabel || '启用');
        checkboxLabel.htmlFor = checkId;
        wrap.appendChild(input);
        wrap.appendChild(checkboxLabel);
        input.addEventListener('change', () => {
            if (handlers.onInput) handlers.onInput(input.checked);
            commit();
        });
        row.appendChild(wrap);
    } else if (field.type === 'select') {
        input = document.createElement('select');
        const options = field.options || [];
        options.forEach((option) => {
            const optionEl = document.createElement('option');
            optionEl.value = getOptionValue(option);
            optionEl.textContent = getOptionLabel(option);
            input.appendChild(optionEl);
        });
        input.value = String(value);
        input.addEventListener('change', () => {
            if (handlers.onInput) handlers.onInput(input.value);
            commit();
        });
        row.appendChild(input);
    } else if (field.type === 'color') {
        const wrap = createEl('div', 'field-color-wrap');
        input = document.createElement('input');
        input.type = 'text';
        input.value = String(value ?? '');
        input.spellcheck = false;
        input.placeholder = 'green / #40c860';

        const listId = `color-list-${Math.random().toString(36).slice(2, 9)}`;
        const datalist = document.createElement('datalist');
        datalist.id = listId;
        (field.suggestions || []).forEach((suggestion) => {
            const optionEl = document.createElement('option');
            optionEl.value = suggestion;
            datalist.appendChild(optionEl);
        });
        input.setAttribute('list', listId);

        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.className = 'field-color-swatch';
        swatch.value = toHexColor(input.value);
        swatch.title = '选择颜色';

        input.addEventListener('input', () => {
            swatch.value = toHexColor(input.value);
            if (handlers.onInput) handlers.onInput(input.value);
        });
        input.addEventListener('change', commit);
        swatch.addEventListener('input', () => {
            input.value = swatch.value;
            if (handlers.onInput) handlers.onInput(swatch.value);
        });
        swatch.addEventListener('change', commit);

        wrap.appendChild(input);
        wrap.appendChild(swatch);
        wrap.appendChild(datalist);
        row.appendChild(wrap);
    } else if (field.type === 'array') {
        input = document.createElement('input');
        input.type = 'text';
        input.value = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        input.spellcheck = false;
        input.addEventListener('input', () => {
            if (handlers.onInput) handlers.onInput(parseArrayInput(input.value));
        });
        input.addEventListener('change', commit);
        row.appendChild(input);
    } else if (field.type === 'numberArray') {
        input = document.createElement('input');
        input.type = 'text';
        input.value = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        input.spellcheck = false;
        input.addEventListener('input', () => {
            if (handlers.onInput) handlers.onInput(parseNumberArrayInput(input.value));
        });
        input.addEventListener('change', commit);
        row.appendChild(input);
    } else {
        input = document.createElement('input');
        input.type = field.type === 'number' ? 'number' : 'text';
        if (field.type === 'number') {
            if (field.min !== undefined) input.min = field.min;
            if (field.max !== undefined) input.max = field.max;
            input.step = field.step !== undefined ? field.step : (field.integer ? 1 : 'any');
        }
        input.value = value === undefined || value === null ? '' : String(value);
        input.spellcheck = false;
        if (field.placeholder) input.placeholder = field.placeholder;
        input.addEventListener('input', () => {
            if (field.type === 'number') {
                if (input.value === '' || input.value === '-') return;
                const number = Number(input.value);
                if (!Number.isFinite(number)) return;
                if (handlers.onInput) handlers.onInput(field.integer ? Math.round(number) : number);
            } else if (handlers.onInput) {
                handlers.onInput(input.value);
            }
        });
        input.addEventListener('change', commit);
        row.appendChild(input);
    }

    if (field.hint) {
        row.appendChild(createEl('div', 'field-hint', field.hint));
    }
    return row;
}

function createIdField(component) {
    const row = createEl('div', 'field-row');
    const label = createEl('label');
    label.appendChild(document.createTextNode('组件 ID'));
    row.appendChild(label);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = component.id;
    input.spellcheck = false;
    input.addEventListener('change', () => {
        const success = renameComponent(component.id, input.value);
        if (!success) renderInspector();
    });
    row.appendChild(input);
    row.appendChild(createEl('div', 'field-hint', '用于 updateDisplay 等 API 查找组件，必须唯一'));
    return row;
}

function createSection(title) {
    const section = createEl('div', 'inspector-section');
    section.appendChild(createEl('div', 'inspector-section-title', title));
    return section;
}

function renderComponentInspector(panel, component) {
    const definition = getComponentDefinition(component.type);
    if (!definition) return;

    dom.inspector.appendChild(createObjectHead(
        definition.icon,
        definition.label,
        `${component.type} · ${component.id}`
    ));

    const basic = createSection('基本信息');
    basic.appendChild(createIdField(component));
    dom.inspector.appendChild(basic);

    const propsSection = createSection('组件参数');
    definition.fields.forEach((field) => {
        propsSection.appendChild(createFieldRow(field, component.props[field.key], {
            onInput: (value) => updateComponentProp(component, field.key, value),
            onCommit: () => scheduleHistory(0),
        }));
    });
    dom.inspector.appendChild(propsSection);

    const layoutSection = createSection('位置与尺寸（网格）');
    const layoutFields = [
        { key: 'row', label: '行', min: 1, max: panel.rows },
        { key: 'col', label: '列', min: 1, max: panel.columns },
        { key: 'rowSpan', label: '行跨度', min: 1, max: panel.rows },
        { key: 'colSpan', label: '列跨度', min: 1, max: panel.columns },
    ];
    layoutFields.forEach((field) => {
        layoutSection.appendChild(createFieldRow(
            { ...field, type: 'number', step: 1, integer: true },
            component.grid[field.key],
            {
                onCommit: () => {
                    const input = layoutSection.querySelectorAll('input')[layoutFields.indexOf(field)];
                    const value = Number(input?.value);
                    if (!Number.isFinite(value)) {
                        renderInspector();
                        return;
                    }
                    applyGridFromInspector(panel.id, component.id, field.key, value);
                },
            }
        ));
    });
    dom.inspector.appendChild(layoutSection);

    const actions = createEl('div', 'inspector-actions');
    const duplicateBtn = createEl('button', 'inspector-btn', '复制组件');
    duplicateBtn.type = 'button';
    duplicateBtn.addEventListener('click', duplicateSelectedComponent);
    const deleteBtn = createEl('button', 'inspector-btn danger', '删除组件');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', deleteSelectedComponent);
    actions.appendChild(duplicateBtn);
    actions.appendChild(deleteBtn);
    dom.inspector.appendChild(actions);

    dom.inspector.appendChild(createEl(
        'div',
        'inspector-note',
        '提示：预览模式下组件会按当前初始值展示，并可正常操作；不包含自定义事件代码。'
    ));
}

function renderMultiComponentInspector(panel, components) {
    const bounds = getGroupBounds(components);
    dom.inspector.appendChild(createObjectHead(
        '▦',
        '已选择多个组件',
        `${components.length} 个组件 · ${panel.id}`
    ));

    const summary = createSection('选择统计');
    const statGrid = createEl('div', 'inspector-stats');
    const countStat = createEl('div', 'inspector-stat');
    countStat.appendChild(createEl('strong', '', String(components.length)));
    countStat.appendChild(createEl('span', '', '已选组件'));
    const boundsStat = createEl('div', 'inspector-stat');
    boundsStat.appendChild(createEl('strong', '', `${bounds.colSpan} × ${bounds.rowSpan}`));
    boundsStat.appendChild(createEl('span', '', '网格跨度'));
    statGrid.appendChild(countStat);
    statGrid.appendChild(boundsStat);
    summary.appendChild(statGrid);
    dom.inspector.appendChild(summary);

    const listSection = createSection('组件列表');
    const list = createEl('div', 'multi-selection-list');
    components.forEach((component) => {
        const item = createEl('div', 'multi-selection-item');
        const copy = createEl('div', 'multi-selection-copy');
        copy.appendChild(createEl('strong', '', getComponentLabel(component.type)));
        copy.appendChild(createEl('small', '', component.id));
        item.appendChild(copy);
        item.appendChild(createEl(
            'span',
            'multi-selection-grid',
            `${component.grid.colSpan} × ${component.grid.rowSpan}`
        ));
        list.appendChild(item);
    });
    listSection.appendChild(list);
    dom.inspector.appendChild(listSection);

    const actions = createEl('div', 'inspector-actions');
    const duplicateBtn = createEl('button', 'inspector-btn', '复制所选');
    duplicateBtn.type = 'button';
    duplicateBtn.addEventListener('click', duplicateSelectedComponent);
    const deleteBtn = createEl('button', 'inspector-btn danger', '删除所选');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', deleteSelectedComponent);
    actions.appendChild(duplicateBtn);
    actions.appendChild(deleteBtn);
    dom.inspector.appendChild(actions);

    dom.inspector.appendChild(createEl(
        'div',
        'inspector-note',
        '拖动任一选中组件可整体移动；多选模式下不支持单组件属性和缩放编辑。'
    ));
}

function renderPanelInspector(panel) {
    dom.inspector.appendChild(createObjectHead(
        '▦',
        '面板',
        `${panel.id} · ${panel.components.length} 个组件`
    ));

    const section = createSection('网格参数');
    const fields = [
        { key: 'columns', label: '列数', min: 1, max: 64 },
        { key: 'rows', label: '行数', min: 1, max: 64 },
        { key: 'cellSize', label: '单元格大小 (px)', min: 20, max: 160 },
        { key: 'gap', label: '单元格间距 (px)', min: 0, max: 40 },
    ];
    fields.forEach((field, index) => {
        section.appendChild(createFieldRow(
            { ...field, type: 'number', step: 1, integer: true },
            panel[field.key],
            {
                onCommit: () => {
                    const inputs = section.querySelectorAll('input');
                    const value = Number(inputs[index]?.value);
                    if (!Number.isFinite(value)) {
                        renderInspector();
                        return;
                    }
                    updatePanelSettings(panel.id, field.key, value);
                },
            }
        ));
    });
    dom.inspector.appendChild(section);

    const stats = createSection('统计');
    const statGrid = createEl('div', 'inspector-stats');
    const panelStat = createEl('div', 'inspector-stat');
    panelStat.appendChild(createEl('strong', '', String(state.project.panels.length)));
    panelStat.appendChild(createEl('span', '', '项目面板数'));
    const componentStat = createEl('div', 'inspector-stat');
    componentStat.appendChild(createEl('strong', '', String(panel.components.length)));
    componentStat.appendChild(createEl('span', '', '本面板组件'));
    statGrid.appendChild(panelStat);
    statGrid.appendChild(componentStat);
    stats.appendChild(statGrid);
    dom.inspector.appendChild(stats);

    const actions = createEl('div', 'inspector-actions');
    const addBtn = createEl('button', 'inspector-btn', '添加面板');
    addBtn.type = 'button';
    addBtn.addEventListener('click', addPanel);
    const deleteBtn = createEl('button', 'inspector-btn danger', '删除此面板');
    deleteBtn.type = 'button';
    deleteBtn.disabled = state.project.panels.length <= 1;
    deleteBtn.addEventListener('click', () => deletePanel(panel.id));
    actions.appendChild(addBtn);
    actions.appendChild(deleteBtn);
    dom.inspector.appendChild(actions);
}

function renderProjectInspector() {
    const componentCount = state.project.panels.reduce(
        (sum, panel) => sum + panel.components.length,
        0
    );

    dom.inspector.appendChild(createObjectHead('◇', state.project.name, '项目概览'));

    const stats = createSection('项目统计');
    const statGrid = createEl('div', 'inspector-stats');
    const panelStat = createEl('div', 'inspector-stat');
    panelStat.appendChild(createEl('strong', '', String(state.project.panels.length)));
    panelStat.appendChild(createEl('span', '', '面板'));
    const componentStat = createEl('div', 'inspector-stat');
    componentStat.appendChild(createEl('strong', '', String(componentCount)));
    componentStat.appendChild(createEl('span', '', '组件'));
    statGrid.appendChild(panelStat);
    statGrid.appendChild(componentStat);
    stats.appendChild(statGrid);
    dom.inspector.appendChild(stats);

    const panelSection = createSection('面板列表');
    state.project.panels.forEach((panel) => {
        const button = createEl('button', 'palette-item inspector-panel-item');
        button.type = 'button';
        button.style.marginBottom = '6px';
        button.appendChild(createEl('span', 'palette-icon', '▦'));
        const copy = createEl('span', 'palette-copy');
        copy.appendChild(createEl('strong', '', panel.id));
        copy.appendChild(createEl('small', '', `${panel.columns} × ${panel.rows} · ${panel.components.length} 个组件`));
        button.appendChild(copy);
        button.addEventListener('click', () => selectPanel(panel.id));
        panelSection.appendChild(button);
    });
    dom.inspector.appendChild(panelSection);

    const actions = createEl('div', 'inspector-actions');
    const addBtn = createEl('button', 'inspector-btn', '添加面板');
    addBtn.type = 'button';
    addBtn.addEventListener('click', addPanel);
    actions.appendChild(addBtn);
    dom.inspector.appendChild(actions);

    dom.inspector.appendChild(createEl(
        'div',
        'inspector-note',
        '从左侧组件库拖动组件到画布，或单击组件添加到当前面板。编辑器只保存界面结构和初始值，不包含事件代码；项目会自动保存到浏览器本地，也可以导出为 JSON 文件。'
    ));
}

// ==================== 属性修改 ====================
function updateComponentProp(component, key, value) {
    component.props = normalizeComponentProps(component.type, {
        ...component.props,
        [key]: value,
    });
    scheduleComponentRebuild(component.id);
    scheduleHistory();
    scheduleAutosave();
    updateStatus();
}

function scheduleComponentRebuild(componentId) {
    if (state.pendingRebuilds.has(componentId)) return;
    const timer = window.setTimeout(() => {
        state.pendingRebuilds.delete(componentId);
        const view = state.componentViews.get(componentId);
        if (!view) return;
        rebuildComponentView(view.panelId, componentId);
    }, 0);
    state.pendingRebuilds.set(componentId, timer);
}

function rebuildComponentView(panelId, componentId) {
    const panelView = state.panelViews.get(panelId);
    const oldView = state.componentViews.get(componentId);
    if (!panelView || !oldView) return;

    const model = oldView.model;
    try {
        oldView.component.destroy();
    } catch (error) {
        console.warn(error);
    }
    state.componentViews.delete(componentId);
    createComponentView(panelView, model);
    refreshSelectionUI();
    updateStatus();
}

function renameComponent(oldId, rawNewId) {
    const location = findComponentLocation(oldId);
    if (!location) return false;

    const newId = normalizeIdText(rawNewId);
    if (!newId) {
        toast('组件 ID 不能为空', 'error');
        return false;
    }
    if (newId === oldId) return true;
    if (collectUsedComponentIds().has(newId)) {
        toast(`组件 ID "${newId}" 已存在`, 'error');
        return false;
    }

    const component = location.component;
    component.id = newId;
    const oldView = state.componentViews.get(oldId);
    if (oldView) {
        try {
            oldView.component.destroy();
        } catch (error) {
            console.warn(error);
        }
        state.componentViews.delete(oldId);
    }
    const panelView = state.panelViews.get(location.panel.id);
    createComponentView(panelView, component);
    if (state.selected?.kind === 'component' && state.selected.componentId === oldId) {
        state.selected.componentId = newId;
    } else if (state.selected?.kind === 'components') {
        const index = state.selected.componentIds.indexOf(oldId);
        if (index !== -1) {
            state.selected.componentIds[index] = newId;
            if (state.selected.primaryId === oldId) {
                state.selected.primaryId = newId;
            }
        }
    }
    pushHistory();
    scheduleAutosave();
    refreshSelectionUI();
    renderInspector();
    updateStatus();
    setMessage(`组件 ID 已改为 ${newId}`);
    return true;
}

function applyGridFromInspector(panelId, componentId, fieldKey, value) {
    const location = findComponentLocation(componentId);
    if (!location || location.panel.id !== panelId) return;
    const candidate = { ...location.component.grid, [fieldKey]: value };
    if (!setComponentGrid(panelId, componentId, candidate, { push: true })) {
        toast('无法应用该位置：超出面板范围或与其他组件重叠', 'error');
        renderInspector();
    }
}

function setComponentGrid(panelId, componentId, grid, options = {}) {
    const panel = findPanelModel(panelId);
    const component = findComponentModel(panelId, componentId);
    const panelView = state.panelViews.get(panelId);
    if (!panel || !component || !panelView) return false;

    const candidate = clampGridToPanel(panel, grid);
    if (!isGridFree(panel, candidate, componentId)) return false;

    component.grid = candidate;
    const view = state.componentViews.get(componentId);
    if (view) {
        view.component.setGridPosition(
            candidate.row,
            candidate.col,
            candidate.rowSpan,
            candidate.colSpan
        );
    }
    if (options.push !== false) {
        pushHistory();
        scheduleAutosave();
    }
    if (options.refreshInspector) renderInspector();
    updateStatus();
    return true;
}

function moveSelectionBy(rowDelta, colDelta) {
    const selected = state.selected;
    if (!selected || selected.kind === 'panel') return false;
    const panel = findPanelModel(selected.panelId);
    const ids = getSelectedComponentIds();
    if (!panel || !ids.length) return false;

    const models = ids
        .map((id) => findComponentModel(panel.id, id))
        .filter(Boolean);
    if (!models.length) return false;

    const grids = models.map((model) => ({
        row: model.grid.row + rowDelta,
        col: model.grid.col + colDelta,
        rowSpan: model.grid.rowSpan,
        colSpan: model.grid.colSpan,
    }));
    if (!isGroupFree(panel, grids, ids)) {
        return false;
    }

    models.forEach((model, index) => {
        const grid = grids[index];
        model.grid = grid;
        const view = state.componentViews.get(model.id);
        if (view) {
            view.component.setGridPosition(
                grid.row,
                grid.col,
                grid.rowSpan,
                grid.colSpan
            );
        }
    });
    scheduleHistory(250);
    scheduleAutosave();
    renderInspector();
    updateStatus();
    return true;
}

function updatePanelSettings(panelId, key, rawValue) {
    const panel = findPanelModel(panelId);
    if (!panel) return;

    const limits = {
        columns: { min: 1, max: 64 },
        rows: { min: 1, max: 64 },
        cellSize: { min: 20, max: 160 },
        gap: { min: 0, max: 40 },
    };
    const limit = limits[key];
    if (!limit) return;
    const value = clampInt(rawValue, limit.min, limit.max);

    if (key === 'columns' || key === 'rows') {
        const extent = panel.components.reduce((max, component) => {
            const end = key === 'columns'
                ? component.grid.col + component.grid.colSpan - 1
                : component.grid.row + component.grid.rowSpan - 1;
            return Math.max(max, end);
        }, 1);
        if (value < extent) {
            toast(`${key === 'columns' ? '列数' : '行数'}不能小于已有组件占用的 ${extent}`, 'error');
            renderInspector();
            return;
        }
    }

    panel[key] = value;
    renderAll();
    selectPanel(panelId);
    pushHistory();
    scheduleAutosave();
    setMessage(`面板参数已更新`);
}

// ==================== 组件增删 / 复制 ====================
function generateComponentId(type) {
    const definition = getComponentDefinition(type);
    const prefix = definition?.prefix || 'cmp';
    const used = collectUsedComponentIds();
    let index = 1;
    while (used.has(`${prefix}-${index}`)) index += 1;
    return makeUniqueId(`${prefix}-${index}`, used);
}

function addComponent(type, panelId, preferredGrid = {}) {
    const panelView = state.panelViews.get(panelId);
    if (!panelView) return null;
    const panel = panelView.model;
    const definition = getComponentDefinition(type);
    if (!definition) return null;

    const defaultGrid = getDefaultGrid(type, panel);
    const rowSpan = clampInt(preferredGrid.rowSpan ?? defaultGrid.rowSpan, 1, panel.rows);
    const colSpan = clampInt(preferredGrid.colSpan ?? defaultGrid.colSpan, 1, panel.columns);
    const preferredRow = clampInt(preferredGrid.row ?? 1, 1, panel.rows);
    const preferredCol = clampInt(preferredGrid.col ?? 1, 1, panel.columns);
    const grid = findFreeGrid(panel, rowSpan, colSpan, {
        row: preferredRow,
        col: preferredCol,
    });
    if (!grid) {
        toast('当前面板没有足够的空闲空间', 'error');
        return null;
    }

    const componentModel = {
        id: generateComponentId(type),
        type,
        grid,
        props: normalizeComponentProps(type, cloneProps(definition.defaults)),
    };
    panel.components.push(componentModel);
    createComponentView(panelView, componentModel);
    state.activePanelId = panelId;
    selectComponent(panelId, componentModel.id);
    pushHistory();
    scheduleAutosave();
    setMessage(`已添加 ${definition.label}`);
    return componentModel.id;
}

function insertComponentModel(panelId, componentModel, options = {}) {
    const panelView = state.panelViews.get(panelId);
    const panel = findPanelModel(panelId);
    if (!panelView || !panel) return false;
    panel.components.push(componentModel);
    createComponentView(panelView, componentModel);
    if (options.select !== false) {
        selectComponent(panelId, componentModel.id);
    }
    if (options.push !== false) {
        pushHistory();
        scheduleAutosave();
    }
    return true;
}

function removeComponent(panelId, componentId, options = {}) {
    const panel = findPanelModel(panelId);
    if (!panel) return false;
    const index = panel.components.findIndex((component) => component.id === componentId);
    if (index === -1) return false;

    const view = state.componentViews.get(componentId);
    if (view) {
        try {
            view.component.destroy();
        } catch (error) {
            console.warn(error);
        }
        state.componentViews.delete(componentId);
    }
    panel.components.splice(index, 1);

    if (!options.keepSelection) {
        if (state.selected?.kind === 'component' &&
            state.selected.componentId === componentId) {
            selectPanel(panelId);
        } else if (state.selected?.kind === 'components' &&
            state.selected.componentIds.includes(componentId)) {
            const remaining = state.selected.componentIds.filter((id) => id !== componentId);
            if (!remaining.length) {
                selectPanel(panelId);
            } else if (remaining.length === 1) {
                selectComponent(panelId, remaining[0]);
            } else {
                selectComponents(
                    panelId,
                    remaining,
                    state.selected.primaryId === componentId
                        ? remaining[0]
                        : state.selected.primaryId
                );
            }
        } else {
            refreshSelectionUI();
            renderInspector();
        }
    }

    if (options.push !== false) {
        pushHistory();
        scheduleAutosave();
    }
    if (!options.silent) setMessage('组件已删除');
    return true;
}

function deleteSelectedComponent() {
    const selected = state.selected;
    if (selected?.kind === 'component') {
        removeComponent(selected.panelId, selected.componentId);
        return;
    }
    if (selected?.kind !== 'components') return;

    const panelId = selected.panelId;
    const componentIds = [...selected.componentIds];
    componentIds.forEach((componentId) => {
        removeComponent(panelId, componentId, {
            push: false,
            keepSelection: true,
            silent: true,
        });
    });
    selectPanel(panelId);
    pushHistory();
    scheduleAutosave();
    setMessage(`已删除 ${componentIds.length} 个组件`);
}

function findGroupDuplicateOffset(panel, models, bounds) {
    const rowMin = 1 - bounds.row;
    const rowMax = panel.rows - (bounds.row + bounds.rowSpan - 1);
    const colMin = 1 - bounds.col;
    const colMax = panel.columns - (bounds.col + bounds.colSpan - 1);

    const isOffsetFree = (rowOffset, colOffset) => {
        if (rowOffset < rowMin || rowOffset > rowMax ||
            colOffset < colMin || colOffset > colMax) {
            return false;
        }
        const grids = models.map((model) => ({
            row: model.grid.row + rowOffset,
            col: model.grid.col + colOffset,
            rowSpan: model.grid.rowSpan,
            colSpan: model.grid.colSpan,
        }));
        return isGroupFree(panel, grids, []);
    };

    const preferred = [
        { row: 0, col: Math.max(1, bounds.colSpan) },
        { row: Math.max(1, bounds.rowSpan), col: 0 },
    ];
    for (const offset of preferred) {
        if (isOffsetFree(offset.row, offset.col)) return offset;
    }

    let best = null;
    let bestScore = Infinity;
    for (let rowOffset = rowMin; rowOffset <= rowMax; rowOffset += 1) {
        for (let colOffset = colMin; colOffset <= colMax; colOffset += 1) {
            if (rowOffset === 0 && colOffset === 0) continue;
            if (!isOffsetFree(rowOffset, colOffset)) continue;
            const score = Math.abs(rowOffset) * 2 +
                Math.abs(colOffset - Math.max(1, bounds.colSpan));
            if (score < bestScore) {
                bestScore = score;
                best = { row: rowOffset, col: colOffset };
            }
        }
    }
    return best;
}

function duplicateSelectedComponent() {
    const selected = state.selected;
    if (!selected) return;

    if (selected.kind === 'components') {
        const panel = findPanelModel(selected.panelId);
        if (!panel) return;
        const models = selected.componentIds
            .map((id) => findComponentModel(selected.panelId, id))
            .filter(Boolean);
        if (models.length <= 1) {
            if (models.length === 1) {
                selectComponent(selected.panelId, models[0].id);
                duplicateSelectedComponent();
            }
            return;
        }

        const bounds = getGroupBounds(models);
        const offset = findGroupDuplicateOffset(panel, models, bounds);
        if (!offset) {
            toast('当前面板没有足够的空闲空间', 'error');
            return;
        }

        const panelView = state.panelViews.get(panel.id);
        if (!panelView) return;
        const used = collectUsedComponentIds();
        const copies = models.map((source) => ({
            id: makeUniqueId(`${source.id}-copy`, used),
            type: source.type,
            grid: {
                ...source.grid,
                row: source.grid.row + offset.row,
                col: source.grid.col + offset.col,
            },
            props: normalizeComponentProps(source.type, cloneProps(source.props)),
        }));
        copies.forEach((copy) => {
            panel.components.push(copy);
            createComponentView(panelView, copy);
        });
        selectComponents(panel.id, copies.map((copy) => copy.id), copies[0].id);
        pushHistory();
        scheduleAutosave();
        setMessage(`已复制 ${copies.length} 个组件`);
        return;
    }

    if (selected.kind !== 'component') return;
    const location = findComponentLocation(selected.componentId);
    if (!location) return;

    const source = location.component;
    const definition = getComponentDefinition(source.type);
    const used = collectUsedComponentIds();
    const baseId = `${source.id}-copy`;
    const newId = makeUniqueId(baseId, used);
    const grid = findFreeGrid(
        location.panel,
        source.grid.rowSpan,
        source.grid.colSpan,
        {
            row: source.grid.row,
            col: source.grid.col + source.grid.colSpan,
        }
    );
    if (!grid) {
        toast('当前面板没有足够的空闲空间', 'error');
        return;
    }

    const copy = {
        id: newId,
        type: source.type,
        grid,
        props: normalizeComponentProps(source.type, cloneProps(source.props)),
    };
    insertComponentModel(location.panel.id, copy);
    setMessage(`已复制为 ${definition?.label || source.type} · ${newId}`);
}

function addPanel() {
    const used = collectUsedPanelIds();
    let index = state.project.panels.length + 1;
    while (used.has(`panel-${index}`)) index += 1;
    const panelModel = createPanelModel(`panel-${index}`);
    state.project.panels.push(panelModel);
    renderAll();
    selectPanel(panelModel.id);
    pushHistory();
    scheduleAutosave();
    setMessage(`已添加面板 ${panelModel.id}`);
    dom.canvas.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function deletePanel(panelId) {
    if (state.project.panels.length <= 1) {
        toast('项目至少需要保留一个面板', 'error');
        return;
    }
    const panel = findPanelModel(panelId);
    if (!panel) return;
    if (!window.confirm(`确定删除面板 ${panel.id} 及其 ${panel.components.length} 个组件吗？`)) {
        return;
    }
    const index = state.project.panels.findIndex((item) => item.id === panelId);
    state.project.panels.splice(index, 1);
    if (state.selected?.panelId === panelId) state.selected = null;
    if (state.activePanelId === panelId) {
        state.activePanelId = state.project.panels[0]?.id || null;
    }
    renderAll();
    selectNothing();
    pushHistory();
    scheduleAutosave();
    setMessage(`面板 ${panelId} 已删除`);
}

// ==================== 网格几何 ====================
function getPanelMetrics(panelView) {
    const panelDiv = panelView.panelDiv;
    const rect = panelDiv.getBoundingClientRect();
    const style = getComputedStyle(panelDiv);
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    return {
        left: rect.left + borderLeft + paddingLeft,
        top: rect.top + borderTop + paddingTop,
        paddingLeft,
        paddingTop,
        step: panelView.model.cellSize + panelView.model.gap,
    };
}

function pointToCell(panelView, clientX, clientY) {
    const metrics = getPanelMetrics(panelView);
    const model = panelView.model;
    const col = Math.floor((clientX - metrics.left) / metrics.step) + 1;
    const row = Math.floor((clientY - metrics.top) / metrics.step) + 1;
    return {
        row: clampInt(row, 1, model.rows),
        col: clampInt(col, 1, model.columns),
    };
}

function positionOverlayElement(panelView, element, grid) {
    const style = getComputedStyle(panelView.panelDiv);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const model = panelView.model;
    const step = model.cellSize + model.gap;
    element.style.left = `${paddingLeft + (grid.col - 1) * step}px`;
    element.style.top = `${paddingTop + (grid.row - 1) * step}px`;
    element.style.width = `${grid.colSpan * model.cellSize + (grid.colSpan - 1) * model.gap}px`;
    element.style.height = `${grid.rowSpan * model.cellSize + (grid.rowSpan - 1) * model.gap}px`;
}

function clampGridToPanel(panel, grid) {
    const rowSpan = clampInt(grid.rowSpan ?? 1, 1, panel.rows);
    const colSpan = clampInt(grid.colSpan ?? 1, 1, panel.columns);
    return {
        row: clampInt(grid.row ?? 1, 1, panel.rows - rowSpan + 1),
        col: clampInt(grid.col ?? 1, 1, panel.columns - colSpan + 1),
        rowSpan,
        colSpan,
    };
}

function rectsOverlap(a, b) {
    return a.row < b.row + b.rowSpan &&
        a.row + a.rowSpan > b.row &&
        a.col < b.col + b.colSpan &&
        a.col + a.colSpan > b.col;
}

function isGridFree(panel, grid, excludeId = null) {
    if (grid.row < 1 || grid.col < 1) return false;
    if (grid.row + grid.rowSpan - 1 > panel.rows) return false;
    if (grid.col + grid.colSpan - 1 > panel.columns) return false;
    return !panel.components.some((component) =>
        component.id !== excludeId && rectsOverlap(component.grid, grid)
    );
}

function findFreeGrid(panel, rowSpan, colSpan, preferred = { row: 1, col: 1 }, excludeId = null) {
    rowSpan = clampInt(rowSpan, 1, panel.rows);
    colSpan = clampInt(colSpan, 1, panel.columns);
    const prefRow = clampInt(preferred.row ?? 1, 1, panel.rows);
    const prefCol = clampInt(preferred.col ?? 1, 1, panel.columns);
    let best = null;
    let bestDistance = Infinity;

    for (let row = 1; row <= panel.rows - rowSpan + 1; row += 1) {
        for (let col = 1; col <= panel.columns - colSpan + 1; col += 1) {
            const candidate = { row, col, rowSpan, colSpan };
            if (!isGridFree(panel, candidate, excludeId)) continue;
            const distance = (row - prefRow) ** 2 + (col - prefCol) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }
    }
    return best;
}

function findPanelViewAtPoint(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    const host = element?.closest?.('.editor-panel-host');
    if (!host) return null;
    return state.panelViews.get(host.dataset.panelId) || null;
}

// ==================== 拖动 / 缩放 ====================
function attachDragListeners() {
    window.addEventListener('pointermove', onDragPointerMove);
    window.addEventListener('pointerup', onDragPointerUp);
    window.addEventListener('pointercancel', onDragPointerCancel);
}

function detachDragListeners() {
    window.removeEventListener('pointermove', onDragPointerMove);
    window.removeEventListener('pointerup', onDragPointerUp);
    window.removeEventListener('pointercancel', onDragPointerCancel);
}

function capturePointer(element, event) {
    if (!element || event.pointerId === undefined ||
        typeof element.setPointerCapture !== 'function') return;
    try {
        element.setPointerCapture(event.pointerId);
    } catch (error) {
        // 指针捕获失败时仍可通过 window 上的监听完成拖拽
    }
}

function beginMoveDrag(event, view, componentIds = null) {
    const panelView = state.panelViews.get(view.panelId);
    if (!panelView) return;
    const ids = (Array.isArray(componentIds) && componentIds.length
        ? componentIds
        : [view.model.id]).filter((id) => state.componentViews.has(id));

    if (ids.length > 1) {
        beginGroupMoveDrag(event, view, ids);
        return;
    }

    const startCell = pointToCell(panelView, event.clientX, event.clientY);
    const drag = {
        mode: 'move',
        pointerId: event.pointerId,
        componentId: view.model.id,
        sourcePanelId: view.panelId,
        startGrid: { ...view.model.grid },
        startPointerCell: startCell,
        grabOffset: {
            row: startCell.row - view.model.grid.row,
            col: startCell.col - view.model.grid.col,
        },
        lastValid: { panelId: view.panelId, grid: { ...view.model.grid } },
        moved: false,
        ghostEl: null,
        ghostPanelId: null,
        sourceView: view,
    };
    state.drag = drag;
    document.body.classList.add('is-editing-drag');
    attachDragListeners();
    capturePointer(view.overlay, event);
    setMessage('拖动组件以移动位置；松开鼠标完成');
}

function beginGroupMoveDrag(event, view, componentIds) {
    const panelView = state.panelViews.get(view.panelId);
    if (!panelView) return;
    const models = componentIds
        .map((id) => findComponentModel(view.panelId, id))
        .filter(Boolean);
    if (models.length <= 1) {
        beginMoveDrag(event, view, [view.model.id]);
        return;
    }

    const startCell = pointToCell(panelView, event.clientX, event.clientY);
    const group = getGroupBounds(models);
    const startGrids = new Map(
        models.map((component) => [component.id, { ...component.grid }])
    );

    state.drag = {
        mode: 'moveGroup',
        pointerId: event.pointerId,
        componentIds: models.map((component) => component.id),
        sourcePanelId: view.panelId,
        startGroup: group,
        startGrids,
        startPointerCell: startCell,
        grabOffset: {
            row: startCell.row - group.row,
            col: startCell.col - group.col,
        },
        lastValid: {
            panelId: view.panelId,
            delta: { row: 0, col: 0 },
        },
        moved: false,
        sourceView: view,
        sourceViews: models
            .map((component) => state.componentViews.get(component.id))
            .filter(Boolean),
    };
    document.body.classList.add('is-editing-drag');
    attachDragListeners();
    capturePointer(view.overlay, event);
    setMessage(`已选择 ${componentIds.length} 个组件，拖动整组移动`);
}

function beginResizeDrag(event, view, handle) {
    const panelView = state.panelViews.get(view.panelId);
    if (!panelView) return;
    const startCell = pointToCell(panelView, event.clientX, event.clientY);
    state.drag = {
        mode: 'resize',
        pointerId: event.pointerId,
        componentId: view.model.id,
        sourcePanelId: view.panelId,
        handle,
        startGrid: { ...view.model.grid },
        startPointerCell: startCell,
        lastValid: { panelId: view.panelId, grid: { ...view.model.grid } },
        moved: false,
        ghostEl: null,
        ghostPanelId: null,
        sourceView: view,
    };
    document.body.classList.add('is-editing-drag');
    attachDragListeners();
    capturePointer(event.currentTarget || view.overlay, event);
    setMessage('拖动边角调整组件尺寸；松开鼠标完成');
}

function onDragPointerMove(event) {
    const drag = state.drag;
    if (!drag) return;
    if (drag.pointerId !== undefined && event.pointerId !== undefined &&
        event.pointerId !== drag.pointerId) return;
    if (event.cancelable) event.preventDefault();
    autoScrollWorkspace(event.clientX, event.clientY);

    if (drag.mode === 'move') {
        updateMoveDrag(event, drag);
    } else if (drag.mode === 'moveGroup') {
        updateGroupMoveDrag(event, drag);
    } else if (drag.mode === 'resize') {
        updateResizeDrag(event, drag);
    }
}

function autoScrollWorkspace(clientX, clientY) {
    const wrap = dom.canvas.parentElement;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const edge = 34;
    const speed = 16;
    if (clientX < rect.left + edge) wrap.scrollLeft -= speed;
    else if (clientX > rect.right - edge) wrap.scrollLeft += speed;
    if (clientY < rect.top + edge) wrap.scrollTop -= speed;
    else if (clientY > rect.bottom - edge) wrap.scrollTop += speed;
}

function updateMoveDrag(event, drag) {
    const fallbackPanelView = state.panelViews.get(drag.lastValid.panelId) ||
        state.panelViews.get(drag.sourcePanelId);
    const hoveredPanelView = findPanelViewAtPoint(event.clientX, event.clientY) || fallbackPanelView;
    if (!hoveredPanelView) return;

    const pointerCell = pointToCell(hoveredPanelView, event.clientX, event.clientY);
    const candidate = clampGridToPanel(hoveredPanelView.model, {
        row: pointerCell.row - drag.grabOffset.row,
        col: pointerCell.col - drag.grabOffset.col,
        rowSpan: drag.startGrid.rowSpan,
        colSpan: drag.startGrid.colSpan,
    });
    const samePanel = hoveredPanelView.model.id === drag.sourcePanelId;
    const valid = isGridFree(
        hoveredPanelView.model,
        candidate,
        samePanel ? drag.componentId : null
    );
    const differs = hoveredPanelView.model.id !== drag.sourcePanelId ||
        candidate.row !== drag.startGrid.row ||
        candidate.col !== drag.startGrid.col ||
        candidate.rowSpan !== drag.startGrid.rowSpan ||
        candidate.colSpan !== drag.startGrid.colSpan;

    if (valid) {
        drag.lastValid = { panelId: hoveredPanelView.model.id, grid: { ...candidate } };
        drag.moved = differs;
    }

    if (samePanel) {
        const sourceView = state.componentViews.get(drag.componentId);
        if (sourceView && valid) {
            sourceView.component.setGridPosition(
                candidate.row,
                candidate.col,
                candidate.rowSpan,
                candidate.colSpan
            );
        }
        sourceView?.wrapper.classList.remove('is-drag-source');
        hideDragGhost(drag);
        if (!valid) {
            showDragGhost(drag, hoveredPanelView, candidate, false, drag.componentId);
        }
    } else {
        drag.sourceView?.wrapper.classList.add('is-drag-source');
        showDragGhost(drag, hoveredPanelView, candidate, valid, drag.componentId);
    }

    const previewPanel = samePanel && valid
        ? hoveredPanelView
        : state.panelViews.get(drag.lastValid.panelId);
    const previewGrid = samePanel && valid ? candidate : drag.lastValid.grid;
    if (previewPanel && previewGrid) {
        setMessage(`目标位置：第 ${previewGrid.row} 行 / 第 ${previewGrid.col} 列`);
    }
}

function updateGroupMoveDrag(event, drag) {
    const panelView = state.panelViews.get(drag.sourcePanelId);
    if (!panelView) return;
    const panel = panelView.model;
    const pointerCell = pointToCell(panelView, event.clientX, event.clientY);
    const maxGroupRow = panel.rows - drag.startGroup.rowSpan + 1;
    const maxGroupCol = panel.columns - drag.startGroup.colSpan + 1;
    const groupRow = clampInt(
        pointerCell.row - drag.grabOffset.row,
        1,
        maxGroupRow
    );
    const groupCol = clampInt(
        pointerCell.col - drag.grabOffset.col,
        1,
        maxGroupCol
    );
    const delta = {
        row: groupRow - drag.startGroup.row,
        col: groupCol - drag.startGroup.col,
    };
    const grids = drag.componentIds.map((id) => {
        const start = drag.startGrids.get(id);
        return {
            row: start.row + delta.row,
            col: start.col + delta.col,
            rowSpan: start.rowSpan,
            colSpan: start.colSpan,
        };
    });
    const valid = isGroupFree(panel, grids, drag.componentIds);

    if (!valid) {
        setMessage('该位置与其他组件重叠，无法移动');
        return;
    }

    drag.lastValid = { panelId: panel.id, delta };
    drag.moved = delta.row !== 0 || delta.col !== 0;
    drag.sourceViews.forEach((view, index) => {
        const grid = grids[index];
        view.component.setGridPosition(
            grid.row,
            grid.col,
            grid.rowSpan,
            grid.colSpan
        );
    });
    setMessage(`目标位置：第 ${groupRow} 行 / 第 ${groupCol} 列`);
}

function restoreGroupGrids(drag) {
    drag.sourceViews?.forEach((view) => {
        const grid = drag.startGrids.get(view.model.id);
        if (!grid) return;
        view.component.setGridPosition(
            grid.row,
            grid.col,
            grid.rowSpan,
            grid.colSpan
        );
    });
}

function finishGroupMoveDrag(drag, cancelled) {
    if (cancelled || !drag.moved) {
        restoreGroupGrids(drag);
        setMessage(cancelled ? '操作已取消' : '就绪');
        return;
    }

    const delta = drag.lastValid?.delta;
    if (!delta || (delta.row === 0 && delta.col === 0)) {
        restoreGroupGrids(drag);
        setMessage('就绪');
        return;
    }

    let targetRow = Infinity;
    let targetCol = Infinity;
    drag.componentIds.forEach((id) => {
        const model = findComponentModel(drag.sourcePanelId, id);
        const start = drag.startGrids.get(id);
        if (!model || !start) return;
        const grid = {
            row: start.row + delta.row,
            col: start.col + delta.col,
            rowSpan: start.rowSpan,
            colSpan: start.colSpan,
        };
        model.grid = grid;
        targetRow = Math.min(targetRow, grid.row);
        targetCol = Math.min(targetCol, grid.col);
        const view = state.componentViews.get(id);
        if (view) {
            view.component.setGridPosition(
                grid.row,
                grid.col,
                grid.rowSpan,
                grid.colSpan
            );
        }
    });

    pushHistory();
    scheduleAutosave();
    setMessage(
        `已移动 ${drag.componentIds.length} 个组件到第 ${targetRow} 行 / 第 ${targetCol} 列`
    );
}

function updateResizeDrag(event, drag) {
    const panelView = state.panelViews.get(drag.sourcePanelId);
    if (!panelView) return;
    const pointerCell = pointToCell(panelView, event.clientX, event.clientY);
    const candidate = computeResizeGrid(
        drag.startGrid,
        drag.startPointerCell,
        pointerCell,
        drag.handle,
        panelView.model
    );
    const valid = isGridFree(panelView.model, candidate, drag.componentId);
    if (valid) {
        drag.lastValid = { panelId: panelView.model.id, grid: { ...candidate } };
        drag.moved = candidate.row !== drag.startGrid.row ||
            candidate.col !== drag.startGrid.col ||
            candidate.rowSpan !== drag.startGrid.rowSpan ||
            candidate.colSpan !== drag.startGrid.colSpan;
        drag.sourceView.component.setGridPosition(
            candidate.row,
            candidate.col,
            candidate.rowSpan,
            candidate.colSpan
        );
        hideDragGhost(drag);
        setMessage(`尺寸：${candidate.colSpan} × ${candidate.rowSpan}`);
    } else {
        showDragGhost(drag, panelView, candidate, false, drag.componentId);
        setMessage('该尺寸与其他组件重叠，无法应用');
    }
}

function computeResizeGrid(start, startPointer, pointer, handle, panel) {
    let { row, col, rowSpan, colSpan } = start;
    const deltaRow = pointer.row - startPointer.row;
    const deltaCol = pointer.col - startPointer.col;

    if (handle.includes('e')) {
        colSpan = start.colSpan + deltaCol;
    }
    if (handle.includes('s')) {
        rowSpan = start.rowSpan + deltaRow;
    }
    if (handle.includes('w')) {
        const right = start.col + start.colSpan;
        col = clampInt(start.col + deltaCol, 1, right - 1);
        colSpan = right - col;
    }
    if (handle.includes('n')) {
        const bottom = start.row + start.rowSpan;
        row = clampInt(start.row + deltaRow, 1, bottom - 1);
        rowSpan = bottom - row;
    }

    colSpan = clampInt(colSpan, 1, panel.columns - col + 1);
    rowSpan = clampInt(rowSpan, 1, panel.rows - row + 1);
    return {
        row: clampInt(row, 1, panel.rows - rowSpan + 1),
        col: clampInt(col, 1, panel.columns - colSpan + 1),
        rowSpan,
        colSpan,
    };
}

function showDragGhost(drag, panelView, grid, valid, componentId) {
    if (!drag.ghostEl) {
        drag.ghostEl = createEl('div', 'editor-drag-ghost');
    }
    if (drag.ghostEl.parentElement !== panelView.panelDiv) {
        panelView.panelDiv.appendChild(drag.ghostEl);
        drag.ghostPanelId = panelView.model.id;
    }
    drag.ghostEl.style.display = '';
    drag.ghostEl.classList.toggle('is-invalid', !valid);
    const location = findComponentLocation(componentId);
    drag.ghostEl.textContent = location ? getComponentLabel(location.component.type) : '';
    positionOverlayElement(panelView, drag.ghostEl, grid);
}

function hideDragGhost(drag) {
    if (drag.ghostEl) drag.ghostEl.style.display = 'none';
}

function onDragPointerUp(event) {
    if (state.drag && event.pointerId !== undefined &&
        state.drag.pointerId !== undefined &&
        event.pointerId !== state.drag.pointerId) return;
    finishDrag(false);
}

function onDragPointerCancel(event) {
    if (state.drag && event?.pointerId !== undefined &&
        state.drag.pointerId !== undefined &&
        event.pointerId !== state.drag.pointerId) return;
    finishDrag(true);
}

function finishDrag(cancelled) {
    const drag = state.drag;
    if (!drag) return;
    detachDragListeners();
    document.body.classList.remove('is-editing-drag');
    drag.ghostEl?.remove();
    drag.sourceView?.wrapper.classList.remove('is-drag-source');
    state.drag = null;

    if (drag.mode === 'moveGroup') {
        finishGroupMoveDrag(drag, cancelled);
        refreshSelectionUI();
        renderInspector();
        updateStatus();
        return;
    }

    const sourceView = state.componentViews.get(drag.componentId);
    if (!sourceView) {
        refreshSelectionUI();
        renderInspector();
        return;
    }

    if (cancelled) {
        sourceView.component.setGridPosition(
            drag.startGrid.row,
            drag.startGrid.col,
            drag.startGrid.rowSpan,
            drag.startGrid.colSpan
        );
        refreshSelectionUI();
        renderInspector();
        setMessage('操作已取消');
        return;
    }

    if (!drag.moved) {
        refreshSelectionUI();
        renderInspector();
        setMessage('就绪');
        return;
    }

    if (drag.mode === 'move') {
        const targetPanelView = state.panelViews.get(drag.lastValid.panelId);
        const sourcePanelView = state.panelViews.get(drag.sourcePanelId);
        if (!targetPanelView || !sourcePanelView) {
            refreshSelectionUI();
            renderInspector();
            return;
        }

        if (targetPanelView.model.id === drag.sourcePanelId) {
            const grid = drag.lastValid.grid;
            if (
                grid.row !== drag.startGrid.row ||
                grid.col !== drag.startGrid.col ||
                grid.rowSpan !== drag.startGrid.rowSpan ||
                grid.colSpan !== drag.startGrid.colSpan
            ) {
                sourceView.model.grid = { ...grid };
                sourceView.component.setGridPosition(
                    grid.row,
                    grid.col,
                    grid.rowSpan,
                    grid.colSpan
                );
                pushHistory();
                scheduleAutosave();
                setMessage(`已移动到第 ${grid.row} 行 / 第 ${grid.col} 列`);
            } else {
                sourceView.component.setGridPosition(
                    drag.startGrid.row,
                    drag.startGrid.col,
                    drag.startGrid.rowSpan,
                    drag.startGrid.colSpan
                );
                setMessage('就绪');
            }
        } else {
            const sourcePanel = sourcePanelView.model;
            const targetPanel = targetPanelView.model;
            const componentIndex = sourcePanel.components.findIndex(
                (component) => component.id === drag.componentId
            );
            if (componentIndex === -1) {
                refreshSelectionUI();
                renderInspector();
                return;
            }
            const [componentModel] = sourcePanel.components.splice(componentIndex, 1);
            componentModel.grid = { ...drag.lastValid.grid };
            targetPanel.components.push(componentModel);

            try {
                sourceView.component.destroy();
            } catch (error) {
                console.warn(error);
            }
            state.componentViews.delete(drag.componentId);
            createComponentView(targetPanelView, componentModel);
            state.selected = {
                kind: 'component',
                panelId: targetPanel.id,
                componentId: componentModel.id,
            };
            state.activePanelId = targetPanel.id;
            pushHistory();
            scheduleAutosave();
            setMessage(`已移动到面板 ${targetPanel.id}`);
        }
    } else if (drag.mode === 'resize') {
        const grid = drag.lastValid.grid;
        if (
            grid.row !== drag.startGrid.row ||
            grid.col !== drag.startGrid.col ||
            grid.rowSpan !== drag.startGrid.rowSpan ||
            grid.colSpan !== drag.startGrid.colSpan
        ) {
            sourceView.model.grid = { ...grid };
            sourceView.component.setGridPosition(
                grid.row,
                grid.col,
                grid.rowSpan,
                grid.colSpan
            );
            pushHistory();
            scheduleAutosave();
            setMessage(`尺寸已调整为 ${grid.colSpan} × ${grid.rowSpan}`);
        } else {
            sourceView.component.setGridPosition(
                drag.startGrid.row,
                drag.startGrid.col,
                drag.startGrid.rowSpan,
                drag.startGrid.colSpan
            );
            setMessage('就绪');
        }
    }

    refreshSelectionUI();
    renderInspector();
    updateStatus();
}

function clearDragArtifacts() {
    detachDragListeners();
    if (state.drag) {
        state.drag.ghostEl?.remove();
        state.drag.sourceView?.wrapper.classList.remove('is-drag-source');
    }
    state.drag = null;
    document.body.classList.remove('is-editing-drag');
    removePaletteMarker();
}

// ==================== 工具栏 / 文件操作 ====================
function updateToolbar() {
    const undoBtn = document.querySelector('[data-action="undo"]');
    const redoBtn = document.querySelector('[data-action="redo"]');
    if (undoBtn) undoBtn.disabled = state.historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
}

function syncProjectChrome() {
    dom.projectName.value = state.project.name;
    document.title = `${state.project.name} · 驾驶舱界面编辑器`;
}

function createNewProject() {
    const hasContent = state.project.panels.some((panel) => panel.components.length > 0) ||
        state.project.panels.length > 1;
    if (hasContent && !window.confirm('新建项目会清空当前画布，确定继续吗？')) {
        return;
    }
    state.project = createProject();
    state.selected = null;
    state.activePanelId = state.project.panels[0]?.id || null;
    syncProjectChrome();
    renderAll();
    resetHistory();
    selectNothing();
    scheduleAutosave();
    setMessage('已新建项目');
}

function downloadTextFile(filename, content, mime = 'application/json;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportProject() {
    window.clearTimeout(state.historyTimer);
    pushHistory();
    const content = JSON.stringify(state.project, null, 2);
    downloadTextFile(`${sanitizeFileName(state.project.name)}.json`, content);
    setMessage('项目 JSON 已导出');
    toast('项目 JSON 已导出', 'success');
}

function exportJavaScript(mode) {
    try {
        const isReadable = mode === 'readable';
        const code = isReadable
            ? generateReadableJavaScript(state.project)
            : generateJavaScriptModule(state.project);
        const suffix = isReadable ? 'readable' : 'module';
        downloadTextFile(
            `${sanitizeFileName(state.project.name)}.${suffix}.js`,
            code,
            'text/javascript;charset=utf-8'
        );
        const label = isReadable ? '可读组件代码' : 'JavaScript 模块';
        setMessage(`已导出 ${label}`);
        toast(`${label}已导出`, 'success');
    } catch (error) {
        console.error(error);
        toast(`导出 JavaScript 失败：${error.message}`, 'error', 4200);
        setMessage('导出 JavaScript 失败');
    }
}

async function importProjectFile(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const raw = JSON.parse(text);
        const result = normalizeProject(raw);
        state.project = result.project;
        state.selected = null;
        state.activePanelId = state.project.panels[0]?.id || null;
        syncProjectChrome();
        renderAll();
        resetHistory();
        selectNothing();
        saveToLocalStorage();
        if (result.warnings.length) {
            result.warnings.slice(0, 4).forEach((warning) => toast(warning, 'error', 4200));
            setMessage(`项目已导入，存在 ${result.warnings.length} 条提示`);
        } else {
            setMessage('项目 JSON 已导入');
            toast('项目 JSON 已导入', 'success');
        }
    } catch (error) {
        console.error(error);
        toast(`无法打开项目：${error.message}`, 'error', 4500);
        setMessage('打开项目失败');
    } finally {
        dom.fileInput.value = '';
    }
}

// ==================== 预览 ====================
function togglePreview() {
    if (state.drag || state.marquee) return;
    closeExportMenu();
    state.preview = !state.preview;
    document.body.classList.toggle('preview-mode', state.preview);
    const button = document.querySelector('[data-action="preview"]');
    if (button) button.textContent = state.preview ? '退出预览' : '预览';
    if (state.preview) {
        state.selected = null;
        refreshSelectionUI();
        updateStatus();
        setMessage('预览模式：组件可以正常操作，按 Esc 退出');
    } else {
        selectNothing();
        setMessage('已退出预览模式');
    }
}

// ==================== 键盘快捷键 ====================
function handleKeyDown(event) {
    if (event.key === 'Escape') {
        closeExportMenu();
    }
    if (isTextInputTarget(event.target)) return;

    if (event.key === 'Escape') {
        if (state.preview) {
            togglePreview();
            return;
        }
        if (state.marquee) {
            clearMarqueeArtifacts();
            setMessage('已取消框选');
            return;
        }
        if (state.drag) {
            finishDrag(true);
            return;
        }
        selectNothing();
        return;
    }

    if (state.preview) return;

    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        exportProject();
        return;
    }
    if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelectedComponent();
        return;
    }
    if (modifier && event.key.toLowerCase() === 'c') {
        const selected = state.selected;
        if (selected?.kind === 'component') {
            const location = findComponentLocation(selected.componentId);
            if (location) {
                state.clipboard = {
                    type: location.component.type,
                    props: cloneProps(location.component.props),
                    grid: { ...location.component.grid },
                };
                setMessage('已复制组件参数');
            }
        }
        return;
    }
    if (modifier && event.key.toLowerCase() === 'v') {
        const clipboard = state.clipboard;
        const panelId = state.activePanelId || state.project.panels[0]?.id;
        if (clipboard && panelId) {
            const panel = findPanelModel(panelId);
            if (!panel) return;
            const grid = findFreeGrid(
                panel,
                clipboard.grid.rowSpan,
                clipboard.grid.colSpan,
                { row: clipboard.grid.row, col: clipboard.grid.col }
            );
            if (!grid) {
                toast('当前面板没有足够的空闲空间', 'error');
                return;
            }
            const used = collectUsedComponentIds();
            const newId = makeUniqueId(`${getComponentDefinition(clipboard.type)?.prefix || 'cmp'}-copy`, used);
            insertComponentModel(panelId, {
                id: newId,
                type: clipboard.type,
                grid,
                props: normalizeComponentProps(clipboard.type, cloneProps(clipboard.props)),
            });
            setMessage('已粘贴组件');
        }
        return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selected?.kind === 'component' ||
            state.selected?.kind === 'components') {
            event.preventDefault();
            deleteSelectedComponent();
        }
        return;
    }

    if ((state.selected?.kind === 'component' ||
        state.selected?.kind === 'components') &&
        event.key.startsWith('Arrow')) {
        event.preventDefault();
        const delta = {
            ArrowUp: { row: -1, col: 0 },
            ArrowDown: { row: 1, col: 0 },
            ArrowLeft: { row: 0, col: -1 },
            ArrowRight: { row: 0, col: 1 },
        }[event.key];
        if (!delta) return;
        if (moveSelectionBy(delta.row, delta.col)) {
            setMessage('已移动所选组件');
        } else {
            toast('该方向无法移动：超出边界或与其他组件重叠', 'error', 1600);
        }
    }
}

// ==================== 初始化 ====================
function buildPalette() {
    dom.paletteGroups.replaceChildren();
    COMPONENT_GROUPS.forEach((group) => {
        const groupEl = createEl('div', 'palette-group');
        groupEl.appendChild(createEl('div', 'palette-group-title', group.label));

        group.types.forEach((type) => {
            const definition = getComponentDefinition(type);
            if (!definition) return;
            const item = createEl('button', 'palette-item');
            item.type = 'button';
            item.draggable = true;
            item.dataset.type = type;
            item.appendChild(createEl('span', 'palette-icon', definition.icon));
            const copy = createEl('span', 'palette-copy');
            copy.appendChild(createEl('strong', '', definition.label));
            copy.appendChild(createEl('small', '', type));
            item.appendChild(copy);

            item.addEventListener('click', () => {
                if (state.preview) return;
                const panelId = state.activePanelId || state.selected?.panelId || state.project.panels[0]?.id;
                if (!panelId) {
                    toast('请先添加一个面板', 'error');
                    return;
                }
                addComponent(type, panelId);
            });

            item.addEventListener('dragstart', (event) => {
                if (state.preview) {
                    event.preventDefault();
                    return;
                }
                state.paletteDragType = type;
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('application/x-cockpit-component', type);
                event.dataTransfer.setData('text/plain', type);
                setMessage(`拖动 ${definition.label} 到面板中`);
            });

            item.addEventListener('dragend', () => {
                state.paletteDragType = null;
                removePaletteMarker();
            });

            groupEl.appendChild(item);
        });

        dom.paletteGroups.appendChild(groupEl);
    });
}

function setExportMenuOpen(open) {
    const menu = document.querySelector('[data-menu="export-js"]');
    const toggle = document.querySelector('[data-action="export-js"]');
    if (!menu || !toggle) return;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeExportMenu() {
    setExportMenuOpen(false);
}

function toggleExportMenu() {
    const menu = document.querySelector('[data-menu="export-js"]');
    if (!menu) return;
    setExportMenuOpen(menu.hidden);
}

function bindToolbar() {
    document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.action;
            if (action === 'new') createNewProject();
            else if (action === 'open') dom.fileInput.click();
            else if (action === 'save') exportProject();
            else if (action === 'undo') undo();
            else if (action === 'redo') redo();
            else if (action === 'add-panel') addPanel();
            else if (action === 'preview') togglePreview();
        });
    });

    const exportToggle = document.querySelector('[data-action="export-js"]');
    if (exportToggle) {
        exportToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleExportMenu();
        });
    }

    document.querySelectorAll('[data-export-js]').forEach((item) => {
        item.addEventListener('click', () => {
            closeExportMenu();
            exportJavaScript(item.dataset.exportJs);
        });
    });

    document.addEventListener('pointerdown', (event) => {
        if (!(event.target instanceof Element) ||
            !event.target.closest('.toolbar-dropdown')) {
            closeExportMenu();
        }
    });

    window.addEventListener('blur', closeExportMenu);

    dom.fileInput.addEventListener('change', () => {
        importProjectFile(dom.fileInput.files?.[0]);
    });

    dom.projectName.addEventListener('input', () => {
        state.project.name = dom.projectName.value;
        document.title = `${state.project.name || '未命名项目'} · 驾驶舱界面编辑器`;
        scheduleHistory(500);
        scheduleAutosave();
    });

    dom.projectName.addEventListener('blur', () => {
        if (!state.project.name.trim()) {
            state.project.name = '未命名项目';
            dom.projectName.value = state.project.name;
        }
        scheduleHistory(0);
        scheduleAutosave();
    });

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', () => {
        window.clearTimeout(state.autosaveTimer);
        saveToLocalStorage();
    });
}

function init() {
    const saved = loadFromLocalStorage();
    if (saved) {
        state.project = saved.project;
        state.activePanelId = state.project.panels[0]?.id || null;
        setMessage('已从浏览器本地恢复项目');
        if (saved.warnings.length) {
            saved.warnings.slice(0, 3).forEach((warning) => toast(warning, 'error', 4200));
        }
    } else {
        state.project = createProject();
        state.activePanelId = state.project.panels[0]?.id || null;
        setMessage('新建空白项目');
    }

    syncProjectChrome();
    buildPalette();
    bindToolbar();
    renderAll();
    resetHistory();
    selectNothing();
    updateToolbar();
    setStorageStatus('本地自动保存已开启', 'is-saved');
}

init();
