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
  publishHandoff?: {
    libraryName: string;
    release: string;
  };
}

interface BusyMessage {
  type: "busy";
  busy: boolean;
}

interface ReleaseStateMessage {
  type: "release-state";
  configuredUrl: string;
  loading: boolean;
  error?: string;
  currentRelease?: string;
  release?: {
    libraryId: string;
    libraryName: string;
    release: string;
    status?: "pending" | "published";
    changelog: string;
    publishedAt?: string;
    sourceUrl?: string;
    sourcesUrl?: string;
    pending: boolean;
    manifest: PerfectLibrariesManifest;
  };
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
const feedUrl = requireElement<HTMLInputElement>("feed-url");
const saveFeedButton = requireElement<HTMLButtonElement>("save-feed");
const clearFeedButton = requireElement<HTMLButtonElement>("clear-feed");
const checkFeedButton = requireElement<HTMLButtonElement>("check-feed");
const releasePanel = requireElement<HTMLElement>("release-panel");

let parsedManifest: PerfectLibrariesManifest | undefined;
let inspectedSource = "";
let busy = false;
let discoveredRelease: ReleaseStateMessage["release"];
let loadedReleaseSourcesUrl = "";

saveFeedButton.addEventListener("click", () => {
  parent.postMessage(
    { pluginMessage: { type: "save-feed", url: feedUrl.value } },
    "*",
  );
});

checkFeedButton.addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "check-feed" } }, "*");
});

clearFeedButton.addEventListener("click", () => {
  parent.postMessage({ pluginMessage: { type: "clear-feed" } }, "*");
});

editor.addEventListener("input", () => {
  inspectedSource = "";
  loadedReleaseSourcesUrl = "";
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
  loadedReleaseSourcesUrl = "";
  applyButton.disabled = true;
  renderLocalValidation();
});

inspectButton.addEventListener("click", () => {
  if (busy) return;
  const validation = parseManifestJson(editor.value);
  if (!validation.ok || !validation.manifest) {
    renderValidationErrors(validation.errors, validation.warnings);
    return;
  }
  parsedManifest = validation.manifest;
  inspectedSource = editor.value;
  setBusy(true);
  parent.postMessage(
    {
      pluginMessage: {
        type: "inspect",
        manifest: validation.manifest,
        ...(loadedReleaseSourcesUrl
          ? { sourcesUrl: loadedReleaseSourcesUrl }
          : {}),
      },
    },
    "*",
  );
});

applyButton.addEventListener("click", () => {
  if (busy || !parsedManifest || editor.value !== inspectedSource) return;
  setBusy(true);
  parent.postMessage(
    {
      pluginMessage: {
        type: "apply",
        manifest: parsedManifest,
        ...(loadedReleaseSourcesUrl
          ? { sourcesUrl: loadedReleaseSourcesUrl }
          : {}),
      },
    },
    "*",
  );
});

window.onmessage = (
  event: MessageEvent<{
    pluginMessage?: ReportMessage | BusyMessage | ReleaseStateMessage;
  }>,
) => {
  const message = event.data.pluginMessage;
  if (!message) return;
  if (message.type === "busy") {
    setBusy(message.busy);
    return;
  }
  if (message.type === "release-state") {
    renderReleaseState(message);
    return;
  }
  renderReport(message);
};

renderLocalValidation();
parent.postMessage({ pluginMessage: { type: "initialize" } }, "*");

function renderReleaseState(message: ReleaseStateMessage): void {
  feedUrl.value = message.configuredUrl;
  feedUrl.disabled = message.loading || busy;
  saveFeedButton.disabled = message.loading || busy;
  clearFeedButton.disabled = message.loading || busy || !message.configuredUrl;
  checkFeedButton.disabled = message.loading || busy || !message.configuredUrl;
  discoveredRelease = message.release;

  if (message.loading) {
    releasePanel.className = "release-panel loading";
    releasePanel.innerHTML =
      '<span class="empty">Checking for the latest library release…</span>';
    resize();
    return;
  }
  if (message.error) {
    releasePanel.className = "release-panel error";
    releasePanel.innerHTML = `
      <strong>Couldn’t check this release source</strong>
      <p>${escapeHtml(message.error)}</p>
    `;
    resize();
    return;
  }
  if (!message.release) {
    releasePanel.className = "release-panel";
    releasePanel.innerHTML =
      '<span class="empty">Connect a direct manifest or release-feed URL to check for updates.</span>';
    resize();
    return;
  }

  const value = message.release;
  const stateLabel = value.pending
    ? message.currentRelease
      ? `Update from ${escapeHtml(message.currentRelease)}`
      : "Not applied in this file"
    : "Already applied";
  const publicationLabel =
    value.status === "published"
      ? "Published in Figma"
      : value.status === "pending"
        ? "Awaiting Figma publication"
        : undefined;
  releasePanel.className = `release-panel ${value.pending ? "pending" : "current"}`;
  releasePanel.innerHTML = `
    <div class="release-heading">
      <div>
        <strong>${escapeHtml(value.libraryName)} ${escapeHtml(value.release)}</strong>
        <span>${stateLabel}</span>
        ${publicationLabel ? `<span>${publicationLabel}</span>` : ""}
      </div>
      <span class="release-badge">${value.pending ? "Available" : "Current"}</span>
    </div>
    <p class="changelog">${escapeHtml(value.changelog)}</p>
    <div class="release-actions">
      ${
        value.sourceUrl
          ? `<a href="${escapeAttribute(value.sourceUrl)}" target="_blank" rel="noreferrer">View release notes</a>`
          : "<span></span>"
      }
      <button id="load-release" type="button">${value.pending ? "Load update" : "Load manifest"}</button>
    </div>
  `;
  const loadReleaseButton =
    releasePanel.querySelector<HTMLButtonElement>("#load-release");
  loadReleaseButton?.addEventListener("click", () => {
    loadDiscoveredRelease(loadReleaseButton);
  });
  resize();
}

function loadDiscoveredRelease(button: HTMLButtonElement): void {
  if (!discoveredRelease) return;
  editor.value = JSON.stringify(discoveredRelease.manifest, null, 2);
  loadedReleaseSourcesUrl = discoveredRelease.sourcesUrl ?? "";
  inspectedSource = "";
  applyButton.disabled = true;
  renderLocalValidation();
  button.textContent = "Loaded";
  button.disabled = true;
  editor.scrollIntoView({ behavior: "smooth", block: "center" });
  editor.focus({ preventScroll: true });
}

async function loadFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    renderValidationErrors(["Choose a JSON manifest file."], []);
    return;
  }
  editor.value = await file.text();
  inspectedSource = "";
  loadedReleaseSourcesUrl = "";
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
    ${
      message.publishHandoff
        ? renderPublishHandoff(message.publishHandoff)
        : ""
    }
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

function renderPublishHandoff(value: {
  libraryName: string;
  release: string;
}): string {
  return `
    <div class="publish-handoff">
      <strong>Ready for native publishing</strong>
      <p>${escapeHtml(value.libraryName)} ${escapeHtml(value.release)} is applied. Review the selected assets, then open Figma’s Libraries panel and choose <strong>Publish changes</strong>.</p>
      <p class="fine-print">Figma requires a person with edit access to approve the final library publication.</p>
    </div>
  `;
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
  feedUrl.disabled = value;
  saveFeedButton.disabled = value;
  clearFeedButton.disabled = value || !feedUrl.value.trim();
  checkFeedButton.disabled = value || !feedUrl.value.trim();
  document.body.dataset.busy = value ? "true" : "false";
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
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
