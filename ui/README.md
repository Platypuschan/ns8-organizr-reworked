# NS8 Organizr UI development

The module UI is a Vue 3 single page app (Vue 3.5, Vuex 4, Vue Router 5,
Vue I18n 11, Carbon Vue 3, Carbon 11 design tokens, Vite 8). `@nethserver/ns8-ui-lib` is Vue 2 only, so
the NS8 services and components this module needs live in `src/ns8/` (see
`src/ns8/README.md`).

Tooling needs Node 24 with Corepack (the Containerfile uses
`node:24.22.2-bookworm`). Run a reproducible local build with:

    corepack enable
    yarn install --immutable
    yarn lint
    yarn build

## Dependency metadata and security overrides

`packageExtensions` in `.yarnrc.yml` supplies missing Vue peers along the
Carbon Vue 3 → VueUse 4 core/shared → vue-demi chain. These are metadata fixes:
they forward the application's Vue 3, without adding a second framework copy
or silencing peer diagnostics. Remove them when upstream declares the peers.

ESLint 10.14.0 and `@eslint/config-array` 0.23.5 still request minimatch 10,
which is affected by [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
The two parent-scoped `resolutions` select minimatch 11.0.6 for these lint-only
consumers. They use the retained `Minimatch` constructor and `match` API;
Node 24 satisfies the new matcher engine requirement. Stack tests exercise
brace/extglob/globstar patterns, dotfiles and ignores through ESLint, in
addition to linting the real sources. Remove these overrides once upstream
ranges select a fixed release. No audit finding is excluded.

Carbon 11's deprecation remains accepted: the UI needs its public Sass tokens
while NS8's host stylesheet and Carbon Vue 3 retain `bx--` component markup.

## Tests

Before browser tests, extract the exact stylesheet used by CI without running
NS8 (run from `ui/`; Podman is required):

```sh
core_image=$(python3 -c 'import pathlib,re; print(re.search(r"NS8_CORE_IMAGE: (\S+)", pathlib.Path("../.github/workflows/validate.yml").read_text())[1])')
css_dir=$(mktemp -d)
id=$(podman create --entrypoint /bin/true --image-volume=ignore "$core_image")
podman cp "$id:/var/lib/nethserver/cluster/ui/css/core.css" "$css_dir/core.css"
podman rm "$id"
export NS8_CORE_CSS="$css_dir/core.css"
```

    yarn test:stack     # installed dependency majors, token compilation + Node 24
    yarn test:e2e       # Playwright browser tests against dist/ (run yarn build first)
    yarn test:e2e:dev   # same tests on a development build (shows [Vue warn])

Remove `$css_dir` when done. `NS8_CORE_CSS` is mandatory: Carbon 11 no longer
ships the old compiled Carbon 10 CSS, and using its new component stylesheet
would not represent the NS8 host. Only its public spacing/theme Sass APIs are
consumed; NS8 brand colors remain static and no Carbon 11 component CSS is emitted.

The browser tests (`tests/e2e`) drive the production build in Chromium. The NS8
API is a **fixture**, not a real cluster: `tests/e2e/fixture/host.html` hosts
the module in an iframe and provides `window.core` and the task event bus;
the stylesheet is extracted from the pinned production NS8 core image. All
`/fixture-api` requests are answered by Playwright. Tests verify routes, forms,
task payloads, validation, error and
loading states, EN/DE labels and that Vue/i18n print no warnings. They do not
replace the QEMU/NS8 integration tests.

Install a browser once with `yarn playwright install chromium`, or point
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an existing Chromium.

See the [NS8 module UI developer documentation](https://nethserver.github.io/ns8-core/ui/modules/#module-ui-development) for the development workflow.
