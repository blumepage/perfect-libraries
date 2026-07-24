# Security

Perfect Libraries requests limited network access for optional release
discovery. It performs GET requests only to the feed URL explicitly connected
by the user and to the manifest URL declared by that feed. It does not upload
manifests, Figma document content, credentials, or telemetry.

The Community build permits `ui-libraries.blume-page.com` and public files on
`raw.githubusercontent.com`. Development builds additionally permit selected
localhost ports. A self-hosted build must explicitly add its trusted feed host
to the Figma manifest.

Please report security issues privately through GitHub's security advisory
flow for this repository. Do not include sensitive document content in a public
issue.

Supported security fixes target the latest release.
