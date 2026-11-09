# APK-only runtime refreshes

`apk-refresh.txt` is an installed-package inventory with **minimum refresh
targets**, not a complete lockfile. It includes every installed package in the
NS8 x86_64 runtime, including transitive libraries and packages inherited from
Alpine. `apk upgrade` and the existing unpinned `apk add` still select current
packages from the signed fixed-branch Alpine repositories. A build can install
versions newer than these targets. This is not a claim that all CVEs are fixed.

## Ownership and release path

Hosted Renovate owns the inventory through a regex custom manager using its
native `apk` datasource and native `apk` versioning. The registry header is a
real Renovate registry URL, not a URL to download directly: Renovate constructs
`v3.24/{main,community}/x86_64/APKINDEX.tar.gz`. The base image remains owned by
the Dockerfile manager; its native APK extraction is disabled for this file to
avoid a second updater for PHP constraints. There is no scheduled writer,
post-upgrade command, PAT, new secret, or PR created with `GITHUB_TOKEN`.
Renovate App PRs trigger the ordinary CI and release gates.

The inventory is copied **before** the APK installation RUN, so even a package
revision-only diff invalidates that layer. The existing committed `runtime/`
tree-hash helper then produces a new immutable image tag. Neither that helper
nor the publish-once policy is changed. Existing native `bumpVersions` includes
`runtime/**`, so APK PRs also advance `CATALOG_VERSION`; the NS8 catalog-version
and install/update gates remain required. Non-major updates retain guarded
Renovate automerge; package majors remain manual.

Base patches/digests and inventory updates share the `Alpine runtime` group.
Base minor/major upgrades require manual approval and cannot automerge: their
new Alpine branch must be accompanied by an explicit registry/inventory
migration. A stale registry fails validation/build instead of consulting edge
or latest-stable or installing packages from the wrong branch.

## Verification

```sh
python3 .github/scripts/apk-refresh validate
podman build --layers -t localhost/organizr-apk-refresh:test runtime
python3 .github/scripts/apk-refresh probe \
  --image localhost/organizr-apk-refresh:test --base origin/main
APK_TEST_IMAGE=localhost/organizr-apk-refresh:test \
  python3 -m unittest discover -s tests -p 'test_apk*.py' -v
```

The probe uses a disposable writable container, an overridden entrypoint, no
host mounts or inherited image volumes, dropped capabilities and
no-new-privileges. It strictly refreshes package metadata, upgrades, checks every
minimum target with `apk version -t`, rejects missing/new unrecorded packages,
checks PHP >=8.3.36 and compares every actual installed package before/after for
removal/downgrade. `--base` additionally rejects decreases/removals of recorded
targets from that Git ref. An invalid ref is an error, not an empty baseline.
Network/index/install failures are errors, never reported as “no updates”.
Use the same probe with the exact previous published runtime digest to measure
real package-only advancements, independent of any base image update. A
previous image whose package upgrade needs additional capabilities can fail
this restricted probe; do not silently elevate it or call it up to date. The
normal trusted recipe build uses the builder's default capabilities.

`APK runtime contract` runs build/probe/failure tests on pushes and PRs with
read-only repository permission; it does not publish. Existing Renovate policy
tests also execute `apk-renovate.mjs` in the official pinned Renovate image,
covering native RE2 extraction, APK versioning, single ownership, grouping,
no-op updates, release bumps and migration approval. In a disposable **copy**
of the repository inside that image, `APK_NETWORK_TEST=1` additionally looks up
all real package releases. `APK_WRITE_TARGETS=1` writes those actual native
updates to that disposable copy (test/initialization aid, never a scheduled bot).

## Inventory changes and limits

Newly introduced or removed transitive packages deliberately fail the build's
exact **name coverage** check. A maintainer must inspect the changed dependency
closure, regenerate the sorted `name=version` inventory from the actual upgraded
runtime (`/lib/apk/db/installed`, fields `P:` and `V:`), preserve/review the PHP
floor and commit it together with the recipe/base/registry changes. Do not
invent versions, blindly copy a registry's whole package list, or bypass the
coverage check. Existing package-only fixes require no such manual step.

Initial targets were extracted from published runtime
`ghcr.io/platypuschan/organizr-runtime@sha256:f0825123e1b1397921ced4c0767c00db16af104e51b6e0bbea1b067f8cdbab11`,
then advanced by real Renovate 44.222.5 datasource lookups and verified through
an actual upgrade and clean recipe build. Tracking all installed names protects
against silently missing new libraries, but this inventory does not pin
repository snapshots, constrain future solver choices or cover other CPU
architectures. Repository outages or removed packages block CI rather than
providing false security assurance.

References: [APK datasource](https://docs.renovatebot.com/modules/datasource/apk/),
[Dockerfile manager](https://docs.renovatebot.com/modules/manager/dockerfile/),
[regex custom manager](https://docs.renovatebot.com/modules/manager/regex/).
