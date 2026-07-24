#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { exportStorybookSources } from "./export-storybook.mjs";

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error(`Expected --name value, received "${name ?? ""}".`);
    }
    values[name.slice(2)] = value;
  }
  for (const required of ["storybook-dir", "config", "release", "out"]) {
    if (!values[required]) throw new Error(`Missing --${required}.`);
  }
  return {
    storybookDir: path.resolve(values["storybook-dir"]),
    configPath: path.resolve(values.config),
    release: values.release,
    outputPath: path.resolve(values.out),
    browserExecutable: values["browser-executable"],
  };
}

const result = await exportStorybookSources(parseArguments(process.argv.slice(2)));
console.log(
  `Exported ${result.variants.length} Storybook variants to ${result.outputPath}.`,
);
