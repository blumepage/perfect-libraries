#!/usr/bin/env node

const token = process.env.FIGMA_ACCESS_TOKEN?.trim();
const fileKey = process.env.FIGMA_LIBRARY_FILE_KEY?.trim();
const endpoint = process.env.FIGMA_WEBHOOK_ENDPOINT?.trim();
const passcode = process.env.FIGMA_WEBHOOK_PASSCODE?.trim();
const description =
  process.env.FIGMA_WEBHOOK_DESCRIPTION?.trim() ||
  "Confirm Perfect Libraries releases";

if (!token || !fileKey || !endpoint || !passcode) {
  throw new Error(
    "Set FIGMA_ACCESS_TOKEN, FIGMA_LIBRARY_FILE_KEY, FIGMA_WEBHOOK_ENDPOINT, and FIGMA_WEBHOOK_PASSCODE.",
  );
}
if (!endpoint.startsWith("https://")) {
  throw new Error("FIGMA_WEBHOOK_ENDPOINT must be an HTTPS URL.");
}

const response = await fetch("https://api.figma.com/v2/webhooks", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    event_type: "LIBRARY_PUBLISH",
    context: "file",
    context_id: fileKey,
    endpoint,
    passcode,
    status: "ACTIVE",
    description,
  }),
});

if (!response.ok) {
  throw new Error(
    `Figma webhook registration failed (${response.status}): ${await response.text()}`,
  );
}
const result = await response.json();
console.log(
  `Registered Figma LIBRARY_PUBLISH webhook ${result.id ?? "(unknown id)"}.`,
);
