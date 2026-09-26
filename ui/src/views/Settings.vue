<!--
  Copyright (C) 2022 Nethesis S.r.l.
  SPDX-License-Identifier: GPL-3.0-or-later
-->
<template>
  <cv-grid fullWidth>
    <cv-row>
      <cv-column class="page-title">
        <h2>{{ $t("settings.title") }}</h2>
      </cv-column>
    </cv-row>
    <cv-row v-if="error.getConfiguration">
      <cv-column>
        <NsInlineNotification
          kind="error"
          :title="$t('action.get-configuration')"
          :description="error.getConfiguration"
          :showCloseButton="false"
        />
      </cv-column>
    </cv-row>
    <cv-row>
      <cv-column>
        <cv-tile light>
          <cv-form @submit.prevent="configureModule">
            <cv-text-input
              :label="$t('settings.organizr_fqdn')"
              placeholder="organizr.example.org"
              v-model.trim="host"
              class="mg-bottom"
              :invalid-message="$t(error.host)"
              :disabled="loading.getConfiguration || loading.configureModule"
              ref="host"
            >
            </cv-text-input>
            <cv-toggle
              value="letsEncrypt"
              :label="$t('settings.lets_encrypt')"
              v-model="isLetsEncryptEnabled"
              :disabled="loading.getConfiguration || loading.configureModule"
              class="mg-bottom"
            >
              <template slot="text-left">{{
                $t("settings.disabled")
              }}</template>
              <template slot="text-right">{{
                $t("settings.enabled")
              }}</template>
            </cv-toggle>
            <cv-toggle
              value="httpToHttps"
              :label="$t('settings.http_to_https')"
              v-model="isHttpToHttpsEnabled"
              :disabled="loading.getConfiguration || loading.configureModule"
              class="mg-bottom"
            >
              <template slot="text-left">{{
                $t("settings.disabled")
              }}</template>
              <template slot="text-right">{{
                $t("settings.enabled")
              }}</template>
            </cv-toggle>
            <div class="setup-settings mg-bottom">
              <h3>{{ $t("settings.setup_title") }}</h3>
              <template v-if="setupModeState === 'pending'">
                <cv-radio-group vertical>
                  <cv-radio-button
                    v-model="setupMode"
                    value="managed"
                    :label="$t('settings.setup_managed')"
                    :disabled="
                      loading.getConfiguration || loading.configureModule
                    "
                    ref="setup_mode"
                  />
                  <p class="setup-help">
                    {{ $t("settings.setup_managed_help") }}
                  </p>
                  <cv-radio-button
                    v-model="setupMode"
                    value="manual"
                    :label="$t('settings.setup_manual')"
                    :disabled="
                      loading.getConfiguration || loading.configureModule
                    "
                  />
                  <p class="setup-help">
                    {{ $t("settings.setup_manual_help") }}
                  </p>
                </cv-radio-group>
                <p v-if="error.setup_mode" class="setup-error">
                  {{ $t(error.setup_mode) }}
                </p>
              </template>
              <p v-else>{{ $t(`settings.setup_${setupMode}`) }}</p>
              <p v-if="setupModeState !== 'pending'" class="setup-help">
                {{ $t("settings.setup_locked") }}
              </p>
              <NsInlineNotification
                v-if="setupMode === 'manual' && setupModeState === 'pending'"
                kind="warning"
                :title="$t('settings.manual_warning_title')"
                :description="$t('settings.manual_warning')"
                :showCloseButton="false"
              />
            </div>
            <div v-if="setupMode === 'managed'" class="setup-settings mg-bottom">
              <h3>{{ $t("settings.ad_title") }}</h3>
              <p class="setup-help">{{ $t("settings.ad_description") }}</p>
              <cv-toggle
                value="adAuthentication"
                :label="$t('settings.ad_enabled')"
                v-model="isAdEnabled"
                :disabled="loading.getConfiguration || loading.configureModule"
                class="mg-bottom"
              >
                <template slot="text-left">{{ $t("settings.disabled") }}</template>
                <template slot="text-right">{{ $t("settings.enabled") }}</template>
              </cv-toggle>
              <template v-if="isAdEnabled">
                <NsInlineNotification
                  v-if="error.listUserDomains"
                  kind="error"
                  :title="$t('action.list-user-domains')"
                  :description="error.listUserDomains"
                  :showCloseButton="false"
                />
                <NsComboBox
                  v-model="adDomain"
                  :options="adDomains"
                  auto-highlight
                  :title="$t('settings.ad_domain')"
                  :label="$t('settings.ad_domain_placeholder')"
                  :invalid-message="$t(error.ad_domain)"
                  :disabled="loading.getConfiguration || loading.configureModule || loading.listUserDomains"
                  class="mg-bottom"
                  ref="ad_domain"
                />
                <cv-text-input
                  :label="$t('settings.ad_user_search_base')"
                  v-model.trim="adUserSearchBase"
                  :invalid-message="$t(error.ad_user_search_base)"
                  :disabled="loading.getConfiguration || loading.configureModule"
                  class="mg-bottom"
                  ref="ad_user_search_base"
                />
                <p class="setup-help">{{ $t("settings.ad_user_search_base_help") }}</p>
                <p class="setup-help">{{ $t("settings.ad_recovery_name_help") }}</p>
              </template>
            </div>
            <cv-accordion
              v-if="setupModeState === 'managed'"
              class="mg-bottom"
              @change="credentialsAccordionChanged"
            >
              <cv-accordion-item>
                <template slot="title">
                  {{ $t("settings.credentials_title") }}
                </template>
                <template slot="content">
                  <p class="setup-help">
                    {{ $t("settings.credentials_help") }}
                  </p>
                  <cv-skeleton-text
                    v-if="loading.getCredentials"
                    :paragraph="true"
                    :line-count="2"
                  />
                  <NsInlineNotification
                    v-else-if="error.getCredentials"
                    kind="error"
                    :title="$t('action.get-setup-credentials')"
                    :description="error.getCredentials"
                    :showCloseButton="false"
                  />
                  <template v-else-if="credentialsLoaded">
                    <label class="bx--label">
                      {{ $t("settings.admin_username") }}
                    </label>
                    <NsCodeSnippet light hideExpandButton>
                      {{ adminUsername }}
                    </NsCodeSnippet>
                    <label class="bx--label">
                      {{ $t("settings.admin_password") }}
                    </label>
                    <NsCodeSnippet light hideExpandButton>
                      {{ adminPassword }}
                    </NsCodeSnippet>
                  </template>
                </template>
              </cv-accordion-item>
            </cv-accordion>
            <cv-row v-if="error.configureModule">
              <cv-column>
                <NsInlineNotification
                  kind="error"
                  :title="$t('action.configure-module')"
                  :description="error.configureModule"
                  :showCloseButton="false"
                />
              </cv-column>
            </cv-row>
            <NsButton
              kind="primary"
              :icon="Save20"
              :loading="loading.configureModule"
              :disabled="loading.getConfiguration || loading.configureModule"
              >{{ $t("settings.save") }}</NsButton
            >
          </cv-form>
        </cv-tile>
      </cv-column>
    </cv-row>
  </cv-grid>
