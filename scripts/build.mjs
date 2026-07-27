import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { context, build } from "esbuild";

const watch = process.argv.includes("--watch");
const development = process.argv.includes("--dev");
const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const pluginBuild =
  process.env.PERFECT_LIBRARIES_BUILD?.trim() ||
  execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
  }).trim();
const pluginDefine = {
  __PLUGIN_BUILD__: JSON.stringify(pluginBuild),
  __PLUGIN_DEVELOPMENT__: JSON.stringify(development),
};

await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
};

const pluginOptions = {
  ...common,
  define: pluginDefine,
  entryPoints: [new URL("src/code.ts", root).pathname],
  outfile: new URL("code.js", dist).pathname,
  format: "iife",
  platform: "browser",
};

const manifestOptions = {
  ...common,
  entryPoints: [new URL("src/manifest.ts", root).pathname],
  outfile: new URL("manifest.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const releaseFeedOptions = {
  ...common,
  entryPoints: [new URL("src/release-feed.ts", root).pathname],
  outfile: new URL("release-feed.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const sourcesOptions = {
  ...common,
  entryPoints: [new URL("src/sources.ts", root).pathname],
  outfile: new URL("sources.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const sourceContractOptions = {
  ...common,
  entryPoints: [new URL("src/source-contract.ts", root).pathname],
  outfile: new URL("source-contract.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const serialOperationQueueOptions = {
  ...common,
  entryPoints: [new URL("src/serial-operation-queue.ts", root).pathname],
  outfile: new URL("serial-operation-queue.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const sourceTextOptions = {
  ...common,
  entryPoints: [new URL("src/source-text.ts", root).pathname],
  outfile: new URL("source-text.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const sourceAuditOptions = {
  ...common,
  entryPoints: [new URL("src/source-audit.ts", root).pathname],
  outfile: new URL("source-audit.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const sourceResolutionOptions = {
  ...common,
  entryPoints: [new URL("src/source-resolution.ts", root).pathname],
  outfile: new URL("source-resolution.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const semanticSyncPlanOptions = {
  ...common,
  entryPoints: [new URL("src/semantic-sync-plan.ts", root).pathname],
  outfile: new URL("semantic-sync-plan.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

const documentationPlanOptions = {
  ...common,
  entryPoints: [new URL("src/documentation-plan.ts", root).pathname],
  outfile: new URL("documentation-plan.mjs", dist).pathname,
  format: "esm",
  platform: "node",
};

async function buildUi() {
  const result = await build({
    ...common,
    define: pluginDefine,
    entryPoints: [new URL("src/ui.ts", root).pathname],
    format: "iife",
    platform: "browser",
    write: false,
  });
  const script = result.outputFiles[0].text.replaceAll("</script>", "<\\/script>");
  const template = await readFile(new URL("src/ui.html", root), "utf8");
  await writeFile(
    new URL("ui.html", dist),
    template.replace("/*__PERFECT_LIBRARIES_UI__*/", script),
  );
}

async function buildManifest() {
  const template = JSON.parse(
    await readFile(new URL("manifest.template.json", root), "utf8"),
  );
  const pluginId = process.env.FIGMA_PLUGIN_ID?.trim();
  const manifest = {
    ...template,
    ...(pluginId ? { id: pluginId } : {}),
    ...(development ? { name: `${template.name} (Development)` } : {}),
  };
  await writeFile(
    new URL("manifest.json", dist),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

if (watch) {
  const pluginContext = await context(pluginOptions);
  const manifestContext = await context(manifestOptions);
  const releaseFeedContext = await context(releaseFeedOptions);
  const sourcesContext = await context(sourcesOptions);
  const sourceContractContext = await context(sourceContractOptions);
  await Promise.all([
    pluginContext.watch(),
    manifestContext.watch(),
    releaseFeedContext.watch(),
    sourcesContext.watch(),
    sourceContractContext.watch(),
    (await context(sourceResolutionOptions)).watch(),
  ]);
  await Promise.all([buildUi(), buildManifest()]);
  console.log("Perfect Libraries is watching. Re-run the plugin in Figma after changes.");
} else {
  await Promise.all([
    build(pluginOptions),
    build(manifestOptions),
    build(releaseFeedOptions),
    build(sourcesOptions),
    build(sourceContractOptions),
    build(serialOperationQueueOptions),
    build(sourceTextOptions),
    build(sourceAuditOptions),
    build(sourceResolutionOptions),
    build(semanticSyncPlanOptions),
    build(documentationPlanOptions),
    buildUi(),
    buildManifest(),
  ]);
}
