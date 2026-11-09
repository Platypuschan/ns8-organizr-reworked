// APK policy tests run in official Renovate 44.222.5 (native RE2/APK).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GlobalConfig } from '/usr/local/renovate/dist/config/global.js';
import { resolveConfigPresets } from '/usr/local/renovate/dist/config/presets/index.js';
import { applyPackageRules } from '/usr/local/renovate/dist/util/package-rules/index.js';
import { extractPackageFile } from '/usr/local/renovate/dist/modules/manager/custom/regex/index.js';
import { extractPackageFile as extractDockerfile } from '/usr/local/renovate/dist/modules/manager/dockerfile/index.js';
import { doAutoReplace } from '/usr/local/renovate/dist/workers/repository/update/branch/auto-replace.js';
const updateDependency = ({ fileContent, upgrade }) => doAutoReplace({ ...manager, ...upgrade, manager: 'regex', packageFile: 'runtime/apk-refresh.txt', depIndex: extracted.deps.findIndex((d) => d.depName === upgrade.depName) }, fileContent, false);
import { ApkDatasource } from '/usr/local/renovate/dist/modules/datasource/apk/index.js';
import { api as apk } from '/usr/local/renovate/dist/modules/versioning/apk/index.js';

GlobalConfig.set({ platform: 'local', localDir: process.cwd(), cacheDir: '/tmp/renovate-apk-tests' });
const { config } = await resolveConfigPresets(JSON.parse(await readFile('renovate.json', 'utf8')));
const manager = config.customManagers.find((m) => m.description === 'Installed runtime APK refresh targets');
assert.ok(manager, 'native APK inventory manager must exist');
const manifest = await readFile('runtime/apk-refresh.txt', 'utf8');
const extracted = extractPackageFile(manifest, 'runtime/apk-refresh.txt', manager);
const inventory = manifest.split('\n').filter((l) => l && !l.startsWith('#'));
assert.equal(extracted.deps.length, inventory.length);
assert.equal(new Set(extracted.deps.map((d) => d.depName)).size, inventory.length);
assert.ok(extracted.deps.some((d) => d.depName === 'libcrypto3'));
const rule = (d) => applyPackageRules({ ...config, ...d });
for (const dep of extracted.deps) {
  assert.equal(dep.datasource, 'apk');
  assert.equal(dep.versioning, 'apk');
  assert.deepEqual(dep.registryUrls, [manifest.split('\n')[0].slice('# registry='.length)]);
  assert.ok(apk.isValid(dep.currentValue), dep.depName);
  const policy = await rule({ ...dep, manager: 'regex', packageFile: 'runtime/apk-refresh.txt', updateType: 'patch' });
  assert.equal(policy.groupName, 'Alpine runtime');
  assert.equal(policy.automerge, true);
  assert.ok(policy.bumpVersions?.length);
}
const docker = await extractDockerfile(await readFile('runtime/Containerfile', 'utf8'), 'runtime/Containerfile', {});
for (const dep of docker.deps.filter((d) => d.datasource === 'apk')) {
  const policy = await rule({ ...dep, manager: 'dockerfile', packageFile: 'runtime/Containerfile' });
  assert.equal(policy.enabled, false, 'the inventory is the sole APK updater');
}
for (const updateType of ['patch', 'digest', 'minor', 'major']) {
  const policy = await rule({ manager: 'dockerfile', packageFile: 'runtime/Containerfile', datasource: 'docker', depName: 'docker.io/library/alpine', updateType });
  assert.equal(policy.groupName, 'Alpine runtime');
  assert.equal(policy.automerge, ['patch', 'digest'].includes(updateType));
  if (['minor', 'major'].includes(updateType)) assert.equal(policy.dependencyDashboardApproval, true);
}
// The real updater is byte-idempotent at the existing target.
const zlib = extracted.deps.find((d) => d.depName === 'zlib');
assert.equal(await updateDependency({ fileContent: manifest, upgrade: { ...zlib, newValue: zlib.currentValue } }), manifest);
if (process.env.APK_NETWORK_TEST === '1') {
  const datasource = new ApkDatasource();
  let changed = 0;
  let updated = manifest;
  for (const dep of extracted.deps) {
    const releases = await datasource.getReleases({ packageName: dep.depName, registryUrl: dep.registryUrls[0] });
    assert.ok(releases?.releases?.length, `missing real releases: ${dep.depName}`);
    const latest = releases.releases.map((r) => r.version).sort(apk.sortVersions).at(-1);
    assert.ok(!apk.isLessThanRange(latest, dep.currentValue), `registry would downgrade ${dep.depName}`);
    if (apk.isGreaterThan(latest, dep.currentValue)) {
      updated = await updateDependency({ fileContent: updated, upgrade: { ...dep, newValue: latest } });
      assert.ok(updated, dep.depName);
      changed++;
      console.log(`APK update ${dep.depName}: ${dep.currentValue} -> ${latest}`);
    }
  }
  console.log(`Real APK datasource: ${extracted.deps.length} lookups, ${changed} advancements`);
  if (process.env.APK_WRITE_TARGETS === '1') {
    const { writeFile } = await import('node:fs/promises');
    await writeFile('runtime/apk-refresh.txt', updated);
  }
}
console.log(`APK policy passed: ${inventory.length} transitive targets; native extraction, rules, single owner, base grouping, no-op updater.`);
