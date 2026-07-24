# Perfect Libraries Storybook exporter

This package turns rendered Storybook variants into a deterministic source
bundle that the Perfect Libraries Figma plugin can import directly.

The exporter launches Chromium against a static Storybook build, renders each
configured variant, reads computed layout and typography from the browser, and
serializes editable frames, text, vector, fills, strokes, radii, spacing, and
Flexbox layout. Flexbox containers become nested Figma Auto Layout frames.

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

The export fails when a rendered source is missing, empty, or contains a
multi-child layout that cannot be represented as Auto Layout. This makes layout
drift a release failure rather than a silent Figma regression.
