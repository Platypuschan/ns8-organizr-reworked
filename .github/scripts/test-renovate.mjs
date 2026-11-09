// Run inside the pinned official Renovate image; exercise the actual engine.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GlobalConfig } from '/usr/local/renovate/dist/config/global.js';
import { resolveConfigPresets } from '/usr/local/renovate/dist/config/presets/index.js';
import { applyPackageRules } from '/usr/local/renovate/dist/util/package-rules/index.js';
import { regexEngineStatus } from '/usr/local/renovate/dist/util/regex.js';
import { setPlatformScmApi } from '/usr/local/renovate/dist/modules/platform/scm.js';
import { bumpVersions } from '/usr/local/renovate/dist/workers/repository/update/branch/bump-versions.js';
import { extractPackageFile } from '/usr/local/renovate/dist/modules/manager/custom/regex/index.js';

assert.equal(regexEngineStatus.type, 'available', 'native RE2 must be available');
GlobalConfig.set({ platform: 'local', localDir: process.cwd() });
setPlatformScmApi('local');
const raw = JSON.parse(await readFile('renovate.json', 'utf8'));
const { config } = await resolveConfigPresets(raw);
const rule = (dep) => applyPackageRules({ ...config, ...dep });
const version = (await readFile('CATALOG_VERSION', 'utf8')).trim();
const [major, minor, patch] = version.split('.').map(Number);
// This repository currently publishes stable versions. Fail explicitly if that changes.
assert.ok([major, minor, patch].every(Number.isInteger));
const nextVersion = `${major}.${minor}.${patch + 1}`;

async function checkBump(upgrades, changedFile, artifact = false, expected = true, extra = {}) {
  const branch = {
    ...config, ...extra, upgrades,
    updatedPackageFiles: artifact ? [] : [{ type: 'addition', path: changedFile, contents: 'changed' }],
    updatedArtifacts: artifact ? [{ type: 'addition', path: changedFile, contents: 'changed' }] : [],
  };
  await bumpVersions(branch);
  assert.ok(!branch.artifactErrors?.length, JSON.stringify(branch.artifactErrors));
  const changes = [...branch.updatedPackageFiles, ...branch.updatedArtifacts];
  const bumps = changes.filter((change) => change.path === 'CATALOG_VERSION');
  assert.equal(bumps.length, expected ? 1 : 0, changedFile);
  if (expected) assert.equal(bumps[0].contents.trim(), nextVersion, changedFile);
}

const ui = await rule({ manager: 'npm', packageFile: 'ui/package.json', depName: 'axios', packageName: 'axios', updateType: 'patch' });
assert.equal(ui.groupName, 'UI dependencies');
assert.equal(ui.automerge, true);
await checkBump([ui], 'ui/package.json');
await checkBump([ui], 'ui/yarn.lock', true);

const nodeConsumers = [
  { manager: 'custom.regex', packageFile: 'build-images.sh', packageName: 'docker.io/library/node', datasource: 'docker' },
  { manager: 'dockerfile', packageFile: 'ui/Containerfile', packageName: 'node', datasource: 'docker' },
  { manager: 'github-actions', packageFile: '.github/workflows/validate.yml', packageName: 'actions/node-versions', depType: 'uses-with', datasource: 'github-tags' },
];
const nodes = [];
for (const consumer of nodeConsumers) {
  const node = await rule({ ...consumer, depName: 'node', updateType: 'minor' });
  assert.equal(node.groupName, 'Node.js 24 toolchain');
  assert.equal(node.allowedVersions, '>=24 <25');
  nodes.push(node);
}
// Even when the workflow-only consumer comes first, the grouped image update bumps once.
await checkBump([nodes[2], nodes[0], nodes[1]], 'build-images.sh');

const alpine = await rule({ manager: 'dockerfile', packageFile: 'runtime/Containerfile', depName: 'docker.io/library/alpine', packageName: 'docker.io/library/alpine', datasource: 'docker', updateType: 'digest' });
assert.equal(alpine.pinDigests, true);
assert.equal(alpine.automerge, true);
await checkBump([alpine], 'runtime/Containerfile');

const action = await rule({ manager: 'github-actions', packageFile: '.github/workflows/validate.yml', depName: 'actions/checkout', packageName: 'actions/checkout', depType: 'action', updateType: 'patch' });
assert.equal(action.groupName, 'GitHub Actions');
assert.equal(action.automerge, true);
await checkBump([action], '.github/workflows/validate.yml', false, false);

const migration = await rule({ manager: 'npm', packageFile: 'ui/package.json', depName: 'vue', packageName: 'vue', updateType: 'major' });
assert.equal(migration.dependencyDashboardApproval, true);
assert.notEqual(migration.enabled, false);
assert.notEqual(migration.groupName, 'UI dependencies');
assert.equal(migration.automerge, false);

await checkBump([], 'ui/yarn.lock', true, true, config.lockFileMaintenance);
await checkBump([ui], 'ui/package.json', false, true);
// A no-op proposal must not consume a release version.
const noop = { ...config, upgrades: [ui], updatedPackageFiles: [], updatedArtifacts: [] };
await bumpVersions(noop);
assert.deepEqual(noop.updatedArtifacts, []);

const shellManager = config.customManagers.find((manager) => manager.description === 'Production UI build image in the shell build script');
assert.ok(shellManager, 'production shell-image custom manager must exist');
const extracted = extractPackageFile(await readFile('build-images.sh', 'utf8'), 'build-images.sh', shellManager);
assert.equal(extracted.deps.length, 1);
assert.equal(extracted.deps[0].depName, 'docker.io/library/node');
assert.match(extracted.deps[0].currentValue, /^24\..+-slim$/);
assert.equal(extracted.deps[0].datasource, 'docker');
assert.equal(config.dependencyDashboard, true);
assert.equal(config.vulnerabilityAlerts.minimumReleaseAge, '0 days');
assert.equal(config.automerge, true);
assert.equal(config.platformAutomerge, false);
assert.equal(config.automergeType, 'pr');
assert.equal(config.automergeStrategy, 'squash');
assert.equal(config.vulnerabilityAlerts.automerge, undefined);
await checkBump([nodes[2]], '.github/workflows/validate.yml', false, false);
await import('./apk-renovate.mjs');
const apkTarget = await rule({ manager: 'regex', packageFile: 'runtime/apk-refresh.txt', depName: 'zlib', packageName: 'zlib', datasource: 'apk', updateType: 'minor' });
assert.equal(apkTarget.groupName, 'Alpine runtime');
await checkBump([apkTarget], 'runtime/apk-refresh.txt');
await checkBump([action, apkTarget, alpine], 'runtime/apk-refresh.txt');
console.log('Renovate policy passed: native RE2, shell extraction, Node grouping, major approval, guarded non-major automerge, image/lockfile/group bumps and workflow-only/no-op exclusions.');
