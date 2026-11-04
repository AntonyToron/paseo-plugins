// Bundles vendor/text.ts into client/vendor/text.js, with the licenses of what it bundles.
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// Packages whose exports hide package.json: walk up from the entry point to the package's folder.
const packageDir = (name) => {
  let dir = dirname(require.resolve(name));
  while (basename(dir) !== name) dir = dirname(dir);
  return dir;
};

await build({
  entryPoints: ["vendor/text.ts"],
  bundle: true,
  format: "esm",
  // Not "browser": some dependencies' browser builds touch `document` on load, which Paseo's
  // mobile app doesn't have.
  platform: "neutral",
  mainFields: ["module", "main"],
  minify: true,
  target: "es2020",
  outfile: "client/vendor/text.js",
  banner: { js: "/* Bundled from refractor, Prism and diff (jsdiff); licenses in LICENSES.md. */" },
});

const licenses = [
  ["refractor", await readFile(join(packageDir("refractor"), "license"), "utf8")],
  [
    "Prism (grammars, via refractor)",
    "MIT License\n\nCopyright (c) 2012 Lea Verou\n\nSee https://github.com/PrismJS/prism/blob/master/LICENSE",
  ],
  ["diff (jsdiff)", await readFile(join(packageDir("diff"), "LICENSE"), "utf8")],
];
await writeFile(
  "client/vendor/LICENSES.md",
  `# Licenses of the bundled libraries in text.js\n\n${licenses
    .map(([name, text]) => `## ${name}\n\n\`\`\`\n${text.trim()}\n\`\`\``)
    .join("\n\n")}\n`,
);
