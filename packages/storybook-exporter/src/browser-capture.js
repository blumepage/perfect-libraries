(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const roundColor = (value) => Math.round(value * 10_000) / 10_000;
  const px = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? round(parsed) : 0;
  };
  const clamp = (value, minimum = 0, maximum = 1) =>
    Math.min(maximum, Math.max(minimum, value));
  const visible = (element, style, rect) => {
    const visuallyHidden =
      style.position === "absolute" &&
      rect.width <= 1 &&
      rect.height <= 1 &&
      (style.clip !== "auto" || (style.clipPath && style.clipPath !== "none"));
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number.parseFloat(style.opacity || "1") > 0 &&
      !visuallyHidden &&
      rect.width >= 0.5 &&
      rect.height >= 0.5
    );
  };

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = 1;
  colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });

  function rgbaColor(value) {
    const source = value?.trim();
    if (
      !source ||
      source === "none" ||
      !colorContext ||
      !globalThis.CSS?.supports?.("color", source)
    ) {
      return null;
    }
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = source;
    colorContext.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
    return {
      r: roundColor(r / 255),
      g: roundColor(g / 255),
      b: roundColor(b / 255),
      a: roundColor(a / 255),
    };
  }

  function solidPaint(value) {
    const color = rgbaColor(value);
    if (!color || color.a <= 0) return null;
    return {
      type: "SOLID",
      color: { r: color.r, g: color.g, b: color.b },
      ...(color.a < 1 ? { opacity: color.a } : {}),
    };
  }

  function cssColor(value) {
    const color = rgbaColor(value);
    if (!color) return "rgba(0, 0, 0, 0)";
    const red = Math.round(color.r * 255);
    const green = Math.round(color.g * 255);
    const blue = Math.round(color.b * 255);
    return `rgba(${red}, ${green}, ${blue}, ${color.a})`;
  }

  function bakeCurrentColor(svg, style) {
    return svg.replaceAll(/currentColor/gi, cssColor(style.color));
  }

  function dataSvg(source) {
    const match = /^data:image\/svg\+xml(?:;[^,]*)?,(.*)$/is.exec(source);
    if (!match) return null;
    try {
      return /;base64,/i.test(source)
        ? atob(match[1])
        : decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let start = 0; start < bytes.length; start += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
    }
    return btoa(binary);
  }

  function supportedRasterMimeType(value) {
    const normalized = value?.split(";", 1)[0].trim().toLowerCase();
    if (normalized === "image/jpg") return "image/jpeg";
    return ["image/png", "image/jpeg", "image/gif"].includes(normalized)
      ? normalized
      : null;
  }

  async function imageLayer(element, style, rect, parentRect, warnings) {
    const source = element.currentSrc || element.src;
    const name = layerName(element, element.alt || "Image");
    const inlineSvg = dataSvg(source);
    if (inlineSvg) {
      return {
        type: "VECTOR",
        name,
        width: round(rect.width),
        height: round(rect.height),
        x: round(rect.left - parentRect.left),
        y: round(rect.top - parentRect.top),
        svg: bakeCurrentColor(inlineSvg, style),
      };
    }

    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const responseMimeType = response.headers.get("content-type") ?? "";
      if (responseMimeType.toLowerCase().startsWith("image/svg+xml")) {
        return {
          type: "VECTOR",
          name,
          width: round(rect.width),
          height: round(rect.height),
          x: round(rect.left - parentRect.left),
          y: round(rect.top - parentRect.top),
          svg: bakeCurrentColor(new TextDecoder().decode(bytes), style),
        };
      }
      const mimeType = supportedRasterMimeType(responseMimeType);
      if (!mimeType) {
        throw new Error(
          responseMimeType
            ? `unsupported MIME type ${responseMimeType}`
            : "missing image MIME type",
        );
      }
      return {
        type: "IMAGE",
        name,
        width: round(rect.width),
        height: round(rect.height),
        x: round(rect.left - parentRect.left),
        y: round(rect.top - parentRect.top),
        data: bytesToBase64(bytes),
        mimeType,
        scaleMode: ["contain", "scale-down"].includes(style.objectFit)
          ? "FIT"
          : "FILL",
        ...radiusProperties(style),
        opacity: round(Number(style.opacity || "1")),
        ...borderProperties(style, warnings, name),
        effects: appearanceEffects(style, warnings, name),
      };
    } catch (error) {
      const reason = error instanceof Error ? ` (${error.message})` : "";
      warnings.push(
        `${name} uses an image that could not be fetched and cannot become an editable Figma source${reason}.`,
      );
      return null;
    }
  }

  function splitTopLevel(value, separator = ",") {
    const parts = [];
    let depth = 0;
    let start = 0;
    let quote = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (quote) {
        if (character === quote && value[index - 1] !== "\\") quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === "(") depth += 1;
      else if (character === ")") depth = Math.max(0, depth - 1);
      else if (character === separator && depth === 0) {
        parts.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  }

  function functionPrefix(value) {
    const open = value.indexOf("(");
    if (open < 1) return null;
    let depth = 0;
    for (let index = open; index < value.length; index += 1) {
      if (value[index] === "(") depth += 1;
      else if (value[index] === ")") {
        depth -= 1;
        if (depth === 0) return value.slice(0, index + 1);
      }
    }
    return null;
  }

  function colorAndPosition(value) {
    const source = value.trim();
    const prefixed = functionPrefix(source);
    if (prefixed && rgbaColor(prefixed)) {
      return { color: prefixed, position: source.slice(prefixed.length).trim() };
    }
    const token = source.split(/\s+/, 1)[0];
    return rgbaColor(token)
      ? { color: token, position: source.slice(token.length).trim() }
      : null;
  }

  function gradientDirection(value) {
    const source = value.trim().toLowerCase();
    const directions = {
      "to top": 0,
      "to top right": 45,
      "to right top": 45,
      "to right": 90,
      "to bottom right": 135,
      "to right bottom": 135,
      "to bottom": 180,
      "to bottom left": 225,
      "to left bottom": 225,
      "to left": 270,
      "to top left": 315,
      "to left top": 315,
    };
    if (source in directions) return directions[source];
    const angle = /^(-?\d+(?:\.\d+)?)(deg|grad|rad|turn)$/.exec(source);
    if (!angle) return null;
    const valueNumber = Number(angle[1]);
    if (angle[2] === "grad") return valueNumber * 0.9;
    if (angle[2] === "rad") return valueNumber * 180 / Math.PI;
    if (angle[2] === "turn") return valueNumber * 360;
    return valueNumber;
  }

  function gradientTransform(cssAngle) {
    // CSS angles use 0deg=up and 90deg=right. Figma's identity gradient runs
    // left-to-right, so rotate that axis around the normalized frame center.
    const theta = (cssAngle - 90) * Math.PI / 180;
    const cosine = roundColor(Math.cos(theta));
    const sine = roundColor(Math.sin(theta));
    return [
      [cosine, -sine, roundColor(0.5 - 0.5 * cosine + 0.5 * sine)],
      [sine, cosine, roundColor(0.5 - 0.5 * sine - 0.5 * cosine)],
    ];
  }

  function stopPosition(value) {
    if (!value) return null;
    const match = /^(-?\d+(?:\.\d+)?)%/.exec(value);
    return match ? clamp(Number(match[1]) / 100) : null;
  }

  function fillMissingStopPositions(stops) {
    if (stops.length === 0) return;
    if (stops[0].position === null) stops[0].position = 0;
    if (stops.at(-1).position === null) stops.at(-1).position = 1;
    let start = 0;
    while (start < stops.length - 1) {
      let end = start + 1;
      while (end < stops.length && stops[end].position === null) end += 1;
      const startPosition = stops[start].position;
      const endPosition = stops[end]?.position ?? startPosition;
      const count = end - start;
      for (let index = 1; index < count; index += 1) {
        stops[start + index].position =
          startPosition + (endPosition - startPosition) * index / count;
      }
      start = end;
    }
    let previous = 0;
    for (const stop of stops) {
      stop.position = clamp(Math.max(previous, stop.position ?? previous));
      previous = stop.position;
    }
  }

  function linearGradient(value) {
    const match = /^linear-gradient\((.*)\)$/i.exec(value.trim());
    if (!match) return null;
    const parts = splitTopLevel(match[1]);
    let angle = 180;
    const explicitDirection = gradientDirection(parts[0]);
    if (explicitDirection !== null) {
      angle = explicitDirection;
      parts.shift();
    }
    const stops = parts.map((part) => {
      const parsed = colorAndPosition(part);
      if (!parsed) return null;
      const color = rgbaColor(parsed.color);
      return color
        ? {
            position: stopPosition(parsed.position),
            color,
          }
        : null;
    });
    if (stops.length < 2 || stops.some((stop) => !stop)) return null;
    fillMissingStopPositions(stops);
    return {
      type: "GRADIENT_LINEAR",
      gradientTransform: gradientTransform(angle),
      gradientStops: stops,
    };
  }

  function radialGradient(value) {
    const match = /^radial-gradient\((.*)\)$/i.exec(value.trim());
    if (!match) return null;
    const parts = splitTopLevel(match[1]);
    // Support the CSS default: a centered farthest-corner ellipse. Other
    // shapes/positions remain blocking until their geometry is implemented.
    if (/^(ellipse(?: farthest-corner)?|farthest-corner(?: ellipse)?)$/.test(parts[0])) parts.shift();
    const stops = parts.map(part => {
      const parsed = colorAndPosition(part);
      const color = parsed && rgbaColor(parsed.color);
      if (!color || (parsed.position && !/^-?\d+(?:\.\d+)?%$/.test(parsed.position))) return null;
      return { position: stopPosition(parsed.position), color };
    });
    if (stops.length < 2 || stops.some(stop => !stop)) return null;
    fillMissingStopPositions(stops);
    // Figma maps the frame into gradient space. The farthest-corner ellipse
    // has radii sqrt(2) times the half-width/half-height, centered at .5,.5.
    const scale = Math.SQRT1_2;
    return { type: "GRADIENT_RADIAL", gradientTransform: [
      [scale, 0, (1 - scale) / 2], [0, scale, (1 - scale) / 2],
    ], gradientStops: stops };
  }

  function backgroundPaints(style, warnings, name) {
    const paints = [];
    if (style.backgroundImage && style.backgroundImage !== "none") {
      for (const layer of splitTopLevel(style.backgroundImage)) {
        const gradient = linearGradient(layer) || radialGradient(layer);
        if (gradient) paints.push(gradient);
        else warnings.push(`${name} has an unsupported background image: ${layer}.`);
      }
    }
    const background = solidPaint(style.backgroundColor);
    if (background) paints.push(background);
    return paints;
  }

  function shadowColorPrefix(value) {
    const source = value.trim();
    const prefixed = functionPrefix(source);
    if (prefixed && rgbaColor(prefixed)) return prefixed;
    const token = source.split(/\s+/, 1)[0];
    return rgbaColor(token) ? token : null;
  }

  function shadowEffects(value, warnings, name) {
    if (!value || value === "none") return [];
    const effects = [];
    for (const layer of splitTopLevel(value)) {
      const colorSource = shadowColorPrefix(layer);
      const color = colorSource ? rgbaColor(colorSource) : null;
      const inset = /\binset\b/i.test(layer);
      const lengths = layer
        .replace(colorSource ?? "", "")
        .replace(/\binset\b/gi, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => /^-?\d+(?:\.\d+)?(?:px)?$/.test(token) ? Number.parseFloat(token) : Number.NaN);
      if (!color || lengths.length < 2 || lengths.some((length) => !Number.isFinite(length))) {
        warnings.push(`${name} has an unsupported box shadow: ${layer}.`);
        continue;
      }
      const [x, y, blur = 0, spread = 0] = lengths;
      effects.push({
        type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
        color,
        offset: { x: round(x), y: round(y) },
        radius: Math.max(0, round(blur)),
        ...(spread !== 0 ? { spread: round(spread) } : {}),
      });
    }
    return effects;
  }

  function borderProperties(style, warnings, name) {
    const sides = [
      ["Top", style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
      ["Right", style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
      ["Bottom", style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
      ["Left", style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor],
    ].map(([side, width, borderStyle, borderColor]) => ({
      side,
      width: ["none", "hidden"].includes(borderStyle) ? 0 : px(width),
      paint: solidPaint(borderColor),
    }));
    const visibleSides = sides.filter((side) => side.width > 0 && side.paint);
    if (visibleSides.length === 0) return {};
    const stroke = visibleSides[0].paint;
    const colorKey = JSON.stringify(stroke);
    if (visibleSides.some((side) => JSON.stringify(side.paint) !== colorKey)) {
      warnings.push(`${name} uses different border colors per side; Figma uses the first visible color.`);
    }
    const weights = Object.fromEntries(
      sides.map((side) => [`stroke${side.side}Weight`, side.width]),
    );
    const uniform = sides.every((side) => side.width === sides[0].width);
    return {
      strokes: [stroke],
      strokeAlign: "INSIDE",
      ...(uniform ? { strokeWeight: sides[0].width } : weights),
    };
  }

  function radiusProperties(style) {
    const radii = {
      topLeftRadius: px(style.borderTopLeftRadius),
      topRightRadius: px(style.borderTopRightRadius),
      bottomRightRadius: px(style.borderBottomRightRadius),
      bottomLeftRadius: px(style.borderBottomLeftRadius),
    };
    const values = Object.values(radii);
    return values.every((value) => value === values[0])
      ? { cornerRadius: values[0] }
      : radii;
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
    const fill = solidPaint(parentStyle.color);
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

  function overlayConstraints(layer, parentRect) {
    function nearestAnchor(position, size, parentSize) {
      const distances = [
        ["MIN", Math.abs(position)],
        ["CENTER", Math.abs(position + size / 2 - parentSize / 2)],
        ["MAX", Math.abs(parentSize - position - size)],
      ];
      distances.sort((left, right) => left[1] - right[1]);
      return distances[0][0];
    }
    return {
      horizontal: nearestAnchor(layer.x ?? 0, layer.width, parentRect.width),
      vertical: nearestAnchor(layer.y ?? 0, layer.height, parentRect.height),
    };
  }

  function approximatelyUniform(values, tolerance = 1.5) {
    return (
      values.length === 0 ||
      Math.max(...values) - Math.min(...values) <= tolerance
    );
  }

  function average(values) {
    return values.length === 0
      ? 0
      : round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  function layoutPadding(children, rect) {
    const left = Math.min(...children.map((child) => child.x ?? 0));
    const top = Math.min(...children.map((child) => child.y ?? 0));
    const right = Math.max(
      ...children.map((child) => (child.x ?? 0) + child.width),
    );
    const bottom = Math.max(
      ...children.map((child) => (child.y ?? 0) + child.height),
    );
    return {
      paddingTop: Math.max(0, round(top)),
      paddingRight: Math.max(0, round(rect.width - right)),
      paddingBottom: Math.max(0, round(rect.height - bottom)),
      paddingLeft: Math.max(0, round(left)),
    };
  }

  function orderedWithoutOverlap(children, axis) {
    const position = axis === "x" ? "x" : "y";
    const size = axis === "x" ? "width" : "height";
    return children.every(
      (child, index) =>
        index === 0 ||
        (child[position] ?? 0) >=
          (children[index - 1][position] ?? 0) +
            children[index - 1][size] -
            0.5,
    );
  }

  function inferredLinearLayout(children, rect, axis) {
    if (!orderedWithoutOverlap(children, axis)) return null;
    const position = axis === "x" ? "x" : "y";
    const size = axis === "x" ? "width" : "height";
    const gaps = children.slice(1).map(
      (child, index) =>
        (child[position] ?? 0) -
        ((children[index][position] ?? 0) + children[index][size]),
    );
    if (!approximatelyUniform(gaps)) {
      // Preserve unequal CSS margins as padding on editable flow containers.
      const padding = layoutPadding(children, rect);
      const crossPosition = axis === "x" ? "y" : "x";
      const crossSize = axis === "x" ? "height" : "width";
      const start = Math.min(...children.map(child => child[crossPosition] ?? 0));
      const end = Math.max(...children.map(child => (child[crossPosition] ?? 0) + child[crossSize]));
      children.forEach((child, index) => {
        const inner = { ...child };
        const gap = Math.max(0, gaps[index] ?? 0);
        const inset = Math.max(0, (inner[crossPosition] ?? 0) - start);
        const wrapper = {
          type: "FRAME", name: `Flow ${index + 1}`,
          width: axis === "x" ? inner.width + gap : end - start,
          height: axis === "y" ? inner.height + gap : end - start,
          x: axis === "x" ? inner.x : start,
          y: axis === "y" ? inner.y : start,
          layoutMode: axis === "x" ? "HORIZONTAL" : "VERTICAL",
          primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED",
          primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN",
          paddingTop: axis === "x" ? inset : 0,
          paddingLeft: axis === "y" ? inset : 0,
          paddingBottom: axis === "y" ? gap : Math.max(0, end - start - inset - inner.height),
          paddingRight: axis === "x" ? gap : Math.max(0, end - start - inset - inner.width),
          itemSpacing: 0, children: [inner]
        };
        inner.x = wrapper.paddingLeft;
        inner.y = wrapper.paddingTop;
        // Keep the reference shared by children and flowChildren.
        for (const key of Object.keys(child)) delete child[key];
        Object.assign(child, wrapper);
      });
      return {
        layoutMode: axis === "x" ? "HORIZONTAL" : "VERTICAL",
        primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN",
        layoutWrap: "NO_WRAP", ...padding, itemSpacing: 0, counterAxisSpacing: 0
      };
    }
    return {
      layoutMode: axis === "x" ? "HORIZONTAL" : "VERTICAL",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
      layoutWrap: "NO_WRAP",
      ...layoutPadding(children, rect),
      itemSpacing: Math.max(0, average(gaps)),
      counterAxisSpacing: 0,
    };
  }

  function rowGroups(children) {
    const rows = [];
    for (const child of children) {
      const y = child.y ?? 0;
      const row = rows.find(
        (candidate) => Math.abs(candidate.anchor - y) <= 1.5,
      );
      if (row) row.children.push(child);
      else rows.push({ anchor: y, children: [child] });
    }
    rows.sort((first, second) => first.anchor - second.anchor);
    for (const row of rows) {
      row.children.sort((first, second) => (first.x ?? 0) - (second.x ?? 0));
    }
    return rows;
  }

  function inferredWrappedLayout(children, rect) {
    const rows = rowGroups(children);
    if (
      rows.length < 2 ||
      rows.some((row) => !orderedWithoutOverlap(row.children, "x"))
    ) {
      return null;
    }
    const rowBounds = rows.map((row) => ({
      top: Math.min(...row.children.map((child) => child.y ?? 0)),
      bottom: Math.max(
        ...row.children.map((child) => (child.y ?? 0) + child.height),
      ),
    }));
    const rowGaps = rowBounds.slice(1).map(
      (row, index) => row.top - rowBounds[index].bottom,
    );
    const columnGaps = rows.flatMap((row) =>
      row.children.slice(1).map(
        (child, index) =>
          (child.x ?? 0) -
          ((row.children[index].x ?? 0) + row.children[index].width),
      ),
    );
    if (
      rowGaps.some((gap) => gap < -0.5) ||
      columnGaps.some((gap) => gap < -0.5) ||
      !approximatelyUniform(rowGaps) ||
      !approximatelyUniform(columnGaps)
    ) {
      return null;
    }
    return {
      layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
      layoutWrap: "WRAP",
      ...layoutPadding(children, rect),
      itemSpacing: Math.max(0, average(columnGaps)),
      counterAxisSpacing: Math.max(0, average(rowGaps)),
    };
  }

  // Grid rows may contain vertically centered labels plus a spanning control.
  // Preserve the measured rows as nested Auto Layout frames instead of treating
  // their unequal tops as a single wrapped row of equal-height cells.
  function inferredGridRows(children, rect) {
    const rows = [];
    for (const child of [...children].sort((a, b) => (a.y ?? 0) - (b.y ?? 0))) {
      const top = child.y ?? 0, bottom = top + child.height;
      const matches = rows.filter(row => top < row.bottom - .5 && bottom > row.top + .5);
      if (matches.length > 1) return null;
      const row = matches[0];
      if (row) { row.children.push(child); row.top = Math.min(row.top, top); row.bottom = Math.max(row.bottom, bottom); }
      else rows.push({ top, bottom, children: [child] });
    }
    if (rows.length < 2) return null;
    for (const row of rows) {
      row.children.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      if (!orderedWithoutOverlap(row.children, "x")) return null;
    }
    const padding = layoutPadding(children, rect);
    const frames = rows.map((row, index) => ({
      type: 'FRAME', name: `Grid row ${index + 1}`, x: 0, y: row.top,
      width: rect.width, height: (rows[index + 1]?.top ?? row.bottom) - row.top,
      layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
      paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, itemSpacing: 0,
      children: row.children.map((child, column) => {
        const left = child.x ?? 0;
        const start = column === 0 ? 0 : (row.children[column - 1].x ?? 0) + row.children[column - 1].width;
        const top = Math.max(0, (child.y ?? 0) - row.top);
        return { type: 'FRAME', name: `Grid cell ${column + 1}`, width: left - start + child.width, height: row.bottom - row.top,
          layoutMode: 'VERTICAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
          paddingLeft: Math.max(0, left - start), paddingRight: 0, paddingTop: top, paddingBottom: Math.max(0, row.bottom - (child.y ?? 0) - child.height), itemSpacing: 0,
          children: [{...child, x: 0, y: 0}] };
      })
    }));
    children.splice(0, children.length, ...frames);
    return { layoutMode: 'VERTICAL', primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN', layoutWrap: 'NO_WRAP',
      paddingTop: padding.paddingTop, paddingBottom: padding.paddingBottom, paddingLeft: 0, paddingRight: 0, itemSpacing: 0, counterAxisSpacing: 0 };
  }

  function inferLayout(element, style, children, rect) {
    if (children.length === 0) return null;
    if (children.length === 1) return {
      layoutMode: "VERTICAL", primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN",
      layoutWrap: "NO_WRAP", ...layoutPadding(children, rect), itemSpacing: 0, counterAxisSpacing: 0
    };
    if (style.display === "grid" || style.display === "inline-grid") {
      return (
        inferredWrappedLayout(children, rect) ||
        inferredGridRows(children, rect) ||
        inferredLinearLayout(children, rect, "x") ||
        inferredLinearLayout(children, rect, "y")
      );
    }
    return (
      inferredLinearLayout(children, rect, "y") ||
      inferredLinearLayout(children, rect, "x")
    );
  }

  function isTextOnly(element) {
    if (element.children.length > 0) return false;
    const style = getComputedStyle(element);
    const hasSurface =
      solidPaint(style.backgroundColor) ||
      style.backgroundImage !== "none" ||
      style.boxShadow !== "none" ||
      (style.filter && style.filter !== "none") ||
      px(style.borderTopWidth) +
        px(style.borderRightWidth) +
        px(style.borderBottomWidth) +
        px(style.borderLeftWidth) > 0 ||
      px(style.paddingTop) + px(style.paddingRight) + px(style.paddingBottom) + px(style.paddingLeft) > 0;
    return !hasSurface && (element.textContent?.trim().length ?? 0) > 0;
  }

  function hasAuthoredAutoMargin(element, property) {
    if (element.style?.[property] === "auto") return true;
    const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    function ruleListHasAutoMargin(rules) {
      for (const rule of rules) {
        if (rule.selectorText && rule.style) {
          try {
            if (
              element.matches(rule.selectorText) &&
              rule.style.getPropertyValue(cssProperty).trim() === "auto"
            ) {
              return true;
            }
          } catch {
            // Ignore selectors the browser cannot match in this context.
          }
        }
        if (rule.cssRules && ruleListHasAutoMargin(rule.cssRules)) return true;
      }
      return false;
    }
    for (const sheet of document.styleSheets) {
      try {
        if (sheet.cssRules && ruleListHasAutoMargin(sheet.cssRules)) return true;
      } catch {
        // Cross-origin stylesheets are opaque; layout still exports without them.
      }
    }
    return false;
  }

  function autoLayoutChildSizing(element, style) {
    if (
      style.position === "absolute" ||
      style.position === "fixed" ||
      !element.parentElement
    ) {
      return {};
    }
    const parentStyle = getComputedStyle(element.parentElement);
    // A single row of explicitly equal fractional tracks remains responsive
    // when translated to horizontal Auto Layout. Do not guess for mixed tracks,
    // spanning cells, implicit tracks or multi-row grids.
    if (parentStyle.display === "grid" || parentStyle.display === "inline-grid") {
      const equalTracks = /^repeat\(\s*(\d+)\s*,\s*minmax\(\s*0(?:px)?\s*,\s*1fr\s*\)\s*\)$/.exec(element.parentElement.style.gridTemplateColumns);
      const cells = [...element.parentElement.children].filter(child => {
        const css = getComputedStyle(child);
        return css.display !== "none" && css.position !== "absolute" && css.position !== "fixed";
      });
      const bounds = cells.map(child => child.getBoundingClientRect());
      const trackWidths = parentStyle.gridTemplateColumns.split(/\s+/).map(track => /^\d+(?:\.\d+)?px$/.test(track) ? parseFloat(track) : NaN);
      const stretchable = cells.every((child, index) => {
        const css = getComputedStyle(child);
        const width = child.computedStyleMap?.().get("width");
        const alignment = css.justifySelf === "auto" ? parentStyle.justifyItems : css.justifySelf;
        const fluidWidth = String(width) === "auto"
          ? ["normal", "stretch"].includes(alignment)
          : width?.unit === "percent" && width.value === 100;
        return fluidWidth && css.maxWidth === "none" &&
          px(css.marginLeft) === 0 && px(css.marginRight) === 0 &&
          Math.abs(bounds[index].width - trackWidths[index]) < 0.5;
      });
      if (stretchable && trackWidths.length === cells.length && equalTracks && cells.length === Number(equalTracks[1]) && bounds.length &&
          bounds.every(rect => Math.abs(rect.top - bounds[0].top) < 0.5 && Math.abs(rect.width - bounds[0].width) < 0.5)) {
        return { layoutSizingHorizontal: "FILL" };
      }
      return {};
    }
    if (
      parentStyle.display !== "flex" &&
      parentStyle.display !== "inline-flex"
    ) {
      return {};
    }
    const horizontal = parentStyle.flexDirection.startsWith("row");
    const fillsAxis =
      Number(style.flexGrow) > 0 ||
      (horizontal
        ? hasAuthoredAutoMargin(element, "marginLeft") ||
          hasAuthoredAutoMargin(element, "marginRight")
        : hasAuthoredAutoMargin(element, "marginTop") ||
          hasAuthoredAutoMargin(element, "marginBottom"));
    if (!fillsAxis) return {};
    return horizontal
      ? { layoutSizingHorizontal: "FILL" }
      : { layoutSizingVertical: "FILL" };
  }

  function inlineTextFrame(element, style, rect, parentRect, warnings) {
    if (element.tagName !== "P" || solidPaint(style.backgroundColor) || style.backgroundImage !== "none") return null;
    const descendants = [...element.querySelectorAll('*')];
    if (!descendants.length || !descendants.every(child => {
      const css = getComputedStyle(child);
      return ['SPAN', 'A', 'STRONG', 'EM', 'B', 'I'].includes(child.tagName) &&
        css.display === 'inline' && css.backgroundColor === 'rgba(0, 0, 0, 0)' &&
        css.backgroundImage === 'none' && css.textDecorationLine === 'none' &&
        css.boxShadow === 'none' && (!css.filter || css.filter === 'none') && ['Top', 'Right', 'Bottom', 'Left'].every(side => px(css[`border${side}Width`]) === 0);
    })) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const fragments = [];
    let text;
    while ((text = walker.nextNode())) {
      const css = getComputedStyle(text.parentElement);
      if (css.visibility !== 'visible') continue;
      let opacity = 1;
      for (let ancestor = text.parentElement; ancestor !== element; ancestor = ancestor.parentElement) {
        opacity *= Number(getComputedStyle(ancestor).opacity);
      }
      if (opacity === 0) continue;
      let start = 0;
      let prior = null;
      const emit = end => {
        if (end <= start) return;
        const range = document.createRange();
        range.setStart(text, start); range.setEnd(text, end);
        const box = range.getBoundingClientRect();
        const characters = text.textContent.slice(start, end).replace(/\s+/g, ' ');
        if (box.width > 0.1 && characters.trim()) {
          const layer = textLayer(text, rect, css, fragments.length);
          if (layer) fragments.push({ ...layer, opacity, characters, x: round(box.left - rect.left), y: round(box.top - rect.top), width: round(box.width), height: round(box.height) });
        }
      };
      for (let index = 0; index < text.length; index++) {
        const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 1);
        const box = range.getBoundingClientRect();
        if (prior !== null && Math.abs(box.top - prior) > 1) { emit(index); start = index; }
        prior = box.top;
      }
      emit(text.length);
    }
    if (!fragments.length) return null;
    const rows = [];
    for (const fragment of fragments) {
      let row = rows.find(row => Math.abs(row.top - fragment.y) < 2);
      if (!row) { row = { top: fragment.y, fragments: [] }; rows.push(row); }
      row.fragments.push(fragment);
    }
    rows.sort((a, b) => a.top - b.top);
    const children = rows.map((row, index) => {
      row.fragments.sort((a, b) => a.x - b.x);
      const bottom = Math.max(...row.fragments.map(fragment => fragment.y + fragment.height));
      const height = (rows[index + 1]?.top ?? bottom) - row.top;
      // Each measured run retains its own font and color. Horizontal gaps are
      // represented by run padding so inline whitespace survives generation.
      const runs = row.fragments.map((fragment, runIndex) => {
        const next = row.fragments[runIndex + 1];
        const width = (next?.x ?? fragment.x + fragment.width) - fragment.x;
        const inner = { ...fragment, x: 0, y: Math.max(0, fragment.y - row.top) };
        return { type: 'FRAME', name: `Run ${runIndex + 1}`, width, height,
          layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
          paddingTop: inner.y, paddingBottom: Math.max(0, height - inner.y - fragment.height),
          paddingLeft: 0, paddingRight: Math.max(0, width - fragment.width), itemSpacing: 0, children: [inner] };
      });
      return { type: 'FRAME', name: `Line ${index + 1}`, width: rect.width, height,
        layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
        paddingLeft: Math.max(0, row.fragments[0].x), paddingRight: 0, paddingTop: 0, paddingBottom: 0, itemSpacing: 0, children: runs };
    });
    return { type: 'FRAME', name: layerName(element, element.tagName.toLowerCase()),
      x: round(rect.left - parentRect.left), y: round(rect.top - parentRect.top), width: round(rect.width), height: round(rect.height),
      layoutMode: 'VERTICAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
      paddingTop: Math.max(0, rows[0].top), paddingBottom: 0, paddingLeft: 0, paddingRight: 0, itemSpacing: 0,
      ...frameAppearance(style, warnings, layerName(element, 'p')), children };
  }

  function appearanceEffects(style, warnings, name) {
    const effects = shadowEffects(style.boxShadow, warnings, name);
    if (style.filter && style.filter !== "none") {
      const blur = /^blur\(([\d.]+)px\)$/.exec(style.filter);
      const dropShadow = /^drop-shadow\((.+)\)$/.exec(style.filter);
      if (blur) effects.push({ type: "LAYER_BLUR", radius: Number(blur[1]) });
      else if (dropShadow) effects.push(...shadowEffects(dropShadow[1], warnings, name));
      else if (!/^grayscale\(([\d.]+)(%)?\)$/.test(style.filter)) warnings.push(`${name} has an unsupported filter: ${style.filter}.`);
    }
    return effects;
  }

  function frameAppearance(style, warnings, name) {
    return {
      ...radiusProperties(style),
      opacity: round(Number(style.opacity || "1")),
      clipsContent: style.overflow !== "visible",
      fills: backgroundPaints(style, warnings, name),
      ...borderProperties(style, warnings, name),
      effects: appearanceEffects(style, warnings, name),
    };
  }

  // Bake grayscale into editable paints; unsupported image/vector subtrees
  // remain blocking rather than silently losing the filter.
  function grayscaleScene(scene, amount, warnings) {
    if (scene.type === "IMAGE" || scene.type === "VECTOR") {
      warnings.push(`${scene.name} has an unsupported filter: grayscale on image or vector content.`);
      return;
    }
    const transform = (color) => {
      const gray = .2126 * color.r + .7152 * color.g + .0722 * color.b;
      for (const channel of ["r", "g", "b"]) color[channel] = roundColor(color[channel] * (1 - amount) + gray * amount);
    };
    for (const paint of [...(scene.fills ?? []), ...(scene.strokes ?? [])]) {
      if (paint.color) transform(paint.color);
      for (const stop of paint.gradientStops ?? []) transform(stop.color);
    }
    for (const effect of scene.effects ?? []) if (effect.color) transform(effect.color);
    for (const child of scene.children ?? []) grayscaleScene(child, amount, warnings);
  }

  async function serialize(element, parentRect, warnings, depth = 0) {
    const scene = await serializeElement(element, parentRect, warnings, depth);
    const grayscale = /^grayscale\(([\d.]+)(%)?\)$/.exec(getComputedStyle(element).filter);
    if (scene && grayscale) grayscaleScene(scene, clamp(Number(grayscale[1]) / (grayscale[2] ? 100 : 1)), warnings);
    return scene;
  }

  async function serializeElement(element, parentRect, warnings, depth = 0) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (!visible(element, style, rect)) return null;
    const childSizing = autoLayoutChildSizing(element, style);

    if (element instanceof SVGSVGElement) {
      return {
        type: "VECTOR",
        name: layerName(element, "Icon"),
        width: round(rect.width),
        height: round(rect.height),
        x: round(rect.left - parentRect.left),
        y: round(rect.top - parentRect.top),
        svg: bakeCurrentColor(element.outerHTML, style),
        ...childSizing,
      };
    }

    if (element instanceof HTMLImageElement) {
      const layer = await imageLayer(element, style, rect, parentRect, warnings);
      return layer ? { ...layer, ...childSizing } : null;
    }

    const inlineText = inlineTextFrame(element, style, rect, parentRect, warnings);
    if (inlineText) return { ...inlineText, ...childSizing };

    if (isTextOnly(element)) {
      const layer = textLayer(element.firstChild, parentRect, style, 0);
      return layer ? { ...layer, ...childSizing } : null;
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
        const layer = await serialize(child, rect, warnings, depth + 1);
        if (layer) {
          const childPosition = getComputedStyle(child).position;
          if (childPosition === "absolute" || childPosition === "fixed") {
            layer.layoutPositioning = "ABSOLUTE";
            layer.constraints = overlayConstraints(layer, rect);
          }
          children.push(layer);
        }
      }
    }
    if (["INPUT", "TEXTAREA"].includes(element.tagName) && children.length === 0) {
      const value = element.value || element.getAttribute("placeholder") || "";
      if (value) {
        const fill = solidPaint(style.color);
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

    const flowChildren = children.filter(
      (child) => child.layoutPositioning !== "ABSOLUTE",
    );
    const inferred = flex
      ? null
      : inferLayout(element, style, flowChildren, rect);
    if (inferred && flowChildren.some(child => child.name?.startsWith("Grid row "))) {
      const absolute = children.filter(child => child.layoutPositioning === "ABSOLUTE");
      children.splice(0, children.length, ...flowChildren, ...absolute);
    }
    if (!flex && children.length > 1 && !inferred) {
      warnings.push(
        `${layerName(element, element.tagName.toLowerCase())} has ${children.length} children and cannot become Auto Layout (${display}).`,
      );
    }

    const name = layerName(element, depth === 0 ? "Source" : element.tagName.toLowerCase());
    const inline = display.startsWith("inline") || style.width === "fit-content";
    return {
      type: "FRAME",
      name,
      width: round(rect.width),
      height: round(rect.height),
      x: round(rect.left - parentRect.left),
      y: round(rect.top - parentRect.top),
      layoutMode: inferred?.layoutMode ?? layoutMode,
      primaryAxisSizingMode: inline ? "AUTO" : "FIXED",
      counterAxisSizingMode: inline ? "AUTO" : "FIXED",
      ...childSizing,
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
      } : inferred ?? {}),
      ...frameAppearance(style, warnings, name),
      children,
    };
  }

  async function captureSource(sourceNode) {
    const locators = [...document.querySelectorAll("[data-figma-source-node]")];
    const locator = locators.find(
      (candidate) => candidate.getAttribute("data-figma-source-node") === sourceNode,
    );
    if (!locator) throw new Error(`Could not find source "${sourceNode}".`);
    const selector = locator.getAttribute("data-figma-source-selector")?.trim();
    let root;
    if (selector) {
      let matches;
      try {
        matches = [...document.querySelectorAll(selector)];
      } catch {
        throw new Error(
          `Source "${sourceNode}" has an invalid data-figma-source-selector: ${selector}.`,
        );
      }
      const visibleMatches = matches.filter((candidate) => {
        const style = getComputedStyle(candidate);
        return visible(candidate, style, candidate.getBoundingClientRect());
      });
      if (visibleMatches.length !== 1) {
        throw new Error(
          `Source "${sourceNode}" selector "${selector}" must match exactly one visible element; found ${visibleMatches.length}.`,
        );
      }
      [root] = visibleMatches;
    } else {
      const markers = [
        ...(locator.hasAttribute("data-figma-source-root") ? [locator] : []),
        ...locator.querySelectorAll("[data-figma-source-root]"),
      ];
      if (markers.length > 1) {
        throw new Error(`Source "${sourceNode}" has more than one data-figma-source-root marker.`);
      }
      const marker = markers[0];
      root = marker ?? locator;
      if (marker?.getAttribute("data-figma-source-root") === "child") {
        if (marker.children.length !== 1) {
          throw new Error(
            `Source "${sourceNode}" uses data-figma-source-root="child" but does not contain exactly one element child.`,
          );
        }
        root = marker.firstElementChild;
      }
    }
    const rect = root.getBoundingClientRect();
    const warnings = [];
    let scene = await serialize(root, { left: rect.left, top: rect.top }, warnings);
    if (!scene) throw new Error(`Source "${sourceNode}" is not visible.`);
    if (scene.type !== "FRAME") {
      scene.x = 0;
      scene.y = 0;
      scene = {
        type: "FRAME",
        name: sourceNode,
        width: round(rect.width),
        height: round(rect.height),
        x: 0,
        y: 0,
        layoutMode: "NONE",
        primaryAxisSizingMode: "FIXED",
        counterAxisSizingMode: "FIXED",
        fills: [],
        effects: [],
        children: [scene],
      };
    }
    scene.name = sourceNode;
    scene.x = 0;
    scene.y = 0;
    return { scene, warnings };
  }

  window.PerfectLibraries = { captureSource };
})();
