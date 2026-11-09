"""Safety contracts for the disposable local NS8 lab (no root needed)."""
import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "tools" / "ns8_lab.py"


class LabContracts(unittest.TestCase):
    def test_existing_directory_must_be_owned_before_vm_mutation(self):
        self.assertTrue(SCRIPT.is_file(), "reproducible lab launcher is missing")
        spec = importlib.util.spec_from_file_location("ns8_lab", SCRIPT)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        import tempfile
        with tempfile.TemporaryDirectory() as raw:
            with self.assertRaisesRegex(RuntimeError, "not owned"):
                mod.require_owned(pathlib.Path(raw))

    def test_guest_ports_bind_only_loopback_without_host_network_mutation(self):
        spec = importlib.util.spec_from_file_location("ns8_lab", SCRIPT)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(hasattr(mod, "vm_command"), "isolated VM command is missing")
        cmd = mod.vm_command(pathlib.Path("/lab"))
        self.assertIn("q35,accel=kvm", cmd)
        network = cmd[cmd.index("-netdev") + 1]
        self.assertIn("user,", network)
        self.assertIn("hostfwd=tcp:127.0.0.1:22291-:22", network)
        self.assertIn("hostfwd=tcp:127.0.0.1:18491-:443", network)
        self.assertNotIn("0.0.0.0", network)
        self.assertNotIn("-daemonize", cmd)

    def test_vm_runs_under_systemd_not_chat_process_lifetime(self):
        spec = importlib.util.spec_from_file_location("ns8_lab", SCRIPT)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(hasattr(mod, "service_command"), "durable VM supervisor is missing")
        command = mod.service_command(pathlib.Path("/lab"))
        self.assertEqual(command[:3], ["sudo", "-n", "systemd-run"])
        self.assertIn("--unit=ns8-organizr-lab", command)
        self.assertIn("--gid=kvm", command)
        self.assertNotIn("runuser", command)
        self.assertIn("q35,accel=kvm", command)

    def test_prepare_refuses_unowned_directory_without_modifying_contents(self):
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as raw:
            state = pathlib.Path(raw)
            sentinel = state / "production-data"
            sentinel.write_text("must survive")
            result = subprocess.run([sys.executable, str(SCRIPT), "prepare", "--state", raw],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("not owned", result.stderr)
            self.assertEqual(sentinel.read_text(), "must survive")
            self.assertEqual(sorted(p.name for p in state.iterdir()), ["production-data"])

    def test_runner_does_not_discover_private_previous_outputs(self):
        source = (SCRIPT.parents[1] / "test-module.sh").read_text()
        self.assertIn("cp tests/*.robot /home/pwuser/suite/", source)
        self.assertIn("    /home/pwuser/suite/\nEOF", source)
        self.assertNotIn("    tests/\nEOF", source)

    def test_prepare_refuses_reset_of_existing_owned_guest(self):
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as raw:
            state = pathlib.Path(raw)
            (state / "OWNER").write_text("ns8-organizr-disposable-lab-v1\n")
            guest = state / "guest.qcow2"
            guest.write_bytes(b"existing guest data")
            result = subprocess.run([sys.executable, str(SCRIPT), "prepare", "--state", raw],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("not resetting", result.stderr)
            self.assertEqual(guest.read_bytes(), b"existing guest data")


if __name__ == "__main__":
    unittest.main()
