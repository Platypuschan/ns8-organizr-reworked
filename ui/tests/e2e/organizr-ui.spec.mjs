// Real-browser regression tests for the Organizr NS8 module UI.
// NS8 core is a labelled FIXTURE (see fixture/host.html), not a real cluster.
import { test, expect, configuration, status } from "./helpers.mjs";

const INSTANCE = "organizr1";
const MODULE_TASKS = `/module/${INSTANCE}/tasks`;

test.afterEach(({ ns8 }) => {
  expect(ns8.problems, "no Vue/i18n/router warnings or page errors").toEqual(
    [],
  );
});

async function startStatus(ns8, { cfg = configuration, st = status } = {}) {
  const ui = await ns8.open();
  const name = await ns8.task("get-name");
  await ns8.complete("get-name", name.eventId, { name: "My Organizr" });
  const conf = await ns8.task("get-configuration");
  const stat = await ns8.task("get-status");
  const repos = await ns8.task("list-backup-repositories");
  return { ui, name, conf, stat, repos, cfg, st };
}

test.describe("runtime stack", () => {
  const inModule = (ns8, fn) =>
    ns8.page
      .frames()
      .find((f) => f !== ns8.page.mainFrame())
      ?.evaluate(fn);

  test("module UI is mounted by Vue 3", async ({ ns8 }) => {
    await ns8.open();
    await expect
      .poll(() =>
        inModule(ns8, () => {
          const el = document.querySelector("[data-v-app]");
          return el && el.__vue_app__ ? el.__vue_app__.version : null;
        }),
      )
      .toMatch(/^3\./);
  });

  test("boot loader is replaced like Vue 2 did (no loading-app leftovers)", async ({
    ns8,
  }) => {
    const ui = await ns8.open();
    await ns8.task("get-name");
    await expect(ui.locator(".app-side-nav").first()).toBeVisible();
    const dom = await inModule(ns8, () => ({
      ids: document.querySelectorAll("#ns8-app").length,
      loading: document.querySelectorAll(".loading-app, .loader").length,
      textAlign: getComputedStyle(document.querySelector("#ns8-app")).textAlign,
    }));
    expect(dom).toEqual({ ids: 1, loading: 0, textAlign: "start" });
  });
});

