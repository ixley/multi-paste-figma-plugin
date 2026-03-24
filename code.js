"use strict";
function getTextNodes() {
    return figma.currentPage.selection
        .filter((node) => node.type === "TEXT")
        .sort((a, b) => {
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
function sendSelectionCount() {
    const count = getTextNodes().length;
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
async function applyLines(lines, opts) {
    const nodes = getTextNodes();
    if (nodes.length === 0) {
        figma.notify("No text nodes selected.", { error: true });
        return;
    }
    const working = opts.randomize ? shuffle(lines) : lines.slice();
    const targets = opts.repeat ? nodes : nodes.slice(0, working.length);
    for (let i = 0; i < targets.length; i++) {
        const node = targets[i];
        const line = working[i % working.length];
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
        node.characters = line;
    }
    figma.notify(`Applied to ${targets.length} node${targets.length !== 1 ? "s" : ""}.`);
}
const command = figma.command;
if (command === "clipboard") {
    // Must be visible so the paste event can fire (paste events don't reach hidden iframes)
    figma.showUI(__html__, { visible: true, width: 240, height: 56, title: "Multi-Paste" });
    // Don't send clipboard-read yet — wait for the UI to signal it's ready
}
else {
    // "main" command — full UI
    figma.showUI(__html__, { width: 320, height: 310, title: "Multi-Paste" });
    sendSelectionCount();
    figma.on("selectionchange", sendSelectionCount);
}
figma.ui.onmessage = async (msg) => {
    if (msg.type === "ready" && command === "clipboard") {
        // UI is loaded — now it's safe to request clipboard data
        figma.ui.postMessage({ type: "clipboard-read" });
    }
    else if (msg.type === "apply") {
        await applyLines(msg.lines, { randomize: msg.randomize, repeat: msg.repeat });
    }
    else if (msg.type === "clipboard-data") {
        if (msg.error) {
            figma.closePlugin(`Clipboard error: ${msg.error}`);
        }
        else if (msg.lines.length === 0) {
            figma.closePlugin("Clipboard was empty — nothing to paste.");
        }
        else {
            await applyLines(msg.lines, { randomize: false, repeat: false });
            figma.closePlugin();
        }
    }
};
