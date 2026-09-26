"""Exercise setup choices and the upstream wizard without an NS8 host."""

import io
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
            self.assertTrue(calls[0][0].endswith("/wizard"))
            self.assertEqual(calls[0][1]["password"], password)
            self.assertEqual(calls[0][1]["dbPath"], "/config/ns8-organizr-db/")
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


if __name__ == "__main__":
    unittest.main()
