"use strict";
function sortByPosition(nodes) {
    return nodes.slice().sort((a, b) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const ay = (_b = (_a = a.absoluteBoundingBox) === null || _a === void 0 ? void 0 : _a.y) !== null && _b !== void 0 ? _b : a.y;
        const by = (_d = (_c = b.absoluteBoundingBox) === null || _c === void 0 ? void 0 : _c.y) !== null && _d !== void 0 ? _d : b.y;
        const ax = (_f = (_e = a.absoluteBoundingBox) === null || _e === void 0 ? void 0 : _e.x) !== null && _f !== void 0 ? _f : a.x;
        const bx = (_h = (_g = b.absoluteBoundingBox) === null || _g === void 0 ? void 0 : _g.x) !== null && _h !== void 0 ? _h : b.x;
        if (Math.abs(ay - by) > 1)
            return ay - by;
        return ax - bx;
    });
}
function getTextNodes() {
    return sortByPosition(figma.currentPage.selection.filter((node) => node.type === "TEXT"));
}
function getAllSelectedNodes() {
    return sortByPosition(figma.currentPage.selection);
}
let currentMode = "text";
function sendSelectionCount() {
    const count = currentMode === "rename" ? getAllSelectedNodes().length : getTextNodes().length;
    figma.ui.postMessage({ type: "selection", count });
}
function shuffle(arr) {
    const result = arr.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = result[i];
        result[i] = result[j];
        result[j] = tmp;
    }
    return result;
}
async function setTextCharacters(node, value) {
    if (node.characters.length === 0) {
        const fontName = node.fontName;
        if (fontName !== figma.mixed) {
            await figma.loadFontAsync(fontName);
        }
        else {
            await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        }
    }
    else {
        const fonts = node.getRangeAllFontNames(0, node.characters.length);
        await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
    }
    node.characters = value;
}
async function applyLines(lines, opts) {
    const nodes = opts.mode === "rename" ? getAllSelectedNodes() : getTextNodes();
    if (nodes.length === 0) {
        figma.notify(opts.mode === "rename" ? "No layers selected." : "No text nodes selected.", { error: true });
        return;
    }
    const working = opts.randomize ? shuffle(lines) : lines.slice();
    const targets = opts.repeat ? nodes : nodes.slice(0, working.length);
    for (let i = 0; i < targets.length; i++) {
        const node = targets[i];
        const line = working[i % working.length];
        if (opts.mode === "rename") {
            node.name = line;
        }
        else {
            await setTextCharacters(node, line);
        }
    }
    const verb = opts.mode === "rename" ? "Renamed" : "Applied to";
    figma.notify(`${verb} ${targets.length} node${targets.length !== 1 ? "s" : ""}.`);
}
// --- Structured copy/paste ---
// Matches text layers across selected "cards" (top-level selection) by layer name,
// instead of flattening to positional order — component instances reliably share
// internal layer names, so that's the natural key to bind fields on.
function getStructuredCards() {
    return sortByPosition(figma.currentPage.selection);
}
function getFieldMap(card) {
    const map = new Map();
    const addIfText = (node) => {
        if (node.type === "TEXT" && node.visible && !map.has(node.name)) {
            map.set(node.name, node);
        }
    };
    addIfText(card);
    if ("findAll" in card) {
        const descendants = card.findAll((n) => n.type === "TEXT" && n.visible);
        for (const node of descendants) {
            if (!map.has(node.name))
                map.set(node.name, node);
        }
    }
    return map;
}
function getStructuredFieldNames(fieldMaps) {
    const headerSet = new Set();
    for (const map of fieldMaps) {
        for (const key of map.keys())
            headerSet.add(key);
    }
    return Array.from(headerSet);
}
function sendCardSelectionCount() {
    const cards = getStructuredCards();
    const fields = getStructuredFieldNames(cards.map(getFieldMap));
    figma.ui.postMessage({ type: "card-selection", count: cards.length, fields });
}
function sendStructuredCopyData() {
    const cards = getStructuredCards();
    if (cards.length === 0) {
        figma.ui.postMessage({ type: "structured-data", headers: [], records: [], error: "No layers selected." });
        return;
    }
    const fieldMaps = cards.map(getFieldMap);
    const headers = getStructuredFieldNames(fieldMaps);
    if (headers.length === 0) {
        figma.ui.postMessage({
            type: "structured-data",
            headers: [],
            records: [],
            error: "No named text layers found in the selection.",
        });
        return;
    }
    const records = fieldMaps.map((map) => {
        var _a, _b;
        const record = {};
        for (const header of headers) {
            record[header] = (_b = (_a = map.get(header)) === null || _a === void 0 ? void 0 : _a.characters) !== null && _b !== void 0 ? _b : "";
        }
        return record;
    });
    figma.ui.postMessage({ type: "structured-data", headers, records });
}
async function applyStructured(headers, records) {
    const cards = getStructuredCards();
    if (cards.length === 0) {
        figma.notify("No layers selected.", { error: true });
        return;
    }
    if (records.length === 0) {
        figma.notify("No structured data to paste.", { error: true });
        return;
    }
    const targets = cards.slice(0, records.length);
    let fieldsWritten = 0;
    for (let i = 0; i < targets.length; i++) {
        const fieldMap = getFieldMap(targets[i]);
        const record = records[i];
        for (const header of headers) {
            const node = fieldMap.get(header);
            const value = record[header];
            if (node && value !== undefined) {
                await setTextCharacters(node, value);
                fieldsWritten++;
            }
        }
    }
    figma.notify(`Applied ${fieldsWritten} field${fieldsWritten !== 1 ? "s" : ""} across ${targets.length} layer${targets.length !== 1 ? "s" : ""}.`);
}
const command = figma.command;
if (command === "clipboard") {
    // Must be visible so the paste event can fire (paste events don't reach hidden iframes)
    figma.showUI(__html__, { visible: true, width: 240, height: 56, title: "Multi-Paste" });
    // Don't send clipboard-read yet — wait for the UI to signal it's ready
}
else if (command === "structured") {
    figma.showUI(__html__, { width: 360, height: 420, title: "Multi-Paste — Structured" });
    figma.on("selectionchange", sendCardSelectionCount);
}
else {
    // "main" command — full UI
    figma.showUI(__html__, { width: 320, height: 400, title: "Multi-Paste" });
    figma.on("selectionchange", sendSelectionCount);
}
figma.ui.onmessage = async (msg) => {
    var _a;
    if (msg.type === "ready") {
        if (command === "clipboard") {
            // UI is loaded — now it's safe to request clipboard data
            figma.ui.postMessage({ type: "clipboard-read" });
        }
        else if (command === "structured") {
            figma.ui.postMessage({ type: "structured-init" });
            sendCardSelectionCount();
        }
        else {
            // UI is loaded — safe to send the file key (for per-file history) and the initial selection count
            figma.ui.postMessage({ type: "file-key", fileKey: (_a = figma.fileKey) !== null && _a !== void 0 ? _a : null });
            sendSelectionCount();
        }
    }
    else if (msg.type === "set-mode") {
        currentMode = msg.mode;
        sendSelectionCount();
    }
    else if (msg.type === "apply") {
        await applyLines(msg.lines, { mode: msg.mode, randomize: msg.randomize, repeat: msg.repeat });
    }
    else if (msg.type === "structured-copy") {
        sendStructuredCopyData();
    }
    else if (msg.type === "structured-apply") {
        await applyStructured(msg.headers, msg.records);
    }
    else if (msg.type === "clipboard-data") {
        if (msg.error) {
            figma.closePlugin(`Clipboard error: ${msg.error}`);
        }
        else if (msg.lines.length === 0) {
            figma.closePlugin("Clipboard was empty — nothing to paste.");
        }
        else {
            await applyLines(msg.lines, { mode: "text", randomize: false, repeat: false });
            figma.closePlugin();
        }
    }
};
