// Dependency-stack policy test (node:test, no browser needed).
// Asserts the coordinated Vue 3 migration is installed and Node 24 is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
