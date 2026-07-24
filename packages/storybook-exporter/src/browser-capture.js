(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const px = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? round(parsed) : 0;
  };
  const visible = (element, style, rect) =>
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number.parseFloat(style.opacity || "1") > 0 &&
    rect.width >= 0.5 &&
    rect.height >= 0.5;

  function color(value) {
    const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
    if (!match) return null;
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (alpha <= 0) return null;
    return {
      type: "SOLID",
      color: {
        r: round(Number(match[1]) / 255),
        g: round(Number(match[2]) / 255),
        b: round(Number(match[3]) / 255),
      },
      ...(alpha < 1 ? { opacity: round(alpha) } : {}),
    };
  }

  function fontStyle(style) {
    if (style.fontStyle === "italic") {
      const base = fontStyle({ ...style, fontStyle: "normal" });
      return base === "Regular" ? "Italic" : `${base} Italic`;
    }
    const weight = Number(style.fontWeight);
    if (weight >= 900) return "Black";
    if (weight >= 800) return "ExtraBold";
    if (weight >= 700) return "Bold";
    if (weight >= 600) return "SemiBold";
    if (weight >= 500) return "Medium";
    if (weight <= 300) return "Light";
    return "Regular";
  }

  function layerName(element, fallback) {
    return (
      element.getAttribute?.("data-figma-layer") ||
      element.getAttribute?.("aria-label") ||
      element.getAttribute?.("role") ||
      fallback
    );
  }

  function textLayer(node, parentRect, parentStyle, index) {
    const characters = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!characters) return null;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) return null;
    const fill = color(parentStyle.color);
    const lineHeight = parentStyle.lineHeight === "normal"
      ? px(parentStyle.fontSize) * 1.2
      : px(parentStyle.lineHeight);
    return {
      type: "TEXT",
      name: layerName(node.parentElement, `Text ${index + 1}`),
      characters,
      width: round(rect.width),
      height: round(rect.height),
      x: round(rect.left - parentRect.left),
      y: round(rect.top - parentRect.top),
      fontFamily: parentStyle.fontFamily.split(",")[0].replaceAll(/['"]/g, "").trim(),
      fontStyle: fontStyle(parentStyle),
      fontWeight: Number(parentStyle.fontWeight) || 400,
      fontSize: px(parentStyle.fontSize),
      lineHeight: round(lineHeight),
      letterSpacing: parentStyle.letterSpacing === "normal" ? 0 : px(parentStyle.letterSpacing),
      textAlignHorizontal: {
        center: "CENTER",
        right: "RIGHT",
        justify: "JUSTIFIED",
      }[parentStyle.textAlign] || "LEFT",
      ...(fill ? { fills: [fill] } : {}),
    };
  }

  function alignment(value, between = false) {
    if (between && value === "space-between") return "SPACE_BETWEEN";
    if (["center", "space-around", "space-evenly"].includes(value)) return "CENTER";
    if (["flex-end", "end", "right"].includes(value)) return "MAX";
    if (value === "baseline") return "BASELINE";
    return "MIN";
  }

  function isTextOnly(element) {
    if (element.children.length > 0) return false;
    const style = getComputedStyle(element);
    const hasSurface =
      color(style.backgroundColor) ||
      px(style.borderTopWidth) > 0 ||
      px(style.paddingTop) + px(style.paddingRight) + px(style.paddingBottom) + px(style.paddingLeft) > 0;
    return !hasSurface && (element.textContent?.trim().length ?? 0) > 0;
  }

  function serialize(element, parentRect, warnings, depth = 0) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (!visible(element, style, rect)) return null;

    if (element instanceof SVGSVGElement) {
      return {
        type: "VECTOR",
        name: layerName(element, "Icon"),
        width: round(rect.width),
        height: round(rect.height),
        x: round(rect.left - parentRect.left),
        y: round(rect.top - parentRect.top),
        svg: element.outerHTML,
      };
    }

    if (isTextOnly(element)) {
      return textLayer(element.firstChild, parentRect, style, 0);
    }

    const display = style.display;
    const flex = display === "flex" || display === "inline-flex";
    const layoutMode = flex
      ? style.flexDirection.startsWith("row") ? "HORIZONTAL" : "VERTICAL"
      : "NONE";
    const children = [];
    let textIndex = 0;
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = textLayer(child, rect, style, textIndex++);
        if (text) children.push(text);
      } else if (child instanceof Element) {
        const layer = serialize(child, rect, warnings, depth + 1);
        if (layer) children.push(layer);
      }
    }
    if (["INPUT", "TEXTAREA"].includes(element.tagName) && children.length === 0) {
      const value = element.value || element.getAttribute("placeholder") || "";
      if (value) {
        const fill = color(style.color);
        children.push({
          type: "TEXT",
          name: "Value",
          characters: value,
          width: Math.max(1, round(rect.width - px(style.paddingLeft) - px(style.paddingRight))),
          height: Math.max(1, round(rect.height - px(style.paddingTop) - px(style.paddingBottom))),
          x: px(style.paddingLeft),
          y: px(style.paddingTop),
          fontFamily: style.fontFamily.split(",")[0].replaceAll(/['"]/g, "").trim(),
          fontStyle: fontStyle(style),
          fontWeight: Number(style.fontWeight) || 400,
          fontSize: px(style.fontSize),
          lineHeight: style.lineHeight === "normal" ? px(style.fontSize) * 1.2 : px(style.lineHeight),
          letterSpacing: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
          textAlignHorizontal: "LEFT",
          ...(fill ? { fills: [fill] } : {}),
        });
      }
    }

    if (!flex && children.length > 1) {
      warnings.push(
        `${layerName(element, element.tagName.toLowerCase())} has ${children.length} children and cannot become Auto Layout (${display}).`,
      );
    }

    const fill = color(style.backgroundColor);
    const stroke = px(style.borderTopWidth) > 0 ? color(style.borderTopColor) : null;
    const inline = display.startsWith("inline") || style.width === "fit-content";
    const frame = {
      type: "FRAME",
      name: layerName(element, depth === 0 ? "Source" : element.tagName.toLowerCase()),
      width: round(rect.width),
      height: round(rect.height),
      x: round(rect.left - parentRect.left),
      y: round(rect.top - parentRect.top),
      layoutMode,
      primaryAxisSizingMode: inline ? "AUTO" : "FIXED",
      counterAxisSizingMode: inline ? "AUTO" : "FIXED",
      ...(flex ? {
        primaryAxisAlignItems: alignment(style.justifyContent, true),
        counterAxisAlignItems: alignment(style.alignItems),
        layoutWrap: style.flexWrap === "wrap" ? "WRAP" : "NO_WRAP",
        paddingTop: px(style.paddingTop),
        paddingRight: px(style.paddingRight),
        paddingBottom: px(style.paddingBottom),
        paddingLeft: px(style.paddingLeft),
        itemSpacing: px(style.columnGap || style.gap),
        counterAxisSpacing: px(style.rowGap || style.gap),
      } : {}),
      cornerRadius: px(style.borderTopLeftRadius),
      opacity: round(Number(style.opacity || "1")),
      clipsContent: style.overflow !== "visible",
      ...(fill ? { fills: [fill] } : { fills: [] }),
      ...(stroke ? {
        strokes: [stroke],
        strokeWeight: px(style.borderTopWidth),
      } : {}),
      children,
    };
    return frame;
  }

  function captureSource(sourceNode) {
    const roots = [...document.querySelectorAll("[data-figma-source-node]")];
    const root = roots.find((candidate) => candidate.getAttribute("data-figma-source-node") === sourceNode);
    if (!root) throw new Error(`Could not find source "${sourceNode}".`);
    const rect = root.getBoundingClientRect();
    const warnings = [];
    const scene = serialize(root, { left: rect.left, top: rect.top }, warnings);
    scene.name = sourceNode;
    scene.x = 0;
    scene.y = 0;
    return { scene, warnings };
  }

  window.PerfectLibraries = { captureSource };
})();
