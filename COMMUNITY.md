# Figma Community listing

## Name

Perfect Libraries

## Tagline

Turn imported UI frames into a maintainable component library.

## Short description

Perfect Libraries promotes editable frames from any HTML-to-Figma tool into
token-bound Figma components, variants, nested instances, and component
properties. Updates are repeatable, local-only, and safe by default.

## Full description

Bring your code-backed UI into Figma without locking your design system to one
Storybook or HTML import vendor.

Perfect Libraries consumes a portable JSON manifest and editable frames already on
your current page. It creates variables first, promotes component variants,
links nested components as real instances, binds design tokens, and exposes
text, boolean, and instance-swap properties.

Re-run it after the next code release and Perfect Libraries updates its managed
components in place, preserving existing instance references.

Safety is part of the format:

- no network permission;
- no analytics or uploaded document content;
- no automatic adoption of existing content;
- no automatic pruning or deletion;
- source frames remain untouched.

Works with editable output from Figma code-to-canvas, copyto.design,
CodeRender, html.to.design, and other HTML importers.

## Suggested tags

- Design systems
- Components
- Variables
- Developer tools
- Code to design

## Support and source

Community listing:
`https://www.figma.com/community/plugin/1662573031327668831`

Source repository:
`https://github.com/blumepage/perfect-libraries`

Issues:
`https://github.com/blumepage/perfect-libraries/issues`

License: MIT

## Publication checklist

1. Verify the manifest contains plugin ID `1662573031327668831`.
2. Build and import `dist/manifest.json`.
3. Test with `examples/basic-library.json` in a duplicate design file.
4. Upload `assets/icon.png` and `assets/cover.png`; optionally add screenshots:
   - manifest inspection;
   - variable collections and modes;
   - generated component set with nested instances.
5. Confirm the listing reports **No network access**.
6. Add the support URL and MIT source URL.
7. Submit to Community review.