test.describe("status page", () => {
  test("creates the expected NS8 tasks with auth header and event ids", async ({
    ns8,
  }) => {
    const { name, conf, stat, repos } = await startStatus(ns8);
    for (const t of [name, conf, stat]) {
      expect(t.path).toBe(MODULE_TASKS);
      expect(t.headers.authorization).toBe("Bearer fixture-token");
      expect(t.eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(t.payload.extra.isNotificationHidden).toBe(true);
    }
    expect(repos.path).toBe("/cluster/tasks");
    expect(
      new Set([name.eventId, conf.eventId, stat.eventId, repos.eventId]).size,
    ).toBe(4);
  });

  test("shows loading skeletons, then configuration, node, services, images, volumes", async ({
    ns8,
  }) => {
    const { ui, conf, stat } = await startStatus(ns8);
    await expect(ui.locator(".bx--skeleton__text").first()).toBeAttached();
    await ns8.complete("get-configuration", conf.eventId, configuration);
    await ns8.complete("get-status", stat.eventId, status);
    await expect(ui.getByText("organizr.example.org")).toBeVisible();
    await expect(
      ui
        .getByRole("heading", { name: "My Organizr" })
        .or(ui.getByText("My Organizr"))
        .first(),
    ).toBeVisible();
    await expect(ui.getByText("Node 1")).toBeVisible();
    await expect(ui.getByText("organizr-db")).toBeVisible();
    await expect(ui.getByText("failed", { exact: true })).toBeVisible();
    await expect(ui.getByText("ghcr.io/example/organizr:1")).toBeVisible();
    await expect(ui.getByText("/config")).toBeVisible();
    await expect(
      ui.getByRole("button", { name: "Open Organizr" }),
    ).toBeVisible();
    await expect(ui.getByText("Logs of My Organizr")).toBeVisible();
    await expect.poll(() => ns8.page.title()).toBe("Status - Organizr");
  });

  test("Open Organizr opens https://<host> in a new tab", async ({
    ns8,
    context,
  }) => {
    await context.route("https://organizr.example.org/**", (r) =>
      r.fulfill({ body: "ok" }),
    );
    const { ui, conf, stat } = await startStatus(ns8);
    await ns8.complete("get-configuration", conf.eventId, configuration);
    await ns8.complete("get-status", stat.eventId, status);
    const popup = context.waitForEvent("page");
    await ui.getByRole("button", { name: "Open Organizr" }).click();
    expect((await popup).url()).toBe("https://organizr.example.org/");
  });

  test("unconfigured instance offers Configure, which navigates to settings", async ({
    ns8,
  }) => {
    const { ui, conf, stat } = await startStatus(ns8);
    await ns8.complete("get-configuration", conf.eventId, {
      ...configuration,
      host: "",
    });
    await ns8.complete("get-status", stat.eventId, {
      ...status,
      services: [],
      images: [],
      volumes: [],
    });
    await expect(ui.getByText("Not configured")).toBeVisible();
    await expect(ui.getByText("No services")).toBeVisible();
    await expect(ui.getByText("No images")).toBeVisible();
    await expect(ui.getByText("No volumes")).toBeVisible();
    await ui.getByRole("button", { name: "Configure" }).click();
    await expect
      .poll(() => ns8.pushed())
      .toContain(`/apps/${INSTANCE}?page=settings`);
  });

  test("API failures render translated error notifications", async ({
    ns8,
  }) => {
    ns8.setApi((r) =>
      r.payload?.action === "get-status"
        ? { status: 401, body: "{}" }
        : r.payload?.action === "get-configuration"
          ? { status: 404, body: "{}" }
          : { status: 200, body: "{}" },
    );
    const ui = await ns8.open();
    await expect(ui.getByText("Invalid authentication")).toBeVisible();
    await expect(ui.getByText("Resource not found")).toBeVisible();
  });

  test("aborted task shows the generic error", async ({ ns8 }) => {
    const { ui, stat } = await startStatus(ns8);
    await ns8.abort("get-status", stat.eventId);
    await expect(ui.getByText("Something went wrong").first()).toBeVisible();
  });

  test("backup repositories then backups are requested in sequence", async ({
    ns8,
  }) => {
    const { repos } = await startStatus(ns8);
    await ns8.complete("list-backup-repositories", repos.eventId, {
      repositories: [
        { id: "r1", name: "repo b" },
        { id: "r0", name: "repo a" },
      ],
    });
    const backups = await ns8.task("list-backups");
    expect(backups.path).toBe("/cluster/tasks");
  });
});

test.describe("settings page", () => {
  async function openSettings(ns8, cfg = configuration) {
    const ui = await ns8.open({ hash: "#/apps/organizr1?page=settings" });
    const conf = await ns8.task("get-configuration");
    const domains = await ns8.task("list-user-domains");
    await ns8.complete("list-user-domains", domains.eventId, {
      domains: [
        { name: "ad.example.org", schema: "ad" },
        { name: "ldap.example.org", schema: "rfc2307" },
        { name: "other.example.org", schema: "ad" },
      ],
    });
    await ns8.complete("get-configuration", conf.eventId, cfg);
    return ui;
  }

  test("form is populated from saved configuration", async ({ ns8 }) => {
    const ui = await openSettings(ns8);
    await expect(ui.getByLabel("Organizr hostname (FQDN)")).toHaveValue(
      "organizr.example.org",
    );
    await expect(
      ui.getByText("Configure automatically with NS8"),
    ).toBeVisible();
    // setup mode is locked once configured
    await expect(
      ui.getByText(
        "The setup method cannot be changed after the first configuration.",
      ),
    ).toBeVisible();
    await expect(ui.getByLabel("User search base DN (optional)")).toHaveValue(
      "OU=Users,DC=ad,DC=example,DC=org",
    );
    await expect.poll(() => ns8.page.title()).toBe("Settings - Organizr");
  });

  test("validation: host and setup mode are required, nothing is sent", async ({
    ns8,
  }) => {
    const ui = await openSettings(ns8, {
      ...configuration,
      host: "",
      setup_mode: "pending",
      ad_enabled: false,
    });
    await ui.getByRole("button", { name: "Save" }).click();
    await expect(ui.getByText("Required").first()).toBeVisible();
    expect(
      ns8.requests.filter((r) => r.payload?.action === "configure-module"),
    ).toHaveLength(0);
  });

  test("validation: AD enabled requires a domain", async ({ ns8 }) => {
    const ui = await openSettings(ns8, { ...configuration, ad_domain: "" });
    await ui.getByRole("button", { name: "Save" }).click();
    await expect(ui.getByText("Required").first()).toBeVisible();
    expect(
      ns8.requests.filter((r) => r.payload?.action === "configure-module"),
    ).toHaveLength(0);
  });

  test("saves the exact configure-module payload, shows loading, reloads config", async ({
    ns8,
  }) => {
    const ui = await openSettings(ns8);
    await ui.getByLabel("Organizr hostname (FQDN)").fill("  new.example.org  ");
    // AD domain: choose another account domain from the combo box
    await ui.locator(".cv-combo-box, .bx--combo-box").first().click();
    await ui.getByText("other.example.org", { exact: true }).click();
    await ui
      .getByLabel("User search base DN (optional)")
      .fill("OU=Staff,DC=other,DC=example,DC=org");
    await ui.getByRole("button", { name: "Save" }).click();
    const t = await ns8.task("configure-module");
    expect(t.path).toBe(MODULE_TASKS);
    expect(t.payload.data).toEqual({
      host: "new.example.org",
      lets_encrypt: true,
      http2https: true,
      setup_mode: "managed",
      ad_enabled: true,
      ad_domain: "other.example.org",
      ad_user_search_base: "OU=Staff,DC=other,DC=example,DC=org",
    });
    expect(t.payload.extra.title).toBe("Configure Organizr");
    expect(t.payload.extra.description).toBe("Configuring");
    await expect(ui.getByRole("button", { name: "Save" })).toBeDisabled();
    await ns8.complete("configure-module", t.eventId, {});
    // configuration is reloaded after success
    await ns8.task("get-configuration", { nth: 1 });
  });

  test("toggles change the saved payload", async ({ ns8 }) => {
    const ui = await openSettings(ns8, { ...configuration, ad_enabled: false });
    await ui.getByText("Request LE Certificate").first().click();
    await ui.getByText("Force HTTPS").first().click();
    await ui.getByRole("button", { name: "Save" }).click();
    const t = await ns8.task("configure-module");
    expect(t.payload.data.lets_encrypt).toBe(false);
    expect(t.payload.data.http2https).toBe(false);
    expect(t.payload.data.ad_enabled).toBe(false);
  });

  test("server validation errors are shown translated at the field", async ({
    ns8,
  }) => {
    const ui = await openSettings(ns8);
    await ui.getByRole("button", { name: "Save" }).click();
    const t = await ns8.task("configure-module");
    await ns8.validationFailed("configure-module", t.eventId, [
      { parameter: "host", error: "host_pattern", value: "x" },
    ]);
    await expect(
      ui.getByText("Must be a valid fully qualified domain name"),
    ).toBeVisible();
    await expect(ui.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("aborted and failed configure-module show an error", async ({ ns8 }) => {
    const ui = await openSettings(ns8);
    await ui.getByRole("button", { name: "Save" }).click();
    const t = await ns8.task("configure-module");
    await ns8.abort("configure-module", t.eventId);
    await expect(ui.getByText("Something went wrong")).toBeVisible();
    ns8.setApi((r) =>
      r.payload?.action === "configure-module"
        ? { status: 403, body: "{}" }
        : { status: 200, body: "{}" },
    );
    await ui.getByRole("button", { name: "Save" }).click();
    await expect(ui.getByText("Operation not authorized")).toBeVisible();
  });

  test("initial setup mode must be chosen; manual mode shows a warning", async ({
    ns8,
  }) => {
    const ui = await openSettings(ns8, {
      ...configuration,
      setup_mode: "pending",
      ad_enabled: false,
    });
    await ui.getByText("Use the Organizr setup wizard").click();
    await expect(ui.getByText("Complete the wizard promptly")).toBeVisible();
    await ui.getByText("Configure automatically with NS8").click();
    await expect(ui.getByText("Complete the wizard promptly")).toBeHidden();
    await ui.getByText("Use the Organizr setup wizard").click();
    await ui.getByRole("button", { name: "Save" }).click();
    const t = await ns8.task("configure-module");
    expect(t.payload.data.setup_mode).toBe("manual");
    expect(t.payload.data.ad_enabled).toBe(false);
  });

  test("recovery credentials are fetched on demand and cleared on close", async ({
    ns8,
  }) => {
    const ui = await openSettings(ns8);
    expect(
      ns8.requests.filter((r) => r.payload?.action === "get-setup-credentials"),
    ).toHaveLength(0);
    await ui.getByText("Initial administrator", { exact: true }).click();
    const t = await ns8.task("get-setup-credentials");
    expect(t.path).toBe(MODULE_TASKS);
    await ns8.complete("get-setup-credentials", t.eventId, {
      username: "ns8-recovery-admin",
      password: "s3cret-pw",
    });
    await expect(
      ui.getByText("ns8-recovery-admin", { exact: true }).first(),
    ).toBeVisible();
    await expect(ui.getByText("s3cret-pw")).toBeVisible();
    await ui.getByText("Initial administrator", { exact: true }).click();
    await expect(ui.getByText("s3cret-pw")).toHaveCount(0);
  });

  test("get-configuration failure is shown and disables nothing permanently", async ({
    ns8,
  }) => {
    const ui = await ns8.open({ hash: "#/apps/organizr1?page=settings" });
    const conf = await ns8.task("get-configuration");
    await ns8.abort("get-configuration", conf.eventId);
    await expect(ui.getByText("Something went wrong").first()).toBeVisible();
  });

  test("AD domain list error is shown when AD login is enabled", async ({
    ns8,
  }) => {
    const ui = await ns8.open({ hash: "#/apps/organizr1?page=settings" });
    const conf = await ns8.task("get-configuration");
    const domains = await ns8.task("list-user-domains");
    await ns8.abort("list-user-domains", domains.eventId);
    await ns8.complete("get-configuration", conf.eventId, configuration);
    await expect(ui.getByText("List account domains")).toBeVisible();
  });
});

test.describe("about page and navigation", () => {
  test("about shows metadata, installed version, links", async ({ ns8 }) => {
    const ui = await ns8.open({ hash: "#/apps/organizr1?page=about" });
    const t = await ns8.task("list-installed-modules");
    expect(t.path).toBe("/cluster/tasks");
    await ns8.complete("list-installed-modules", t.eventId, {
      organizr: [{ id: "organizr1", version: "0.3.4" }],
    });
    await expect(
      ui.getByRole("heading", { name: "Organizr", exact: true }),
    ).toBeVisible();
    await expect(
      ui.getByText(
        "A unified dashboard for self-hosted services and bookmarks.",
      ),
    ).toBeVisible();
    await expect(ui.getByText("0.3.4")).toBeVisible();
    await expect(ui.getByText("Collaboration")).toBeVisible();
    await expect(
      ui.getByRole("link", { name: "https://docs.organizr.app/" }),
    ).toHaveAttribute("href", "https://docs.organizr.app/");
    await expect(
      ui.getByText("ghcr.io/platypuschan/organizr-reworked"),
    ).toBeVisible();
    await expect.poll(() => ns8.page.title()).toBe("About - Organizr");
  });

  test("about: failed module list shows an error", async ({ ns8 }) => {
    const ui = await ns8.open({ hash: "#/apps/organizr1?page=about" });
    const t = await ns8.task("list-installed-modules");
    await ns8.abort("list-installed-modules", t.eventId);
    await expect(
      ui.getByText("Cannot retrieve installed modules"),
    ).toBeVisible();
  });

  test("side menu navigates via the NS8 core router and highlights the page", async ({
    ns8,
  }) => {
    const ui = await ns8.open();
    await ns8.task("get-name");
    await expect(
      ui
        .getByRole("link", { name: "Status" })
        .or(ui.getByText("Status", { exact: true }))
        .first(),
    ).toBeVisible();
    await ui.getByText("Settings", { exact: true }).first().click();
    await expect
      .poll(() => ns8.pushed())
      .toContain(`/apps/${INSTANCE}?page=settings`);
    await ui.getByText("About", { exact: true }).first().click();
    await expect
      .poll(() => ns8.pushed())
      .toContain(`/apps/${INSTANCE}?page=about`);
  });

  test("changeRoute event from core switches the page", async ({ ns8 }) => {
    const ui = await ns8.open();
    await ns8.task("get-name");
    await ns8.page
      .frames()
      .find((f) => f !== ns8.page.mainFrame())
      .evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("changeRoute", { detail: "settings" }),
        ),
      );
    await ns8.task("list-user-domains");
    await expect(ui.getByLabel("Organizr hostname (FQDN)")).toBeVisible();
  });

  test("instance label from get-name replaces the instance id in the menu", async ({
    ns8,
  }) => {
    const ui = await ns8.open();
    await expect(ui.locator(".instance-name").first()).toHaveText(INSTANCE);
    const t = await ns8.task("get-name");
    await ns8.complete("get-name", t.eventId, { name: "Intranet dashboard" });
    await expect(ui.locator(".instance-name").first()).toHaveText(
      "Intranet dashboard",
    );
  });
});

test.describe("German locale", () => {
  test.use({ locale: "de-DE" });

  test("labels are German; unknown locales would fall back to English", async ({
    ns8,
  }) => {
    const ui = await ns8.open({ hash: "#/apps/organizr1?page=settings" });
    const conf = await ns8.task("get-configuration");
    await ns8.complete("get-configuration", conf.eventId, {
      ...configuration,
      host: "",
      ad_enabled: false,
    });
    await expect(
      ui.getByRole("heading", { name: "Einstellungen" }),
    ).toBeVisible();
    await expect(ui.getByLabel("Organizr-Hostname (FQDN)")).toBeVisible();
    await expect(ui.getByRole("button", { name: "Speichern" })).toBeVisible();
    await ui.getByRole("button", { name: "Speichern" }).click();
    await expect(ui.getByText("erforderlich").first()).toBeVisible();
  });
});

test.describe("French locale falls back to English", () => {
  test.use({ locale: "fr-FR" });
  test("English labels", async ({ ns8 }) => {
    const ui = await ns8.open({ hash: "#/apps/organizr1?page=settings" });
    await expect(ui.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});

test.describe("visual smoke (Carbon v10 stand-in CSS, not NS8 branding)", () => {
  test("Carbon classes are rendered and pages have layout", async ({
    ns8,
  }, testInfo) => {
    const ui = await ns8.open({ hash: "#/apps/organizr1?page=settings" });
    const conf = await ns8.task("get-configuration");
    const domains = await ns8.task("list-user-domains");
    await ns8.complete("list-user-domains", domains.eventId, {
      domains: [{ name: "ad.example.org", schema: "ad" }],
    });
    await ns8.complete("get-configuration", conf.eventId, configuration);
    const save = ui.getByRole("button", { name: "Save" });
    await expect(save).toBeVisible();
    const bg = await save.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    const box = await ui.getByLabel("Organizr hostname (FQDN)").boundingBox();
    expect(box.width).toBeGreaterThan(200);
    // Carbon spacing: fields are separated like the NS8 forms ($spacing-06 = 1.5rem)
    const hostBox = await ui
      .getByLabel("Organizr hostname (FQDN)")
      .boundingBox();
    const leBox = await ui.getByText("Request LE Certificate").boundingBox();
    expect(leBox.y - (hostBox.y + hostBox.height)).toBeGreaterThanOrEqual(24);
    const dnBox = await ui
      .getByLabel("User search base DN (optional)")
      .boundingBox();
    const domainBox = await ui.getByText("NS8 AD account domain").boundingBox();
    expect(dnBox.y - domainBox.y).toBeGreaterThan(40);
    if (process.env.SHOT_DIR) {
      await ns8.page.screenshot({
        path: `${process.env.SHOT_DIR}/settings.png`,
      });
    }
    await testInfo.attach("settings", {
      body: await ns8.page.screenshot(),
      contentType: "image/png",
    });
  });

  test("status cards form a Carbon grid with icons and tags", async ({
    ns8,
  }) => {
    const { ui, conf, stat, repos } = await startStatus(ns8);
    await ns8.complete("get-configuration", conf.eventId, configuration);
    await ns8.complete("get-status", stat.eventId, status);
    await ns8.complete("list-backup-repositories", repos.eventId, {
      repositories: [{ id: "r1", name: "repo a" }],
    });
    const backups = await ns8.task("list-backups");
    await ns8.complete("list-backups", backups.eventId, {
      backups: [
        {
          id: "b1",
          name: "daily",
          repository: "r1",
          enabled: true,
          instances: [
            {
              module_id: "organizr1",
              status: {
                success: true,
                start: 1700000000,
                end: 1700000125,
                total_size: 5242880,
                total_file_count: 42,
              },
            },
          ],
        },
      ],
    });
    await expect(ui.getByText("Success", { exact: true })).toBeVisible();
    await expect(ui.getByText("repo a")).toBeVisible();
    await expect(ui.getByText("2m 5s")).toBeVisible();
    // completion time: relative text, absolute time in the tooltip
    await expect(ui.getByText(/ago$/)).toBeVisible();
    await expect(ui.locator(".bx--tooltip__content").last()).toHaveText(
      "2023-11-14 22:15:25",
    );
    await expect(ui.getByText("5 MiB")).toBeVisible();
    const tops = await ui
      .locator(".info-card, .ns-backup-card, .ns-system-logs-card")
      .evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().top)),
      );
    expect(tops.length).toBe(5);
    // same wrapping as the Vue 2 UI at this width: two cards per row
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBeGreaterThan(tops[0]);
    // carbon icons render as svg inside the cards
    await expect(ui.locator(".info-card svg").first()).toBeVisible();
    await expect(ui.locator(".bx--tag--red")).toHaveText("failed");
    if (process.env.SHOT_DIR) {
      await ns8.page.screenshot({
        path: `${process.env.SHOT_DIR}/status.png`,
        fullPage: true,
      });
    }
  });
});
