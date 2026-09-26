"""Exercise setup choices and the upstream wizard without an NS8 host."""

import io
import importlib.util
import json
import os
import runpy
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
ACTIONS = ROOT / "imageroot" / "actions"


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.previous = os.getcwd()
        os.chdir(self.temp.name)
        self.addCleanup(os.chdir, self.previous)
        self.state = {}
        agent = types.ModuleType("agent")

        def read_envfile(name):
            if name not in self.state:
                raise FileNotFoundError(name)
            return dict(self.state[name])

        agent.read_envfile = read_envfile
        agent.write_envfile = lambda name, values: self.state.__setitem__(name, dict(values)) or Path(name).touch()

        def assert_exp(condition, message):
            if not condition:
                raise ValueError(message)

        agent.assert_exp = assert_exp
        self.bindings = []
        agent.bind_user_domains = lambda domains, check: self.bindings.append((domains, check))
        self.agent_patch = patch.dict(sys.modules, {"agent": agent})
        self.agent_patch.start()
        self.addCleanup(self.agent_patch.stop)

    def action(self, action, script, data=None):
        with patch.object(sys, "stdin", io.StringIO(json.dumps(data or {}))):
            runpy.run_path(str(ACTIONS / action / script), run_name="__main__")

    def test_manual_choice_cannot_later_switch_to_managed(self):
        self.action("create-module", "10initialize_setup")
        self.action("configure-module", "10choose_setup", {"setup_mode": "manual"})
        self.assertEqual(self.state["organizr-setup.env"]["ORGANIZR_SETUP_MODE"], "manual")
        with self.assertRaisesRegex(ValueError, "cannot be changed"):
            self.action("configure-module", "10choose_setup", {"setup_mode": "managed"})

    def test_managed_first_run_and_retries_do_not_replace_credentials(self):
        self.action("create-module", "10initialize_setup")
        self.action("configure-module", "10choose_setup", {"setup_mode": "managed"})
        calls = []

        def fake_run(args, **kwargs):
            if args[:2] == ["podman", "exec"]:
                return subprocess.CompletedProcess(args, 1 if not calls else 0)
            return subprocess.CompletedProcess(args, 0)

        class Response:
            status = 200

            def __init__(self, data):
                self.data = data

            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def read(self, *_):
                return json.dumps(self.data).encode()

        def fake_urlopen(request, timeout):
            if isinstance(request, str):
                return Response({})
            payload = json.loads(request.data)
            calls.append((request.full_url, payload))
            if request.full_url.endswith("/wizard"):
                return Response({"response": {"result": "success", "data": True}})
            return Response({"response": {"result": "success"}})

        with patch.dict(os.environ, {"TCP_PORT": "20230"}), \
                patch("subprocess.run", fake_run), \
                patch("urllib.request.urlopen", fake_urlopen):
            self.action("configure-module", "18managed_setup")
            password = self.state["organizr-recovery.env"]["ORGANIZR_ADMIN_PASSWORD"]
            username = self.state["organizr-recovery.env"]["ORGANIZR_ADMIN_USERNAME"]
            self.assertEqual(username, "ns8-recovery-admin")
            self.assertTrue(calls[0][0].endswith("/wizard"))
            self.assertEqual(calls[0][1]["password"], password)
            self.assertEqual(calls[0][1]["username"], username)
            self.assertEqual(calls[0][1]["dbPath"], "/config/ns8-organizr-db/")
            self.assertEqual(len(calls[0][1]["api"]), 20)
            self.assertEqual(self.state["organizr-api.env"]["ORGANIZR_API_KEY"], calls[0][1]["api"])
            self.assertEqual(self.state["organizr-setup.env"]["ORGANIZR_SETUP_COMPLETE"], "true")
            self.assertEqual(calls[1][1]["password"], password)
            self.assertTrue(calls[1][0].endswith("/login"))
            self.assertEqual(len(calls), 2)
            with self.assertRaises(SystemExit):
                self.action("configure-module", "18managed_setup")
            self.assertEqual(self.state["organizr-recovery.env"]["ORGANIZR_ADMIN_PASSWORD"], password)

    def test_managed_failure_never_marks_setup_complete(self):
        self.action("create-module", "10initialize_setup")
        self.action("configure-module", "10choose_setup", {"setup_mode": "managed"})

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def read(self, *_):
                return b'{"response":{"result":"error","data":false}}'

        with patch.dict(os.environ, {"TCP_PORT": "20230"}), \
                patch("subprocess.run", return_value=subprocess.CompletedProcess([], 1)), \
                patch("urllib.request.urlopen", return_value=Response()):
            with self.assertRaisesRegex(ValueError, "first-run wizard"):
                self.action("configure-module", "18managed_setup")
        self.assertNotIn("ORGANIZR_SETUP_COMPLETE", self.state["organizr-setup.env"])
        self.assertIn("organizr-recovery.env", self.state)

    def test_ad_choice_binds_domain_and_is_preserved_on_host_updates(self):
        self.action("create-module", "10initialize_setup")
        self.action("configure-module", "10choose_setup", {
            "setup_mode": "managed", "ad_enabled": True,
            "ad_domain": "ad.example.test", "ad_user_search_base": "OU=Staff,DC=example,DC=test",
        })
        self.assertEqual(self.bindings[-1], (["ad.example.test"], True))
        self.action("configure-module", "10choose_setup", {"setup_mode": "managed"})
        self.assertEqual(self.state["organizr-ad.env"]["ORGANIZR_AD_DOMAIN"], "ad.example.test")
        self.assertEqual(self.bindings[-1], (["ad.example.test"], True))
        self.action("configure-module", "10choose_setup", {"setup_mode": "managed", "ad_enabled": False})
        self.assertEqual(self.bindings[-1], ([], True))
        self.assertEqual(self.state["organizr-ad.env"]["ORGANIZR_AD_MANAGED"], "true")

    def test_manual_mode_rejects_managed_ad_without_locking_setup(self):
        self.action("create-module", "10initialize_setup")
        with self.assertRaisesRegex(ValueError, "requires managed setup"):
            self.action("configure-module", "10choose_setup", {
                "setup_mode": "manual", "ad_enabled": True, "ad_domain": "ad.example.test",
            })
        self.assertEqual(self.state["organizr-setup.env"]["ORGANIZR_SETUP_MODE"], "pending")


