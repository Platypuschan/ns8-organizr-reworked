// Dependency-stack policy test (node:test, no browser needed).
// Asserts the coordinated Vue 3 migration is installed and Node 24 is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileString } from "sass";

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
  "vue-debounce": 6,
  "@carbon/vue": 3,
  "lottie-web-vue": 3,
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

for (const [name, wanted] of Object.entries(expectedMajors)) {
  test(`${name} is on major ${wanted}`, () => {
    assert.equal(major(installed(name)), wanted, `${name} ${installed(name)}`);
    const range = pkg.dependencies[name] || pkg.devDependencies[name];
    assert.ok(range, `${name} declared in package.json`);
    assert.ok(range.includes(String(wanted)), `${name} range ${range}`);
  });
}
