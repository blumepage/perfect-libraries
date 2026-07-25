# Perfect Libraries Storybook exporter

This package turns rendered Storybook variants into a deterministic source
bundle that the Perfect Libraries Figma plugin can import directly.

The exporter launches Chromium against a static Storybook build, renders each
configured variant, reads computed layout and typography from the browser, and
serializes editable frames, text, vectors, solid and linear-gradient fills,
embedded raster images, multiple shadows, per-side borders, radii, spacing,
and layout. Flexbox containers become nested Figma Auto Layout frames. Normal
block flow and simple CSS Grid become Auto Layout only when the rendered child
geometry provides an unambiguous vertical, horizontal, or wrapping layout.

```sh
perfect-libraries-storybook-export \
  --storybook-dir dist/storybook \
  --config library/catalog.json \
  --release 1.2.3 \
  --out dist/perfect-libraries-sources.json
```

The catalog must contain `library.id`, `components[].storybookId`, and
`components[].variants[]` with `id`, `sourceNode`, and Storybook `preview` args.
The Storybook build must expose `library-import-sources--variant`, as generated
by the Blume adapter.

The story-level locator uses `data-figma-source-node="<sourceNode>"`. Put
`data-figma-source-root` on the descendant that is the actual component root.
When a React component does not forward data attributes, wrap it in an element
with `data-figma-source-root="child"`; its one element child becomes the source
and both locator wrappers are omitted. The locator itself is used as a
backwards-compatible fallback. For a portal-rendered component, set
`data-figma-source-selector` on the locator. Its document-level selector must
match exactly one visible element; missing or ambiguous matches fail the
export.

Inline SVG and SVG data-URI images remain vectors with `currentColor` baked
from the rendered component. PNG, JPEG, and GIF images that the Storybook page
can fetch are embedded and materialized as Figma image fills. Unreadable,
cross-origin, or unsupported image formats fail the export instead of being
silently omitted.

The export fails when a rendered source is missing, empty, or contains a
multi-child layout that cannot be represented as Auto Layout. Unsupported
backgrounds, shadows, and non-editable images are also blocking. This makes
visual drift a release failure rather than a silent Figma regression.
Radial gradients are currently reported as unsupported blocking backgrounds;
they are never silently flattened or dropped.