</template>

<script>
import to from "await-to-js";
import { mapState } from "vuex";
import {
  QueryParamService,
  UtilService,
  TaskService,
  IconService,
  PageTitleService,
} from "@nethserver/ns8-ui-lib";

export default {
  name: "Settings",
  mixins: [
    TaskService,
    IconService,
    UtilService,
    QueryParamService,
    PageTitleService,
  ],
  pageTitle() {
    return this.$t("settings.title") + " - " + this.appName;
  },
  data() {
    return {
      q: {
        page: "settings",
      },
      urlCheckInterval: null,
      host: "",
      setupMode: "",
      setupModeState: "pending",
      isAdEnabled: false,
      adDomain: "",
      adDomains: [],
      adUserSearchBase: "",
      adminUsername: "",
      adminPassword: "",
      credentialsLoaded: false,
      credentialsOpen: false,
      isLetsEncryptEnabled: false,
      isHttpToHttpsEnabled: true,
      loading: {
        getConfiguration: false,
        configureModule: false,
        getCredentials: false,
        listUserDomains: false,
      },
      error: {
        getConfiguration: "",
        configureModule: "",
        host: "",
        lets_encrypt: "",
        http2https: "",
        setup_mode: "",
        getCredentials: "",
        listUserDomains: "",
        ad_domain: "",
        ad_user_search_base: "",
      },
    };
  },
  computed: {
    ...mapState(["instanceName", "core", "appName"]),
  },
  created() {
    this.getConfiguration();
    this.listUserDomains();
  },
  beforeRouteEnter(to, from, next) {
    next((vm) => {
      vm.watchQueryData(vm);
      vm.urlCheckInterval = vm.initUrlBindingForApp(vm, vm.q.page);
    });
  },
  beforeRouteLeave(to, from, next) {
    clearInterval(this.urlCheckInterval);
    this.clearCredentials();
    next();
  },
  beforeDestroy() {
    this.clearCredentials();
  },
  methods: {
    async getConfiguration() {
      this.loading.getConfiguration = true;
      this.error.getConfiguration = "";
      const taskAction = "get-configuration";
      const eventId = this.getUuid();

      // register to task error
      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        this.getConfigurationAborted
      );

      // register to task completion
      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        this.getConfigurationCompleted
      );

      const res = await to(
        this.createModuleTaskForApp(this.instanceName, {
          action: taskAction,
          extra: {
            title: this.$t("action." + taskAction),
            isNotificationHidden: true,
            eventId,
          },
        })
      );
      const err = res[0];

      if (err) {
        console.error(`error creating task ${taskAction}`, err);
        this.error.getConfiguration = this.getErrorMessage(err);
        this.loading.getConfiguration = false;
        return;
      }
    },
    getConfigurationAborted(taskResult, taskContext) {
      console.error(`${taskContext.action} aborted`, taskResult);
      this.error.getConfiguration = this.$t("error.generic_error");
      this.loading.getConfiguration = false;
    },
    getConfigurationCompleted(taskContext, taskResult) {
      const config = taskResult.output;
      this.host = config.host;
      this.setupModeState = config.setup_mode;
      this.setupMode = config.setup_mode === "pending" ? "" : config.setup_mode;
      this.isAdEnabled = config.ad_enabled;
      this.adDomain = config.ad_domain;
      this.adUserSearchBase = config.ad_user_search_base;
      this.isLetsEncryptEnabled = config.lets_encrypt;
      this.isHttpToHttpsEnabled = config.http2https;

      this.loading.getConfiguration = false;
      this.focusElement("host");
    },
    validateConfigureModule() {
      this.clearErrors(this);

      let isValidationOk = true;
      if (!this.host) {
        this.error.host = "common.required";

        if (isValidationOk) {
          this.focusElement("host");
        }
        isValidationOk = false;
      }
      if (!this.setupMode) {
        this.error.setup_mode = "common.required";
        if (isValidationOk) {
          this.focusElement("setup_mode");
        }
        isValidationOk = false;
      }
      if (this.setupMode === "managed" && this.isAdEnabled && !this.adDomain) {
        this.error.ad_domain = "common.required";
        if (isValidationOk) {
          this.focusElement("ad_domain");
        }
        isValidationOk = false;
      }
      return isValidationOk;
    },
    configureModuleValidationFailed(validationErrors) {
      this.loading.configureModule = false;
      let focusAlreadySet = false;

      for (const validationError of validationErrors) {
        const param = validationError.parameter;
        // set i18n error message
        this.error[param] = this.$t("settings." + validationError.error);

        if (!focusAlreadySet) {
          this.focusElement(param);
          focusAlreadySet = true;
        }
      }
    },
    async configureModule() {
      const isValidationOk = this.validateConfigureModule();
      if (!isValidationOk) {
        return;
      }

      this.loading.configureModule = true;
      const taskAction = "configure-module";
      const eventId = this.getUuid();

      // register to task error
      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        this.configureModuleAborted
      );

      // register to task validation
      this.core.$root.$once(
        `${taskAction}-validation-failed-${eventId}`,
        this.configureModuleValidationFailed
      );

      // register to task completion
      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        this.configureModuleCompleted
      );
      const res = await to(
        this.createModuleTaskForApp(this.instanceName, {
          action: taskAction,
          data: {
            host: this.host,
            lets_encrypt: this.isLetsEncryptEnabled,
            http2https: this.isHttpToHttpsEnabled,
            setup_mode: this.setupMode,
            ad_enabled: this.setupMode === "managed" && this.isAdEnabled,
            ad_domain: this.adDomain,
            ad_user_search_base: this.adUserSearchBase,
          },
          extra: {
            title: this.$t("settings.instance_configuration", {
              instance: this.instanceName,
            }),
            description: this.$t("settings.configuring"),
            eventId,
          },
        })
      );
      const err = res[0];

      if (err) {
        console.error(`error creating task ${taskAction}`, err);
        this.error.configureModule = this.getErrorMessage(err);
        this.loading.configureModule = false;
        return;
      }
    },
    configureModuleAborted(taskResult, taskContext) {
      console.error(`${taskContext.action} aborted`, taskResult);
      this.error.configureModule = this.$t("error.generic_error");
      this.loading.configureModule = false;
    },
    configureModuleCompleted() {
      this.loading.configureModule = false;

      // reload configuration
      this.getConfiguration();
    },
    async listUserDomains() {
      this.loading.listUserDomains = true;
      this.error.listUserDomains = "";
      const taskAction = "list-user-domains";
      const eventId = this.getUuid();
      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        () => {
          this.error.listUserDomains = this.$t("error.generic_error");
          this.loading.listUserDomains = false;
        }
      );
      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        (taskContext, taskResult) => {
          this.adDomains = taskResult.output.domains
            .filter((domain) => domain.schema === "ad")
            .map((domain) => ({
              name: domain.name,
              label: domain.name,
              value: domain.name,
            }));
          this.loading.listUserDomains = false;
        }
      );
      const [err] = await to(
        this.createClusterTaskForApp({
          action: taskAction,
          extra: {
            title: this.$t("action." + taskAction),
            isNotificationHidden: true,
            eventId,
          },
        })
      );
      if (err) {
        this.error.listUserDomains = this.getErrorMessage(err);
        this.loading.listUserDomains = false;
      }
    },
    credentialsAccordionChanged({ changedIndex, state }) {
      if (changedIndex !== 0) return;
      if (state[0]) {
        this.credentialsOpen = true;
        this.getCredentials();
      } else {
        this.clearCredentials();
      }
    },
    clearCredentials() {
      this.credentialsOpen = false;
      this.credentialsLoaded = false;
      this.adminUsername = "";
      this.adminPassword = "";
      this.error.getCredentials = "";
    },
    async getCredentials() {
      this.loading.getCredentials = true;
      this.error.getCredentials = "";
      const taskAction = "get-setup-credentials";
      const eventId = this.getUuid();
      this.core.$root.$once(
        `${taskAction}-aborted-${eventId}`,
        () => {
          if (this.credentialsOpen) {
            this.error.getCredentials = this.$t("error.generic_error");
          }
          this.loading.getCredentials = false;
        }
      );
      this.core.$root.$once(
        `${taskAction}-completed-${eventId}`,
        (taskContext, taskResult) => {
          if (this.credentialsOpen) {
            this.adminUsername = taskResult.output.username;
            this.adminPassword = taskResult.output.password;
            this.credentialsLoaded = true;
          }
          this.loading.getCredentials = false;
        }
      );
      const [err] = await to(
        this.createModuleTaskForApp(this.instanceName, {
          action: taskAction,
          extra: {
            title: this.$t("action." + taskAction),
            isNotificationHidden: true,
            eventId,
          },
        })
      );
      if (err) {
        if (this.credentialsOpen) {
          this.error.getCredentials = this.getErrorMessage(err);
        }
        this.loading.getCredentials = false;
      }
    },
  },
};
</script>

<style scoped lang="scss">
@import "../styles/carbon-utils";
.mg-bottom {
  margin-bottom: $spacing-06;
}
.setup-help,
.setup-error {
  margin: $spacing-03 0 $spacing-05;
}
.setup-error {
  color: #da1e28;
}
</style>
