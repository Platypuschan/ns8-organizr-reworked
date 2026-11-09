"""APK-only refresh contract (no network needed for unit tests)."""
import importlib.machinery
import importlib.util
import json
import re
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / '.github/scripts/apk-refresh'


class RefreshContract(unittest.TestCase):
    def test_inventory_is_a_consumed_tree_input(self):
        manifest = ROOT / 'runtime/apk-refresh.txt'
        self.assertTrue(manifest.is_file(), 'installed transitive APK inventory is missing')
        recipe = (ROOT / 'runtime/Containerfile').read_text()
        self.assertLess(recipe.index('COPY apk-refresh.txt'), recipe.index('apk upgrade'))
        self.assertIn('verify-apk.sh', recipe)
        # The existing helper hashes the committed runtime tree, not only FROM.
        helper = (ROOT / '.github/scripts/runtime-image').read_text()
        self.assertIn('HEAD:runtime', helper)

    def load(self):
        self.assertTrue(SCRIPT.is_file(), 'fail-closed APK validator/probe is missing')
        loader = importlib.machinery.SourceFileLoader('apk_refresh', str(SCRIPT))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        return module

    def test_inventory_covers_libraries_and_security_floor(self):
        m = self.load()
        packages, registry = m.validate(ROOT)
        self.assertIn('libcrypto3', packages)
        self.assertIn('php83-common', packages)
        self.assertIn('zlib', packages)
        self.assertRegex(packages['php83'], r'^8\.3\.\d+-r\d+$')
        self.assertIn('branch=v3.24&components=main,community&arch=x86_64', registry)

    def test_unchanged_inventory_is_idempotent(self):
        m = self.load()
        first = m.validate(ROOT)
        self.assertEqual(first, m.validate(ROOT))

    def test_php_target_cannot_drop_below_security_floor(self):
        m = self.load()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / 'runtime').mkdir()
            (root / 'runtime/Containerfile').write_text((ROOT / 'runtime/Containerfile').read_text())
            text = (ROOT / 'runtime/apk-refresh.txt').read_text().replace('php83=' + m.validate(ROOT)[0]['php83'], 'php83=8.3.35-r0')
            (root / 'runtime/apk-refresh.txt').write_text(text)
            with self.assertRaisesRegex(ValueError, 'security floor'):
                m.validate(root)

    def test_package_only_commit_changes_runtime_reference(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            subprocess.run(['git', 'init', '-q', td], check=True)
            (root / '.github/scripts').mkdir(parents=True)
            (root / '.github/scripts/runtime-image').write_bytes((ROOT / '.github/scripts/runtime-image').read_bytes())
            (root / 'runtime').mkdir()
            manifest = root / 'runtime/apk-refresh.txt'
            manifest.write_text('zlib=1.3.2-r1\n')
            def commit():
                subprocess.run(['git', '-C', td, 'add', '.'], check=True)
                subprocess.run(['git', '-C', td, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
                return subprocess.check_output(['bash', str(root / '.github/scripts/runtime-image')], text=True)
            first = commit()
            self.assertEqual(first, subprocess.check_output(['bash', str(root / '.github/scripts/runtime-image')], text=True))
            manifest.write_text('zlib=1.4-r0\n')
            self.assertNotEqual(first, commit())

    def test_invalid_metadata_and_base_registry_mismatch_fail_closed(self):
        m = self.load()
        for bad in ['zlib=1.4-r0\nzlib=1.4-r0\n', 'zlib=garbage\n', 'zlib=1.4-r0\nBAD\n']:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                m.parse_manifest('# registry=https://dl-cdn.alpinelinux.org/alpine?branch=v3.24&components=main,community&arch=x86_64\n' + bad)
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / 'runtime').mkdir()
            for name in ['Containerfile', 'apk-refresh.txt']:
                (root / 'runtime' / name).write_text((ROOT / 'runtime' / name).read_text())
            config = json.loads((ROOT / 'renovate.json').read_text())
            (root / 'renovate.json').write_text(json.dumps(config))
            path = root / 'runtime/Containerfile'
            path.write_text(re.sub(r'alpine:[^@]+', 'alpine:999.99.0', path.read_text()))
            with self.assertRaisesRegex(ValueError, 'branch'):
                m.validate(root)


if __name__ == '__main__':
    unittest.main()
