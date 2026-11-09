# Real NS8 acceptance lab

This is a **real NS8 backend and cluster-admin**, not the UI fixture API used by
`ui/tests/e2e`. The existing QEMU CI already launches real NS8 guests and opens
the module UI in the cluster-admin iframe. This local launcher makes the same
kind of acceptance repeatable without touching an existing installation.

## Isolation and prerequisites

Linux with working nested KVM, QEMU, `qemu-img`, `cloud-localds`, OpenSSH, Python
3.11+, rootless Podman, and enough space for a 40 GiB sparse guest disk; allocate
4 vCPUs and 8 GiB RAM. On Debian:

```sh
sudo apt-get update
sudo apt-get install --no-install-recommends qemu-system-x86 qemu-utils cloud-image-utils
```

The launcher uses user-mode networking, **no host bridge, firewall changes,
world-writable KVM devices, global Podman configuration, or LAN listeners**.
It forwards only localhost SSH `22291`, HTTPS `18491`, HTTP `18091`.
If the user cannot open `/dev/kvm`, a transient systemd service starts QEMU as
the same unprivileged user with the `kvm` primary group, not as root. The service
also keeps the guest alive across terminal/chat disconnects.

State, private SSH key and diagnostics live outside the repository, by default
`~/ns8-labs/organizr-acceptance`, mode 0700. Only a directory containing this launcher's
ownership marker is accepted. Existing guests are never reset by `prepare`.
The immutable base is SHA512-checked against Debian's published checksum; the
URL and actual hash are recorded beside the disk. Preserve both backing image
and overlay. No production hostname, credentials, data or module instance is
used. The guest still has outbound network access; this is not a hostile-code
sandbox.

## Prepare, boot and install once

```sh
python3 tools/ns8_lab.py prepare
# Keep running in a dedicated terminal/service; do not run twice:
python3 tools/ns8_lab.py run
```

In another terminal, after SSH becomes available:

```sh
python3 tools/ns8_lab.py ssh --command 'cloud-init status --wait --long'
python3 tools/ns8_lab.py ssh --command 'set -e; cd /root; curl -fsSL --retry 3 -o install.sh https://raw.githubusercontent.com/NethServer/ns8-core/266df4efba5f749ff3b8331f92c555f7e8c1a164/core/install.sh; bash install.sh'
python3 tools/ns8_lab.py ssh --command 'umask 077; create-cluster 10.77.90.15:55820 10.5.4.0/24 Nethesis,1234 > /root/cluster-bootstrap.private'
```

The pinned SHA above identifies the **installer**, not a promise that the
installer's `ns8-stable` image tag is immutable. Record the installed core image
and actual digest for each run. Do not repeat installation/cluster creation on
an existing guest. `create-cluster` prints a join token: keep its output private.
The disposable fixture uses the upstream test admin credential; never expose
this guest to a LAN or the Internet. Browser entry from this machine:
`https://127.0.0.1:18491/cluster-admin/` (self-signed certificate).

## Execute real suites

Use the repository root. These are destructive acceptance suites **inside this
lab only**: they create and remove their own applications and test AD domain.
The update wrapper requires a genuinely older stable baseline, even after the
target release has already been published. For an explicitly chosen older
baseline, invoke `test-module.sh` directly as below.

```sh
export SSH_KEYFILE="$HOME/ns8-labs/organizr-acceptance/id_rsa"
export SSH_PORT=22291
export NS8_URL=https://127.0.0.1:18491
export PODMAN_NETWORK=host

bash test-module-install.sh 127.0.0.1 ghcr.io/platypuschan/organizr-reworked:0.4.1

PREVIOUS_IMAGE_URL=ghcr.io/platypuschan/organizr-reworked:0.4.0 \
  bash test-module.sh 127.0.0.1 ghcr.io/platypuschan/organizr-reworked:0.4.1 update
```

Retain Robot `output.xml`, `log.html`, screenshots and `report.html` from
`tests/outputs/{install,update}` privately. Generated recovery credentials may
appear in backend diagnostics or screenshots; never commit raw artifacts.
A green job is not a pass count: count each test's direct status from
`output.xml` and distinguish intentional install-only skips in the update suite.

## GitHub CI

The same `tests/organizr.robot` suite is executed automatically by
`.github/workflows/publish-images.yml` on Debian 13 and Rocky 9, each with fresh
install and upgrade scenarios. `.github/workflows/test-module.yml` can also be
dispatched. Local-only SSH/URL/network overrides default to the existing CI
addresses. The shared harness's `run_ui_tests` input controls publishing
screenshot comments; it does **not** switch off the existing browser test.
Branches can publish candidate images through the existing push workflow;
stable release promotion remains main-only. Never dispatch main's workflow to
pretend it tests an uncommitted local test change.

## Reuse and shutdown

After an acceptance suite removes its test application, the NS8 cluster remains
available. Inspect it with:

```sh
python3 tools/ns8_lab.py ssh --command 'api-cli run list-installed-modules'
python3 tools/ns8_lab.py stop
```

`stop` requests ACPI shutdown through this guest's private QMP socket. Check that
the QEMU process exits before restarting or inspecting the disk offline. The
launcher does not delete keys, disks, or production resources. Restart with
`run`; do not run `prepare` again. For remote browser access, tunnel only the
localhost HTTPS port through SSH to the VM host; never bind it to 0.0.0.0.
