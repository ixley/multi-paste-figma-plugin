// Message types
type ApplyMsg = { type: "apply"; lines: string[]; randomize: boolean; repeat: boolean };
type ClipboardReadMsg = { type: "clipboard-read" };
type ClipboardDataMsg = { type: "clipboard-data"; lines: string[]; error?: string };
type SelectionMsg = { type: "selection"; count: number };
type ReadyMsg = { type: "ready" };

type PluginToUI = SelectionMsg | ClipboardReadMsg;
type UIToPlugin = ApplyMsg | ClipboardDataMsg | ReadyMsg;

function getTextNodes(): TextNode[] {
  return figma.currentPage.selection
    .filter((node): node is TextNode => node.type === "TEXT")
    .sort((a, b) => {
      const ay = a.absoluteBoundingBox?.y ?? a.y;
      const by = b.absoluteBoundingBox?.y ?? b.y;
      const ax = a.absoluteBoundingBox?.x ?? a.x;
      const bx = b.absoluteBoundingBox?.x ?? b.x;
      if (Math.abs(ax - bx) > 1) return ax - bx;
      return ay - by;
    });
}

function sendSelectionCount(): void {
  const count = getTextNodes().length;
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

async function applyLines(lines: string[], opts: { randomize: boolean; repeat: boolean }): Promise<void> {
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
      } else {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      }
    } else {
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
} else {
  // "main" command — full UI
  figma.showUI(__html__, { width: 320, height: 310, title: "Multi-Paste" });
  sendSelectionCount();
  figma.on("selectionchange", sendSelectionCount);
}

figma.ui.onmessage = async (msg: UIToPlugin) => {
  if (msg.type === "ready" && command === "clipboard") {
    // UI is loaded — now it's safe to request clipboard data
    figma.ui.postMessage({ type: "clipboard-read" } satisfies PluginToUI);
  } else if (msg.type === "apply") {
    await applyLines(msg.lines, { randomize: msg.randomize, repeat: msg.repeat });
  } else if (msg.type === "clipboard-data") {
    if (msg.error) {
      figma.closePlugin(`Clipboard error: ${msg.error}`);
    } else if (msg.lines.length === 0) {
      figma.closePlugin("Clipboard was empty — nothing to paste.");
    } else {
      await applyLines(msg.lines, { randomize: false, repeat: false });
      figma.closePlugin();
    }
  }
};