class AdReconcileTests(unittest.TestCase):
    def setUp(self):
        SetupTests.setUp(self)
        module_path = ROOT / "imageroot" / "bin" / "organizr_ad.py"
        spec = importlib.util.spec_from_file_location("organizr_ad_under_test", module_path)
        self.ldap = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.ldap)
        self.state.update({
            "organizr-setup.env": {"ORGANIZR_SETUP_MODE": "managed", "ORGANIZR_SETUP_COMPLETE": "true"},
            "organizr-api.env": {"ORGANIZR_API_KEY": "a" * 20},
            "organizr-ad.env": {
                "ORGANIZR_AD_ENABLED": "true", "ORGANIZR_AD_MANAGED": "true",
                "ORGANIZR_AD_DOMAIN": "ad.example.test", "ORGANIZR_AD_USER_SEARCH_BASE": "",
            },
        })
        proxy = types.ModuleType("agent.ldapproxy")
        proxy.Ldapproxy = lambda: types.SimpleNamespace(get_domain=lambda _: {
            "schema": "ad", "host": "127.0.0.1", "port": 20000,
            "base_dn": "DC=example,DC=test", "bind_dn": "CN=Bind,DC=example,DC=test",
            "bind_password": "private-bind-secret",
        })
        self.proxy_patch = patch.dict(sys.modules, {"agent.ldapproxy": proxy})
        self.proxy_patch.start()
        self.addCleanup(self.proxy_patch.stop)

    def test_ad_login_enabled_only_after_organizr_ldap_test(self):
        requests = []

        def request(_, __, path, *, method="GET", data=None):
            requests.append((path, method, data))
            return {"response": {"result": "success"}}

        with patch.dict(os.environ, {"TCP_PORT": "20230"}), \
                patch.object(self.ldap, "wait_ready"), \
                patch.object(self.ldap, "ensure_recovery_name_free"), \
                patch.object(self.ldap, "request_json", side_effect=request):
            self.ldap.reconcile()
        self.assertEqual([call[0] for call in requests], ["/config", "/config", "/test/ldap", "/config"])
        self.assertEqual(requests[0][2]["authType"], "internal")
        self.assertEqual(requests[1][2]["authBaseDN"], "DC=example,DC=test")
        self.assertEqual(requests[1][2]["ldapBindPassword"], "private-bind-secret")
        self.assertEqual(requests[1][2]["authBackendHost"], "ldap://10.0.2.2:20000")
        self.assertEqual(requests[1][2]["authBackendHostSuffix"], "@ad.example.test")
        self.assertEqual(requests[-1][2], {"authType": "both", "authBackend": "ldap"})

    def test_bind_failure_does_not_enable_ad_and_disable_restores_local_login(self):
        requests = []

        def request(_, __, path, *, method="GET", data=None):
            requests.append((path, data))
            if path == "/test/ldap":
                raise self.ldap.ReconcileError("LDAP test failed")

        with patch.dict(os.environ, {"TCP_PORT": "20230"}), \
                patch.object(self.ldap, "wait_ready"), \
                patch.object(self.ldap, "ensure_recovery_name_free"), \
                patch.object(self.ldap, "request_json", side_effect=request):
            with self.assertRaisesRegex(self.ldap.ReconcileError, "LDAP test failed"):
                self.ldap.reconcile()
            self.assertEqual([c[0] for c in requests], ["/config", "/config", "/test/ldap"])
            self.state["organizr-ad.env"]["ORGANIZR_AD_ENABLED"] = "false"
            requests.clear()
            self.ldap.reconcile()
            self.assertEqual(requests[0][1]["authType"], "internal")
            self.assertEqual(requests[0][1]["authBackend"], "")

    def test_reserved_name_collision_leaves_only_local_login(self):
        requests = []
        with patch.dict(os.environ, {"TCP_PORT": "20230"}), \
                patch.object(self.ldap, "wait_ready"), \
                patch.object(self.ldap, "request_json", side_effect=lambda _, __, path, *, method, data: requests.append(data)), \
                patch.object(self.ldap, "ensure_recovery_name_free", side_effect=self.ldap.ReconcileError("name in AD")):
            with self.assertRaisesRegex(self.ldap.ReconcileError, "name in AD"):
                self.ldap.reconcile()
        self.assertEqual(requests, [{"authType": "internal"}])

    def test_ad_lookup_rejects_reserved_ad_account(self):
        fake = types.ModuleType("ldap3")
        fake.NONE = object()
        fake.SUBTREE = object()
        fake.Server = lambda *args, **kwargs: object()
        fake_utils = types.ModuleType("ldap3.utils")
        fake_conv = types.ModuleType("ldap3.utils.conv")
        fake_conv.escape_filter_chars = lambda value: value
        searches = []

        class Connection:
            def __init__(self, *args, **kwargs):
                self.entries = []
                self.result = {"result": 0}

            def search(self, **kwargs):
                searches.append(kwargs["search_filter"])
                # The UPN can match the recovery login even if the AD account
                # has a different sAMAccountName.
                self.entries = ["CN=different-account,DC=example,DC=test"]

            def unbind(self):
                pass

        fake.Connection = Connection
        with patch.dict(sys.modules, {"ldap3": fake, "ldap3.utils": fake_utils,
                                      "ldap3.utils.conv": fake_conv}):
            with self.assertRaisesRegex(self.ldap.ReconcileError, "already exists in AD"):
                self.ldap.ensure_recovery_name_free(
                    "127.0.0.1", 20000, "DC=example,DC=test",
                    "CN=Bind,DC=example,DC=test", "private-bind-secret", "ad.example.test",
                )
        self.assertIn("(sAMAccountName=ns8-recovery-admin)", searches[0])
        self.assertIn("(userPrincipalName=ns8-recovery-admin@ad.example.test)", searches[0])

    def test_refuses_untrusted_proxy_host(self):
        proxy = sys.modules["agent.ldapproxy"]
        proxy.Ldapproxy = lambda: types.SimpleNamespace(get_domain=lambda _: {
            "schema": "ad", "host": "192.0.2.1", "port": 389,
        })
        with self.assertRaisesRegex(self.ldap.ReconcileError, "loopback"):
            self.ldap.resolve_ad(self.state["organizr-ad.env"])


if __name__ == "__main__":
    unittest.main()
