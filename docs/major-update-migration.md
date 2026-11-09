# Coordinated module UI and runtime migration

This candidate advances the module from 0.3.4 to 0.4.0. It implements both the
Vue 3 migration and APK-only refresh detection. It does not migrate the NS8
core itself or install updates on a user's instance.

## Disposition of the fourteen requested major PRs

All fourteen proposals were read with their comments/reviews and compared with
actual npm registry engine/peer metadata, then installed versions were read
back from the candidate's node_modules. The thirteen UI-related PRs must be
integrated together, not merged as unrelated Vue-2-compatible lockfile bumps.

- **#29 Ubuntu runners:** Ubuntu 26.04 for repository-owned pinned jobs. The
  runner image contains Node 24.22.2, Buildah, Skopeo and Podman. The initial
  hosted runner-only candidate passed Validate, Renovate policy, image build
  and four NS8 install/update checks. New APK CI uses the same runner.
- **#33 Vue:** 3.5.45; `createApp` replaces the Vue 2 constructor/plugin API.
- **#37 Babel:** core 8.1.0 and eslint-parser 8.0.7; Node 24.22.2 satisfies
  their engine requirement and the parser supports ESLint 10.
- **#38 Carbon Vue:** 3.0.32. Components/events/model bindings were adapted,
  while the NS8 core's exported Carbon-v10 CSS remains the host stylesheet.
- **#39 Vue Prettier config:** 10.2.0, integrated in ESLint's flat configuration.
- **#40 ESLint:** 10.14.0 with `eslint.config.mjs`, not the removed eslintrc API.
- **#41 eslint-plugin-prettier:** 5.5.7 with Prettier 3 and compatible config.
- **#42 eslint-plugin-vue:** 10.12.0, vue-eslint-parser 10.4.2 and Vue 3 rules.
- **#43 lottie-web-vue:** 3.0.1, registered using its Vue 3 API. There are no
  animation consumers in this module, so no animation playback is claimed.
- **#44 Prettier:** 3.9.10; the source has a one-time consistent reformat.
- **#45 vue-debounce:** 6.0.0; its Vue 3 directive is registered, but no current
  screen consumes it, so there is no application-specific debounce claim.
- **#46 vue-i18n:** 11.4.18 in composition mode; plural translations use `$t`
  with a count. EN, DE and unsupported-locale fallback are exercised.
- **#47 Vue Router:** 5.4.0 with Vue 3.5.45 and Vite 7.3.7; hash history,
  lazy About route, host-driven navigation and route highlighting are tested.
  No Pinia-based feature is used or required by these routes.
- **#48 Vuex:** 4.1.0. The existing host-core object is marked raw: Vue 3 must
  not wrap the parent NS8 core's Vue 2 event bus/router in a reactive proxy.

No requested major has to be retained at its old version in this candidate.
Final remote acceptance and merge status are tracked by the consolidated PR,
not by this source document.

## NS8 compatibility boundary

`@nethserver/ns8-ui-lib` 2.2.1 has a Vue ^2.6.12 peer, compiled Vue-2 render
functions and components extending Carbon Vue 2. A Vue version-only bump cannot
make it mount correctly. The consumed components/services were ported locally
under `ui/src/ns8/`, preserving NS8 task endpoints, authentication, parent-core
events and module data contracts. See its README for scope and provenance.
The unused Vue-2-only date-fns plugin and obsolete crypto shim were removed.
The Vite Vue-2 plugin was replaced with the supported Vue-3 plugin.

The browser suite uses a clearly labelled simulated NS8 core API/event bus.
CI extracts the actual published core stylesheet from the digest-pinned test
image declared in validate.yml, without executing that image. Running the same
suite against development output rejects Vue/i18n/router warnings. This is not
the same as logging into a deployed NS8 core. Real module install/update and
Organizr/AD/backup behaviour remain covered by the separate QEMU acceptance
suite on Rocky 9 and Debian 13.

## Package-only runtime fixes

`runtime/apk-refresh.txt` tracks all 97 currently installed x86_64 packages,
including inherited/transitive libraries, through Renovate's native APK
versioning/datasource. The manifest precedes the installation RUN layer in the
Containerfile; updates change both its cache input and immutable runtime tree
hash. The APK inventory, actual installed targets, PHP floor, registry branch,
architecture, downgrade rejection and fail-closed network paths are checked.
It is a minimum rebuild-target inventory, not an exact dependency solver lock.

At unchanged Alpine 3.24.3 base-image digest, actual probes/builds advanced
alpine-release to 3.24.4-r0, apk-tools/libapk to 3.0.9-r0, libexpat to 2.10.0-r0,
tzdata to 2026f-r0 and zlib to 1.4-r0. PHP stays 8.3.36. New/removed packages
still require a reviewed inventory regeneration; a mismatch blocks the build.
The sole updater is Renovate, with no added credential or competing writer bot.

## Executed local verification

- Baseline characterization/RED evidence preceded implementation in the isolated
  implementation worktrees; the integrated candidate was independently rerun.
- Node 24.22.2 / Corepack / Yarn 4.18.1 immutable install, lint (no lint errors or
  warnings), production build, and 15 coordinated-stack assertions pass.
- Chromium: 60 production and 60 development behavior tests pass with the real
  published NS8 core CSS and simulated host API. Production/development build
  warnings about upstream Lottie eval and externally supplied core.css remain
  warnings, not claimed as clean security scans.
- Official Renovate 44.222.5 strict validation and actual native RE2/rule/updater
  tests pass, including all 97 APK targets, source immutability during updater
  tests, host-CSS digest extraction and native catalog version bumps.
- 45 Python tests pass with real disposable runtime/container/network/cache
  tests enabled. Cache experiments use an isolated fixture namespace so prior
  runs cannot incorrectly satisfy the changed-input branch.
- YAML, shell syntax and whitespace checks pass. Full hosted candidate checks,
  independent review, publication and deployment are separate gates.

Renovate keeps ordinary UI updates grouped and future UI/tooling majors in a
single manually approved migration group. Node stays on the independently
tested 24.x/Corepack toolchain. Neither this migration nor APK detection turns
on automatic updates/restarts of existing NS8 instances.
