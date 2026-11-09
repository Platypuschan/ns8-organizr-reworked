// FIXTURE helpers: simulate the NS8 core API/event bus around the real built UI.
// This is NOT a real NS8 cluster; it only checks the module UI's own contract:
//   POST <apiUrl>/module/<id>/tasks | <apiUrl>/cluster/tasks  -> task created
//   core.$root events "<action>-(completed|aborted|validation-failed)-<eventId>"
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const carbonCss = readFileSync(
  fileURLToPath(
    new URL(
      "../../node_modules/carbon-components/css/carbon-components.min.css",
      import.meta.url,
    ),
  ),
  "utf8",
);
const hostHtml = readFileSync(
  fileURLToPath(new URL("./fixture/host.html", import.meta.url)),
  "utf8",
);

export const test = base.extend({
  // a fresh fixture "core" page per test with request recording
  ns8: async ({ page }, use) => {
    const requests = [];
    const problems = [];
    let apiBehaviour = () => ({ status: 200, body: "{}" });
    page.on("console", (m) => {
      const t = m.text();
      if (/\[Vue warn\]|\[intlify\]|\[vue-router warn\]/.test(t))
        problems.push(t);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await page.route("**/__fixture__/host.html", (r) =>
      r.fulfill({ status: 200, contentType: "text/html", body: hostHtml }),
    );
    // FIXTURE: the NS8 core serves the Carbon v10 stylesheet at this URL; the
    // stand-in serves plain carbon-components CSS (without NS8 branding).
    await page.route("**/cluster-admin/css/core.css", (r) =>
      r.fulfill({
        status: 200,
        contentType: "text/css",
        body:
          carbonCss +
          // FIXTURE approximation of the core layout: content sits right of
          // the fixed 16rem side navigation (the real core.css does this)
          "\n.app-content{margin-left:16rem !important;padding-top:1rem}\n",
      }),
    );
    await page.route("**/fixture-api/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      let payload = null;
      try {
        payload = JSON.parse(req.postData() || "null");
      } catch {
        /* none */
      }
      const rec = {
        method: req.method(),
        path: url.pathname.replace("/fixture-api", ""),
        payload,
        headers: req.headers(),
      };
      requests.push(rec);
      const res = apiBehaviour(rec);
      await route.fulfill({
        status: res.status,
        contentType: "application/json",
        body: res.body,
      });
    });

    const ns8 = {
      page,
      requests,
      problems,
      setApi(fn) {
        apiBehaviour = fn;
      },
      async open({ hash = "#/apps/organizr1", seed = {} } = {}) {
        await page.addInitScript((s) => {
          if (location.pathname.endsWith("host.html")) {
            localStorage.setItem(
              "loginInfo",
              JSON.stringify({ token: "fixture-token" }),
            );
          }
          window.__seed = s;
        }, seed);
        await page.goto(`/__fixture__/host.html${hash}`);
        return page.frameLocator("#module");
      },
      /** wait for the UI to create a task and return {path,payload,eventId} */
      async task(action, { nth = 0, timeout = 10000 } = {}) {
        let found;
        await expect
          .poll(
            () => {
              found = requests.filter(
                (r) =>
                  r.method === "POST" &&
                  r.payload &&
                  r.payload.action === action,
              )[nth];
              return !!found;
            },
            { timeout, message: `task ${action} requested` },
          )
          .toBe(true);
        return { ...found, eventId: found.payload.extra.eventId };
      },
      /** reply as the NS8 core would, over the task event bus */
      async complete(action, eventId, output, context = {}) {
        await page.evaluate(
          ([a, id, o, c]) =>
            window.__fixtureEmit(
              `${a}-completed-${id}`,
              { action: a, ...c },
              { output: o },
            ),
          [action, eventId, output, context],
        );
      },
      async abort(action, eventId) {
        await page.evaluate(
          ([a, id]) =>
            window.__fixtureEmit(
              `${a}-aborted-${id}`,
              { error: "boom" },
              { action: a },
            ),
          [action, eventId],
        );
      },
      async validationFailed(action, eventId, errors) {
        await page.evaluate(
          ([a, id, e]) =>
            window.__fixtureEmit(`${a}-validation-failed-${id}`, e, {
              action: a,
            }),
          [action, eventId, errors],
        );
      },
      pushed: () => page.evaluate(() => window.__fixture.pushed),
    };
    await use(ns8);
  },
});
export { expect };

export const configuration = {
  host: "organizr.example.org",
  lets_encrypt: true,
  http2https: true,
  setup_mode: "managed",
  ad_enabled: true,
  ad_domain: "ad.example.org",
  ad_user_search_base: "OU=Users,DC=ad,DC=example,DC=org",
};

export const status = {
  instance: "organizr1",
  node: "1",
  node_ui_name: "",
  services: [
    { name: "organizr", active: true, failed: false, enabled: true },
    { name: "organizr-db", active: false, failed: true, enabled: false },
  ],
  images: [
    {
      name: "ghcr.io/example/organizr:1",
      size: "120 MB",
      created: "2026-01-01",
    },
  ],
  volumes: [{ name: "organizr-data", mount: "/config", created: "2026-01-02" }],
};
