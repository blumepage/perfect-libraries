import demoManifest from "../examples/basic-library.json";
import {
  parseManifestJson,
  type PerfectLibrariesManifest,
  type ManifestSummary,
} from "./manifest";

interface ReportMessage {
  type: "report";
  ok: boolean;
  title: string;
  errors: string[];
  warnings: string[];
  details: string[];
}

interface BusyMessage {
  type: "busy";
  busy: boolean;
}

const editor = requireElement<HTMLTextAreaElement>("manifest");
const fileInput = requireElement<HTMLInputElement>("file");
const dropzone = requireElement<HTMLLabelElement>("dropzone");
const inspectButton = requireElement<HTMLButtonElement>("inspect");
const applyButton = requireElement<HTMLButtonElement>("apply");
const demoButton = requireElement<HTMLButtonElement>("demo");
const report = requireElement<HTMLElement>("report");
const summary = requireElement<HTMLElement>("summary");
const statusDot = requireElement<HTMLElement>("status-dot");
const statusText = requireElement<HTMLElement>("status-text");

let parsedManifest: PerfectLibrariesManifest | undefined;
let inspectedSource = "";
let busy = false;

editor.addEventListener("input", () => {
  inspectedSource = "";
  applyButton.disabled = true;
  renderLocalValidation();
});

fileInput.addEventListener("change", async () => {
  const [file] = [...(fileInput.files ?? [])];
  if (file) await loadFile(file);
});

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.dataset.dragging = "true";
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    delete dropzone.dataset.dragging;
  });
}

dropzone.addEventListener("drop", async (event) => {
  const [file] = [...(event.dataTransfer?.files ?? [])];
  if (file) await loadFile(file);
});

demoButton.addEventListener("click", () => {
  editor.value = JSON.stringify(demoManifest, null, 2);
  inspectedSource = "";
  applyButton.disabled = true;
  renderLocalValidation();
});

inspectButton.addEventListener("click", () => {
  const validation = parseManifestJson(editor.value);
  if (!validation.ok || !validation.manifest) {
    renderValidationErrors(validation.errors, validation.warnings);
    return;
  }
  parsedManifest = validation.manifest;
  inspectedSource = editor.value;
  parent.postMessage(
    { pluginMessage: { type: "inspect", manifest: validation.manifest } },
    "*",
  );
});

applyButton.addEventListener("click", () => {
  if (!parsedManifest || editor.value !== inspectedSource) return;
  parent.postMessage(
    { pluginMessage: { type: "apply", manifest: parsedManifest } },
    "*",
  );
});

window.onmessage = (event: MessageEvent<{ pluginMessage?: ReportMessage | BusyMessage }>) => {
  const message = event.data.pluginMessage;
  if (!message) return;
  if (message.type === "busy") {
    setBusy(message.busy);
    return;
  }
  renderReport(message);
};

renderLocalValidation();

async function loadFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    renderValidationErrors(["Choose a JSON manifest file."], []);
    return;
  }
  editor.value = await file.text();
  inspectedSource = "";
  applyButton.disabled = true;
  renderLocalValidation();
}

function renderLocalValidation(): void {
  const source = editor.value.trim();
  if (!source) {
    parsedManifest = undefined;
    inspectButton.disabled = true;
    setStatus("neutral", "Waiting for a manifest");
    summary.innerHTML =
      '<span class="empty">Drop a Perfect Libraries manifest or load the example.</span>';
    report.hidden = true;
    resize();
    return;
  }

  const validation = parseManifestJson(source);
  parsedManifest = validation.manifest;
  inspectButton.disabled = !validation.ok;
  if (!validation.ok || !validation.summary) {
    setStatus("error", "Manifest is invalid");
    renderValidationErrors(validation.errors, validation.warnings);
    return;
  }

  setStatus("ready", "Manifest is valid");
  renderSummary(validation.summary);
  if (validation.warnings.length > 0) {
    renderValidationErrors([], validation.warnings);
  } else {
    report.hidden = true;
  }
  resize();
}

function renderSummary(value: ManifestSummary): void {
  summary.innerHTML = `
    <div class="summary-heading">
      <strong>${escapeHtml(value.libraryName)}</strong>
      <span>${escapeHtml(value.release)}</span>
    </div>
    <div class="metrics">
      ${metric(value.collections, "collections")}
      ${metric(value.tokens, "variables")}
      ${metric(value.components, "components")}
      ${metric(value.variants, "variants")}
    </div>
  `;
}

function renderValidationErrors(errors: string[], warnings: string[]): void {
  report.hidden = false;
  report.className = errors.length > 0 ? "report error" : "report warning";
  report.innerHTML = `
    <h3>${errors.length > 0 ? "Manifest needs attention" : "Review suggested"}</h3>
    ${renderList(errors, "error")}
    ${renderList(warnings, "warning")}
  `;
  resize();
}

function renderReport(message: ReportMessage): void {
  report.hidden = false;
  report.className = `report ${message.ok ? "success" : "error"}`;
  report.innerHTML = `
    <h3>${escapeHtml(message.title)}</h3>
    ${renderList(message.errors, "error")}
    ${renderList(message.warnings, "warning")}
    ${renderList(message.details, "detail")}
  `;
  if (message.ok) {
    inspectedSource = editor.value;
    applyButton.disabled = false;
    setStatus("ready", "Source frames are ready");
  } else {
    applyButton.disabled = true;
    setStatus("error", "Resolve the reported issues");
  }
  resize();
}

function renderList(items: string[], kind: string): string {
  if (items.length === 0) return "";
  return `<ul class="${kind}">${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}

function metric(value: number, label: string): string {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function setBusy(value: boolean): void {
  busy = value;
  editor.disabled = value;
  fileInput.disabled = value;
  demoButton.disabled = value;
  inspectButton.disabled = value;
  applyButton.disabled = value || !parsedManifest || editor.value !== inspectedSource;
  document.body.dataset.busy = value ? "true" : "false";
}

function setStatus(state: "neutral" | "ready" | "error", text: string): void {
  statusDot.dataset.state = state;
  statusText.textContent = text;
}

function resize(): void {
  requestAnimationFrame(() => {
    parent.postMessage(
      {
        pluginMessage: {
          type: "resize",
          height: Math.ceil(document.documentElement.scrollHeight),
        },
      },
      "*",
    );
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element as T;
}
