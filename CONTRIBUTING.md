# Contributing

Perfect Libraries welcomes bug reports, manifest examples, documentation
improvements, and focused pull requests.

## Development

Requirements:

- Node.js 22 or newer
- pnpm 10
- Figma Desktop for manual plugin testing

Install and validate:

```bash
pnpm install
pnpm typecheck
pnpm test
```

For a local Figma build, register a development plugin in Figma Desktop and
pass its ID when building:

```bash
FIGMA_PLUGIN_ID=1234567890123456789 pnpm build
```

Import `dist/manifest.json` through **Plugins → Development → Import plugin
from manifest**.

## Pull requests

- Keep the manifest format backward compatible within schema version 1.
- Add focused tests for validation or update behavior changes.
- Keep release discovery GET-only, user-configured, and narrowly scoped to
  trusted hosts in the Figma manifest. Never transmit Figma document content,
  manifests, credentials, or telemetry.
- Do not automatically adopt, delete, or prune user-owned Figma content.
- Run `pnpm typecheck` and `pnpm test` before opening a pull request.
