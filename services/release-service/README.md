# Perfect Libraries release service

This directory contains a small, self-hostable REST service for connecting
code releases, the Perfect Libraries Figma plugin, and Figma's native library
publishing flow. It runs as a Cloudflare Worker and stores release state and
immutable manifests in Workers KV.

The service is optional. The plugin can still load local files and direct
manifest URLs without it.

## Responsibilities

- accept an authenticated generated manifest after a code release;
- expose a public, cacheable release feed understood by Perfect Libraries;
- serve each versioned manifest from an immutable URL;
- map a canonical Figma file to its library ID;
- accept Figma `PING` and `LIBRARY_PUBLISH` webhooks;
- change the feed from `pending` to `published` after native Figma publication.

It does not edit Figma documents or publish libraries. Perfect Libraries updates
the document, and a Full-seat editor approves publication in Figma.

## API

| Method | Route | Authentication | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Liveness |
| `POST` | `/v1/releases` | Bearer ingest token | Store a release |
| `GET` | `/v1/libraries/:id/releases/latest` | Public | Plugin-compatible feed |
| `GET` | `/v1/libraries/:id/releases/:version/manifest` | Public | Immutable manifest |
| `POST` | `/v1/figma/webhooks` | Figma passcode in body | Publication status |

Public feeds include `latest.status` as `pending` or `published`. The webhook is
idempotent: repeated publication events preserve the first recorded publication
timestamp.

## Release payload

```json
{
  "schemaVersion": 1,
  "library": {
    "id": "org.example.ui",
    "name": "Example UI",
    "figmaFileKey": "Abcdefgh1234"
  },
  "release": {
    "version": "1.2.0",
    "createdAt": "2026-07-24T10:00:00.000Z",
    "changelog": "Added compact buttons.",
    "gitSha": "0123456789abcdef",
    "tag": "ui-v1.2.0",
    "sourceUrl": "https://github.com/example/ui/releases/tag/ui-v1.2.0",
    "links": {
      "storybook": "https://example.com/storybook/"
    }
  },
  "manifest": {
    "$schema": "https://raw.githubusercontent.com/blumepage/perfect-libraries/main/schema/perfect-libraries-v1.schema.json",
    "version": 1,
    "library": {
      "id": "org.example.ui",
      "name": "Example UI",
      "release": "1.2.0"
    },
    "tokenCollections": [],
    "components": []
  }
}
```

The manifest library ID, name, and release must match the envelope. `gitSha`,
`tag`, `sourceUrl`, and `links` are optional and are not GitHub-specific.
All supplied URLs must use HTTPS.

## Self-hosting

Requirements:

- Node.js 22+
- pnpm 10+
- a Cloudflare account with Workers and KV

Install from the repository root:

```sh
pnpm install
```

Create a KV namespace:

```sh
pnpm --filter @perfect-libraries/release-service exec wrangler kv namespace create RELEASES
```

Copy the returned namespace ID into
[`wrangler.jsonc`](wrangler.jsonc), replacing the all-zero placeholder. Change
the Worker name, route, and observability settings as appropriate. The included
config deploys to `workers.dev`; custom-domain deployments should add a
`routes` entry and set `workers_dev` to `false`.

Set secrets:

```sh
pnpm --filter @perfect-libraries/release-service exec wrangler secret put RELEASE_INGEST_TOKEN
pnpm --filter @perfect-libraries/release-service exec wrangler secret put FIGMA_WEBHOOK_PASSCODE
```

Optionally set `ALLOWED_LIBRARY_IDS` in Wrangler `vars` to a comma-separated
allowlist. When omitted, any valid library ID can be ingested by someone holding
the ingest token.

Deploy:

```sh
pnpm --filter @perfect-libraries/release-service deploy
```

The Community plugin can only connect to domains listed in its Figma manifest.
The hosted service and public GitHub raw files are already allowed. A
self-hosted plugin build must add its service domain to
`manifest.template.json`.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, replace both secrets, and run:

```sh
pnpm --filter @perfect-libraries/release-service dev
```

The default development endpoint is `http://localhost:8787`, which is included
in the plugin development manifest.

Validation:

```sh
pnpm --filter @perfect-libraries/release-service types
pnpm --filter @perfect-libraries/release-service test
pnpm --filter @perfect-libraries/release-service typecheck
pnpm --filter @perfect-libraries/release-service build
```

## Register the Figma webhook

The Figma token needs the `webhooks:write` scope and its user needs edit access
to the library file.

```sh
FIGMA_ACCESS_TOKEN=... \
FIGMA_LIBRARY_FILE_KEY=... \
FIGMA_WEBHOOK_ENDPOINT=https://releases.example.com/v1/figma/webhooks \
FIGMA_WEBHOOK_PASSCODE=... \
node services/release-service/scripts/register-figma-webhook.mjs
```

Use the same passcode for the Worker secret and webhook registration.

## Blume deployment

[`deployments/blume/wrangler.jsonc`](deployments/blume/wrangler.jsonc) is the
production override for `ui-libraries.blume-page.com`. It uses the provisioned
`RELEASES` KV namespace and restricts ingest to `page.blume.ui`; these values
live only in the deployment adapter, not in the generic service core.

After authenticating Wrangler:

```sh
pnpm --filter @perfect-libraries/release-service exec wrangler secret put \
  RELEASE_INGEST_TOKEN --config deployments/blume/wrangler.jsonc
pnpm --filter @perfect-libraries/release-service exec wrangler secret put \
  FIGMA_WEBHOOK_PASSCODE --config deployments/blume/wrangler.jsonc
pnpm --filter @perfect-libraries/release-service deploy:blume
```
