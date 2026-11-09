"""Opt-in disposable-image integration tests: APK_TEST_IMAGE=localhost/... ."""
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest
import test_apk_refresh as contract
ROOT = contract.ROOT


@unittest.skipUnless(os.environ.get('APK_TEST_IMAGE'), 'set APK_TEST_IMAGE for real container/network tests')
class RuntimeProbe(unittest.TestCase):
    def setUp(self):
        self.m = contract.RefreshContract().load()
        self.image = os.environ['APK_TEST_IMAGE']

    def test_unchanged_candidate_has_no_updates(self):
        result = self.m.probe(self.image)
        self.assertEqual(result['changed'], {})
        self.assertEqual(result['installed'], len(self.m.validate(ROOT)[0]))

    def test_network_failure_is_not_no_updates(self):
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.m.probe(self.image, network='none')
        self.assertNotIn('AFTER\n', caught.exception.stdout)

    def test_package_only_diff_invalidates_real_apk_layer_cache(self):
        with tempfile.TemporaryDirectory() as td:
            runtime = Path(td) / 'runtime'
            shutil.copytree(ROOT / 'runtime', runtime)
            def build():
                result = subprocess.run(['podman', 'build', '--layers', '-t', 'localhost/organizr-apk-cache:test', str(runtime)], check=True, text=True, capture_output=True, timeout=300)
                return result.stdout + result.stderr
            build()
            unchanged = build()
            self.assertNotIn('+ apk update\n', unchanged, 'unchanged recipe should reuse the APK layer')
            manifest = runtime / 'apk-refresh.txt'
            packages, _ = self.m.validate(ROOT)
            # Lower only this disposable fixture's minimum, not the committed target.
            manifest.write_text(manifest.read_text().replace('zlib=' + packages['zlib'], 'zlib=1.0-r0'))
            changed = build()
            self.assertIn('+ apk update\n', changed, 'package-only COPY input must invalidate the APK RUN cache')
            self.assertIn('APK targets verified', changed)

    def test_runtime_rejects_invalid_version_metadata(self):
        packages, _ = self.m.validate(ROOT)
        manifest = (ROOT / 'runtime/apk-refresh.txt').read_text().replace('zlib=' + packages['zlib'], 'zlib=1garbage-r0')
        result = subprocess.run([
            'podman', 'run', '--rm', '--network=none', '--image-volume=ignore', '--cap-drop=all',
            '--security-opt=no-new-privileges', '--entrypoint=/bin/sh', self.image,
            '-ec', 'printf "%s" "$1" > /tmp/targets; sh -ec "$2" verify /tmp/targets',
            'invalid-metadata', manifest, (ROOT / 'runtime/verify-apk.sh').read_text(),
        ], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, 'invalid APK version must fail closed in the build too')

    def test_unavailable_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / 'runtime').mkdir()
            for name in ['Containerfile', 'verify-apk.sh', 'apk-refresh.txt']:
                (root / 'runtime' / name).write_text((ROOT / 'runtime' / name).read_text())
            path = root / 'runtime/apk-refresh.txt'
            text = path.read_text()
            current = self.m.validate(ROOT)[0]['zlib']
            path.write_text(text.replace('zlib=' + current, 'zlib=9999.0-r0'))
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                self.m.probe(self.image, root=root)
            self.assertIn('APK target not reached: zlib', caught.exception.stderr)

    def test_recorded_target_downgrade_is_rejected(self):
        packages, _ = self.m.validate(ROOT)
        prior = (ROOT / 'runtime/apk-refresh.txt').read_text().replace('zlib=' + packages['zlib'], 'zlib=9999.0-r0')
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.m.probe(self.image, previous=prior)
        self.assertIn('Recorded target downgrade/removal: zlib', caught.exception.stderr)

    def test_new_transitive_library_requires_inventory_review(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / 'runtime').mkdir()
            for name in ['Containerfile', 'verify-apk.sh', 'apk-refresh.txt']:
                (root / 'runtime' / name).write_text((ROOT / 'runtime' / name).read_text())
            path = root / 'runtime/apk-refresh.txt'
            path.write_text('\n'.join(line for line in path.read_text().splitlines() if not line.startswith('libcrypto3=')) + '\n')
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                self.m.probe(self.image, root=root)
            self.assertIn('Installed package inventory changed', caught.exception.stderr)


if __name__ == '__main__':
    unittest.main()
