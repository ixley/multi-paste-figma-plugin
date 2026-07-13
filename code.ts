// Message types
type ApplyMode = "text" | "rename";
type ApplyMsg = { type: "apply"; lines: string[]; mode: ApplyMode; randomize: boolean; repeat: boolean };
type SetModeMsg = { type: "set-mode"; mode: ApplyMode };
type ClipboardReadMsg = { type: "clipboard-read" };
type ClipboardDataMsg = { type: "clipboard-data"; lines: string[]; error?: string };
type SelectionMsg = { type: "selection"; count: number };
type FileKeyMsg = { type: "file-key"; fileKey: string | null };
type ReadyMsg = { type: "ready" };

type PluginToUI = SelectionMsg | ClipboardReadMsg | FileKeyMsg;
type UIToPlugin = ApplyMsg | SetModeMsg | ClipboardDataMsg | ReadyMsg;

function sortByPosition<T extends SceneNode>(nodes: readonly T[]): T[] {
  return nodes.slice().sort((a, b) => {
    const ay = a.absoluteBoundingBox?.y ?? a.y;
    const by = b.absoluteBoundingBox?.y ?? b.y;
    const ax = a.absoluteBoundingBox?.x ?? a.x;
    const bx = b.absoluteBoundingBox?.x ?? b.x;
    if (Math.abs(ay - by) > 1) return ay - by;
    return ax - bx;
  });
}

function getTextNodes(): TextNode[] {
  return sortByPosition(figma.currentPage.selection.filter((node): node is TextNode => node.type === "TEXT"));
}

function getAllSelectedNodes(): SceneNode[] {
  return sortByPosition(figma.currentPage.selection);
}

let currentMode: ApplyMode = "text";

function sendSelectionCount(): void {
  const count = currentMode === "rename" ? getAllSelectedNodes().length : getTextNodes().length;
  figma.ui.postMessage({ type: "selection", count } satisfies PluginToUI);
}

function shuffle<T>(arr: T[]): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

async function applyLines(lines: string[], opts: { mode: ApplyMode; randomize: boolean; repeat: boolean }): Promise<void> {
  const nodes: SceneNode[] = opts.mode === "rename" ? getAllSelectedNodes() : getTextNodes();

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
      continue;
    }

    const textNode = node as TextNode;
    if (textNode.characters.length === 0) {
      const fontName = textNode.fontName;
      if (fontName !== figma.mixed) {
        await figma.loadFontAsync(fontName);
      } else {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      }
    } else {
      const fonts = textNode.getRangeAllFontNames(0, textNode.characters.length);
      await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
    }
    textNode.characters = line;
  }

  const verb = opts.mode === "rename" ? "Renamed" : "Applied to";
  figma.notify(`${verb} ${targets.length} node${targets.length !== 1 ? "s" : ""}.`);
}

const command = figma.command;

if (command === "clipboard") {
  // Must be visible so the paste event can fire (paste events don't reach hidden iframes)
  figma.showUI(__html__, { visible: true, width: 240, height: 56, title: "Multi-Paste" });
  // Don't send clipboard-read yet — wait for the UI to signal it's ready
} else {
  // "main" command — full UI
  figma.showUI(__html__, { width: 320, height: 400, title: "Multi-Paste" });
  figma.on("selectionchange", sendSelectionCount);
}

figma.ui.onmessage = async (msg: UIToPlugin) => {
  if (msg.type === "ready" && command === "clipboard") {
    // UI is loaded — now it's safe to request clipboard data
    figma.ui.postMessage({ type: "clipboard-read" } satisfies PluginToUI);
  } else if (msg.type === "ready") {
    // UI is loaded — safe to send the file key (for per-file history) and the initial selection count
    figma.ui.postMessage({ type: "file-key", fileKey: figma.fileKey ?? null } satisfies PluginToUI);
    sendSelectionCount();
  } else if (msg.type === "set-mode") {
    currentMode = msg.mode;
    sendSelectionCount();
  } else if (msg.type === "apply") {
    await applyLines(msg.lines, { mode: msg.mode, randomize: msg.randomize, repeat: msg.repeat });
  } else if (msg.type === "clipboard-data") {
    if (msg.error) {
      figma.closePlugin(`Clipboard error: ${msg.error}`);
    } else if (msg.lines.length === 0) {
      figma.closePlugin("Clipboard was empty — nothing to paste.");
    } else {
      await applyLines(msg.lines, { mode: "text", randomize: false, repeat: false });
      figma.closePlugin();
    }
  }
};
