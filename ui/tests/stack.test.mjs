// Dependency-stack policy test (node:test, no browser needed).
// Asserts the coordinated Vue 3 migration is installed and Node 24 is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileString } from "sass";
import { createRequire } from "node:module";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);

test("ESLint glob consumers use patched minimatch 11", () => {
  for (const consumer of ["eslint", "@eslint/config-array"]) {
    const fromConsumer = createRequire(require.resolve(consumer));
    assert.equal(major(fromConsumer("minimatch/package.json").version), 11);
  }
});

test("ESLint retains brace/extglob/globstar, dotfile and ignore matching", async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: ["**/generated/**"] },
      {
        files: ["**/*.{js,mjs}", "**/*.@(vue|cjs)"],
        rules: { "no-debugger": "error" },
      },
    ],
  });
  for (const filePath of [
    "src/example.js",
    "src/deep/example.mjs",
    "src/.hidden.js",
    "src/Example.vue",
    "src/deep/example.cjs",
  ]) {
    const [result] = await eslint.lintText("debugger;", { filePath });
    assert.equal(result.messages[0]?.ruleId, "no-debugger", filePath);
  }
  assert.equal(await eslint.isPathIgnored("src/generated/example.js"), true);
  assert.equal(await eslint.isPathIgnored("src/example.css"), true);
});

// Compile the real helper consumed by every view, not a copy of its tokens.
// The NS8 host still owns the bx-- component CSS; importing Carbon 11 design
// tokens must not introduce a second component stylesheet or unresolved vars.
test("Carbon 11 helpers retain NS8 spacing and static brand colors", () => {
  const css = compileString(
    `@use "src/styles/carbon-utils" as *;
     .probe {
       margin: $spacing-05;
       color: $interactive;
       fill: $support-info;
       border-color: $support-success;
       outline-color: $support-error;
     }`,
    {
      loadPaths: [
        fileURLToPath(new URL("..", import.meta.url)),
        fileURLToPath(new URL("../node_modules", import.meta.url)),
      ],
    },
  ).css;
  assert.match(css, /margin: 1rem/);
  assert.match(css, /color: #00a2de/);
  assert.match(css, /fill: #0090de/);
  assert.match(css, /border-color: #24a148/);
  assert.match(css, /outline-color: #da1e28/);
  assert.doesNotMatch(css, /var\(|\.bx--|\.cds--/);
});

const installed = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../node_modules/${name}/package.json`, import.meta.url),
      "utf8",
    ),
  ).version;
const major = (v) => Number(v.split(".")[0]);
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const expectedMajors = {
  "carbon-components": 11,
  vite: 8,
  vue: 3,
  vuex: 4,
  "vue-router": 5,
  "vue-i18n": 11,
  "@carbon/vue": 3,
  "@babel/core": 8,
  "@babel/eslint-parser": 8,
  eslint: 10,
  "eslint-plugin-vue": 10,
  "eslint-plugin-prettier": 5,
  "@vue/eslint-config-prettier": 10,
  prettier: 3,
};

test("runs on Node 24 (Corepack/Yarn 4 toolchain)", () => {
  assert.equal(process.versions.node.split(".")[0], "24");
  assert.match(pkg.packageManager, /^yarn@4\./);
});

test("unused Vue plugins and eval-based animation stay out of the stack", () => {
  const lock = readFileSync(new URL("../yarn.lock", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  for (const name of ["lottie-web", "vue-axios", "vue-debounce"]) {
    assert.doesNotMatch(lock, new RegExp(name));
    assert.doesNotMatch(main, new RegExp(name));
    assert.equal(pkg.dependencies[name], undefined);
  }
});

test("task transport imports axios directly and retains the shared 10s timeout", () => {
  const services = readFileSync(
    new URL("../src/ns8/services.js", import.meta.url),
    "utf8",
  );
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(services, /import axios from "axios"/);
  assert.doesNotMatch(services, /this\.axios/);
  assert.match(main, /axios\.defaults\.timeout = 10000/);
});

for (const [name, wanted] of Object.entries(expectedMajors)) {
  test(`${name} is on major ${wanted}`, () => {
    assert.equal(major(installed(name)), wanted, `${name} ${installed(name)}`);
    const range = pkg.dependencies[name] || pkg.devDependencies[name];
    assert.ok(range, `${name} declared in package.json`);
    assert.ok(range.includes(String(wanted)), `${name} range ${range}`);
  });
}
