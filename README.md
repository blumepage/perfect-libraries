# Perfect Libraries

[Open Perfect Libraries in the Figma Community](https://www.figma.com/community/plugin/1662573031327668831)

Perfect Libraries is a free, open-source Figma plugin for turning imported UI frames
into a maintainable design-system library.

It is deliberately independent of React, Storybook, and any HTML-to-Figma
vendor. Render components however you like, import them as editable Figma
frames, and describe the intended library structure with a portable manifest.
Perfect Libraries then:

- creates and updates variable collections, modes, aliases, scopes, and code
  syntax before touching components;
- promotes imported frames into components without consuming the source frames;
- updates previously managed components in place so existing instances keep
  their main-component references;
- combines variants and lays them out in a readable grid;
- replaces declared nested layers with real component instances;
- binds fills, strokes, text colors, spacing, radii, opacity, and typography to
  variables;
- exposes text, boolean, and instance-swap component properties;
- audits ambiguous sources and missing Auto Layout;
- never adopts, deletes, or prunes user-owned content automatically.

Perfect Libraries runs entirely inside Figma. Its optional release checker sends
GET requests only to a feed URL the user explicitly connects. The Community
build permits the open Perfect Libraries feed service and public files on
`raw.githubusercontent.com`; it never uploads manifests or document content.

## Why the plugin and the HTML converter are separate

HTML importers are good at translating browser geometry into editable layers
and Auto Layout. They cannot reliably infer which repeated subtree is intended
to be a public component, which prop is a variant, or which nested frame should
be an instance of another component.

Perfect Libraries supplies that missing design-system intent. It works with output
from Figma code-to-canvas, copyto.design, CodeRender, html.to.design, or any
other importer that creates editable frames.

## Development setup

Requirements:

- Node.js 22+
- pnpm 10+
- Figma Desktop

Install and build:

```bash
pnpm install
pnpm build
```

The generated manifest uses Perfect Libraries' permanent Figma plugin ID,
`1662573031327668831`. In Figma Desktop, choose **Plugins → Development →
Import plugin from manifest** and select `dist/manifest.json`.

Maintainers testing a separately registered development fork can override the
ID for a build:

```bash
FIGMA_PLUGIN_ID=1234567890123456789 pnpm build
```

Watch during development:

```bash
pnpm dev
```

Re-run the plugin in Figma after each rebuild.

## User workflow

1. Render each component variant to HTML/CSS.
2. Import those variants as editable frames on one Figma page.
3. Give every source frame the exact `sourceNode` name from the manifest.
4. Run Perfect Libraries and either load JSON locally or connect a release feed.
5. If a release is available, review its version and changelog and click
   **Load update**.
6. Click **Inspect sources**.
7. Resolve missing, duplicate, or non-Auto-Layout warnings.
8. Click **Apply to library**.
9. Review the selected generated components.
10. Use Figma's native **Publish changes** flow.

The plugin is idempotent. Re-running a newer release updates entities with the
same stable manifest IDs. It never uses display names as ownership proof.

## Authoring import-friendly HTML

Use HTML structure that communicates layout intent:

- nested `display: flex` containers for rows and columns;
- `gap` and container padding instead of child margins;
- `width: fit-content` for Figma **Hug**;
- `flex: 1`, stretch, or `width: 100%` for Figma **Fill**;
- fixed dimensions only where Figma should use **Fixed**;
- absolute positioning only for genuine overlays;
- readable CSS custom-property names matching Figma code syntax;
- inline SVG and fonts available in the Figma editor.

CSS Grid and visual pixel matching can still produce editable output, but nested
Flexbox is the most reliable source for maintainable Figma Auto Layout.

## Manifest

The schema is
[`schema/perfect-libraries-v1.schema.json`](schema/perfect-libraries-v1.schema.json).
A working manifest is available at
[`examples/basic-library.json`](examples/basic-library.json).

The top-level contract:

```json
{
  "$schema": "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-v1.schema.json",
  "version": 1,
  "library": {
    "id": "dev.example.design-system",
    "name": "Example Design System",
    "release": "1.2.0"
  },
  "tokenCollections": [],
  "components": []
}
```

Stable IDs are the update contract:

- `library.id` separates unrelated design systems in the same file;
- collection, token, component, and variant IDs must never be repurposed;
- renaming an entity while keeping its ID updates it in place;
- changing a variable's type or moving it between collections requires a new ID.

## Release feeds

For a one-click merge-to-review handoff, connect either a direct manifest URL
or a release-feed document. Perfect Libraries stores the URL in Figma's local
plugin storage, checks it when the plugin opens, and shows the latest release,
changelog, and whether that exact release is already applied in the current
file.

The release-feed schema is
[`schema/perfect-libraries-release-feed-v1.schema.json`](schema/perfect-libraries-release-feed-v1.schema.json);
[`examples/release-feed.json`](examples/release-feed.json) is a working example:

```json
{
  "$schema": "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-release-feed-v1.schema.json",
  "version": 1,
  "library": {
    "id": "dev.example.design-system",
    "name": "Example Design System"
  },
  "latest": {
    "release": "1.2.0",
    "status": "pending",
    "changelog": "Added compact buttons and updated focus colors.",
    "manifestUrl": "./perfect-libraries.json",
    "sourceUrl": "https://github.com/example/design-system/releases/tag/ui-v1.2.0"
  }
}
```

`manifestUrl` and `sourceUrl` may be relative to the feed. A feed may instead
embed the manifest as `latest.manifest`, but it must provide exactly one of
`manifest` or `manifestUrl`. The library ID and release in the fetched manifest
must match the feed before Perfect Libraries will offer it.

The public Community build supports feeds served by
`ui-libraries.blume-page.com` and public GitHub raw URLs. Self-hosted
distributions can add their own trusted host to `networkAccess.allowedDomains`
in `manifest.template.json`.

The repository also includes the optional, self-hostable Cloudflare Worker in
[`services/release-service`](services/release-service). It provides authenticated
release ingest, public feeds and immutable manifests, KV-backed publication
state, and Figma `LIBRARY_PUBLISH` webhook handling.

### Source layers

`sourceNode` is an exact layer name on the current page. It must resolve to one
Frame, Component, or Instance:

```json
{
  "id": "button-primary-small",
  "sourceNode": "Button / Primary / Small",
  "properties": {
    "Style": "Primary",
    "Size": "Small"
  }
}
```

Layer paths inside a component use `/`, while `$` means the component root:

```json
{
  "layer": "content/label",
  "property": "text-fill",
  "token": "text-on-action"
}
```

Sibling names along a path must be unique. Ambiguity is reported instead of
guessed.

### Nested components

Create atoms before molecules by declaring dependencies and the layer to replace:

```json
{
  "id": "search-field",
  "name": "Search field",
  "dependencies": ["icon-search"],
  "variants": [
    {
      "id": "search-field-default",
      "sourceNode": "Search field / Default",
      "properties": { "State": "Default" },
      "nestedInstances": [
        {
          "layer": "leading-icon",
          "component": "icon-search"
        }
      ]
    }
  ]
}
```

Perfect Libraries replaces `leading-icon` with an instance while preserving its
place in Auto Layout.

### Component properties

Supported property types are `TEXT`, `BOOLEAN`, and `INSTANCE_SWAP`. Properties
are wired to the named child layer in every variant. Variant axes come from the
variant's `properties` object.

Keep variant matrices below roughly 30 combinations. Prefer instance-swap
properties and building-block components over creating a variant for every icon
or independent sub-element state.

## Merge workflow

A repository can generate the manifest alongside its Storybook build:

```text
merge UI change
→ build Storybook
→ render/export component variants
→ generate perfect-libraries.json
→ update the library's release-feed document
→ maintainer sees “Update available” in Perfect Libraries
→ Load update → Inspect → Apply
→ maintainer reviews selected assets
→ maintainer uses Figma’s native Publish changes flow
```

Figma plugins cannot run in the background, and Figma still requires the final
library publication to be approved in the editor. Perfect Libraries makes that
handoff explicit after a successful apply; it does not claim to publish the
library itself.

## Safety model

- Release checks are explicit GET-only requests to the connected feed and its
  declared manifest URL.
- No Figma document data, manifest content, credentials, or telemetry is
  uploaded.
- Only entities tagged with matching Perfect Libraries ownership metadata are
  updated.
- Untagged name conflicts stop the sync.
- Imported source frames are cloned, not consumed.
- Stale managed variants are reported, not deleted.
- A failed run can be resumed with the same manifest IDs.

Use a duplicated Figma file for early testing, especially with large existing
libraries.

## Commands

```bash
pnpm build
pnpm typecheck
pnpm test
```

## Publishing to Figma Community

See [`COMMUNITY.md`](COMMUNITY.md). The permanent plugin ID is committed;
submitting the listing still requires the Figma account owner.

## License

MIT. See [`LICENSE`](LICENSE).
