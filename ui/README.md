# NS8 Organizr UI development

The module UI is a Vue 3 single page app (Vue 3.5, Vuex 4, Vue Router 5,
Vue I18n 11, Carbon Vue 3, Vite 7). `@nethserver/ns8-ui-lib` is Vue 2 only, so
the NS8 services and components this module needs live in `src/ns8/` (see
`src/ns8/README.md`).

Tooling needs Node 24 with Corepack (the Containerfile uses
`node:24.22.2-bookworm`). Run a reproducible local build with:

    corepack enable
    yarn install --immutable
    yarn lint
    yarn build

## Tests

    yarn test:stack     # installed dependency majors + Node 24 (node:test)
    yarn test:e2e       # Playwright browser tests against dist/ (run yarn build first)
    yarn test:e2e:dev   # same tests on a development build (shows [Vue warn])

The browser tests (`tests/e2e`) drive the production build in Chromium. The NS8
core is a **fixture**, not a real cluster: `tests/e2e/fixture/host.html` hosts
the module in an iframe and provides `window.core`, the task event bus and a
stand-in Carbon stylesheet; all `/fixture-api` requests are answered by
Playwright. They verify routes, forms, task payloads, validation, error and
loading states, EN/DE labels and that Vue/i18n print no warnings. They do not
replace the QEMU/NS8 integration tests.

Install a browser once with `yarn playwright install chromium`, or point
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an existing Chromium.

See the [NS8 module UI developer documentation](https://nethserver.github.io/ns8-core/ui/modules/#module-ui-development) for the development workflow.
