import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SOURCES_SCHEMA =
  "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-sources-v1.schema.json";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function safePath(root, url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const candidate = path.resolve(root, `.${pathname}`);
  if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) return null;
  return candidate;
}

async function staticServer(root) {
  const server = createServer(async (request, response) => {
    const candidate = safePath(root, request.url ?? "/");
    if (!candidate) {
      response.writeHead(400).end();
      return;
    }
    try {
      const stat = await fs.stat(candidate);
      const file = stat.isDirectory() ? path.join(candidate, "index.html") : candidate;
      const body = await fs.readFile(file);
      response.writeHead(200, {
        "content-type": contentTypes.get(path.extname(file)) ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start Storybook server.");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function storyUrl(baseUrl, variantId) {
  const url = new URL("iframe.html", baseUrl);
  url.searchParams.set("id", "library-import-sources--variant");
  url.searchParams.set("viewMode", "story");
  url.searchParams.set("args", `variantId:${variantId}`);
  return url.toString();
}

async function captureVariant(browser, baseUrl, captureScript, variant) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(storyUrl(baseUrl, variant.id), {
      waitUntil: "networkidle",
    });
    await page.addScriptTag({ content: captureScript });
    const locator = page.locator(
      `[data-figma-source-node="${variant.sourceNode.replaceAll('"', '\\"')}"]`,
    );
    try {
      await locator.waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      const storyText = await page
        .locator("body")
        .innerText({ timeout: 2_000 })
        .catch(() => "");
      const detail = [
        ...pageErrors,
        storyText.trim().slice(0, 800),
      ].filter(Boolean);
      throw new Error(
        `${variant.sourceNode} did not render in Storybook.${detail.length ? ` ${detail.join(" ")}` : ""}`,
        { cause: error },
      );
    }
    await page.evaluate(() => document.fonts?.ready);
    return await page.evaluate(
      ({ sourceNode }) => window.PerfectLibraries.captureSource(sourceNode),
      { sourceNode: variant.sourceNode },
    );
  } finally {
    await page.close();
  }
}

export async function exportStorybookSources(options) {
  const [configText, captureScript] = await Promise.all([
    fs.readFile(options.configPath, "utf8"),
    fs.readFile(path.join(packageRoot, "src/browser-capture.js"), "utf8"),
  ]);
  const config = JSON.parse(configText);
  const expected = config.components.flatMap((component) =>
    component.variants.map((variant) => ({
      componentId: component.id,
      id: variant.id,
      sourceNode: variant.sourceNode,
    })),
  );
  const server = await staticServer(options.storybookDir);
  const browser = await chromium.launch({
    headless: true,
    ...(options.browserExecutable ? { executablePath: options.browserExecutable } : {}),
  });
  const variants = [];
  try {
    for (const variant of expected) {
      const captured = await captureVariant(
        browser,
        server.url,
        captureScript,
        variant,
      );
      if (!captured?.scene) {
        throw new Error(`Storybook did not produce source "${variant.sourceNode}".`);
      }
      const blocking = captured.warnings.filter((warning) =>
        warning.includes("cannot become Auto Layout") ||
        warning.includes("cannot become an editable Figma source") ||
        warning.includes("unsupported background image") ||
        warning.includes("unsupported box shadow"),
      );
      if (blocking.length) {
        throw new Error(`${variant.sourceNode}: ${blocking.join(" ")}`);
      }
      variants.push({ id: variant.id, sourceNode: variant.sourceNode, ...captured });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const sources = {
    $schema: SOURCES_SCHEMA,
    version: 1,
    library: { id: config.library.id, release: options.release },
    generatedAt: new Date().toISOString(),
    variants,
  };
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, `${JSON.stringify(sources, null, 2)}\n`);
  return { ...sources, outputPath: options.outputPath };
}
