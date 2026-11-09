#!/usr/bin/env python3
"""Private, disposable NS8 lab. Never operates on an existing unowned directory."""
import pathlib
import argparse
import hashlib
import json
import os
import pwd
import socket
import subprocess
import urllib.request

OWNER = "ns8-organizr-disposable-lab-v1\n"


def require_owned(state):
    marker = pathlib.Path(state) / "OWNER"
    if not marker.is_file() or marker.read_text() != OWNER:
        raise RuntimeError("lab directory is not owned by this launcher")


def vm_command(state):
    return ["qemu-system-x86_64", "-name", "ns8-organizr-lab",
            "-machine", "q35,accel=kvm", "-cpu", "host", "-smp", "4", "-m", "8192",
            "-display", "none", "-monitor", "none", "-serial", f"file:{state}/console.log",
            "-qmp", f"unix:{state}/qmp.sock,server=on,wait=off",
            "-device", "virtio-rng-pci",
            "-drive", f"if=virtio,file={state}/guest.qcow2,format=qcow2,discard=unmap",
            "-drive", f"if=virtio,file={state}/seed.iso,format=raw,readonly=on",
            "-netdev", "user,id=n0,net=10.77.90.0/24,hostfwd=tcp:127.0.0.1:22291-:22,hostfwd=tcp:127.0.0.1:18491-:443,hostfwd=tcp:127.0.0.1:18091-:80",
            "-device", "virtio-net-pci,netdev=n0,mac=52:54:00:79:49:01"]


def service_command(state):
    return ["sudo", "-n", "systemd-run", "--unit=ns8-organizr-lab", "--collect",
            f"--uid={pwd.getpwuid(os.getuid()).pw_name}", "--gid=kvm",
            "--property=KillMode=mixed", "--"] + vm_command(state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "run", "ssh", "stop"])
    parser.add_argument("--state", type=pathlib.Path,
                        default=pathlib.Path.home() / "ns8-labs/organizr-acceptance")
    parser.add_argument("--command", default="true", help="guest shell command for ssh")
    args = parser.parse_args()
    state = args.state.expanduser().resolve()
    os.umask(0o077)
    if args.action == "prepare":
        if state.exists():
            require_owned(state)
        else:
            state.mkdir(parents=True, mode=0o700)
            (state / "OWNER").write_text(OWNER)
        if (state / "guest.qcow2").exists():
            raise RuntimeError("owned guest already exists; not resetting or overwriting it")
        base_url = "https://cloud.debian.org/images/cloud/trixie/latest/"
        filename = "debian-13-genericcloud-amd64.qcow2"
        sums = urllib.request.urlopen(base_url + "SHA512SUMS", timeout=60).read().decode()
        expected = next(line.split()[0] for line in sums.splitlines()
                        if line.split()[-1] == filename)
        image = state / "base.qcow2"
        urllib.request.urlretrieve(base_url + filename, image)
        with image.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha512").hexdigest()
        if actual != expected:
            raise RuntimeError("cloud image SHA512 mismatch; refusing to boot")
        (state / "base-provenance.json").write_text(json.dumps(
            {"url": base_url + filename, "sha512": actual}, indent=2))
        subprocess.run(["ssh-keygen", "-q", "-t", "rsa", "-b", "3072", "-m", "PEM",
                        "-N", "", "-f", str(state / "id_rsa")], check=True)
        public_key = (state / "id_rsa.pub").read_text().strip()
        (state / "meta-data").write_text("instance-id: ns8-organizr-lab-v1\nlocal-hostname: ns8-organizr-lab\n")
        (state / "user-data").write_text(f'''#cloud-config
hostname: ns8-organizr-lab
fqdn: ns8-organizr.lab
manage_etc_hosts: false
disable_root: false
ssh_pwauth: false
users:
  - name: root
    ssh_authorized_keys:
      - "{public_key}"
growpart:
  mode: auto
  devices: ['/']
resize_rootfs: true
write_files:
  - path: /etc/ssh/sshd_config.d/00-lab-root.conf
    permissions: '0600'
    content: |
      PermitRootLogin prohibit-password
      PubkeyAuthentication yes
      UseDNS no
runcmd:
  - [bash, -c, "echo '10.77.90.15 ns8-organizr.lab ns8-organizr-lab' >> /etc/hosts"]
  - [bash, -c, "systemctl disable --now systemd-resolved || true; rm -f /etc/resolv.conf; printf 'nameserver 10.77.90.3\\n' > /etc/resolv.conf"]
  - [bash, -c, "journalctl --flush; systemctl restart ssh"]
''')
        subprocess.run(["qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b",
                        str(image), str(state / "guest.qcow2"), "40G"], check=True)
        subprocess.run(["cloud-localds", str(state / "seed.iso"),
                        str(state / "user-data"), str(state / "meta-data")], check=True)
        print(f"Prepared isolated Debian guest in {state}; checksum verified")
        return
    require_owned(state)
    if args.action == "run":
        # A system service keeps the disposable guest alive across chat/SSH
        # disconnects, which would otherwise interrupt cluster initialization.
        raise SystemExit(subprocess.call(service_command(state)))
    if args.action == "ssh":
        raise SystemExit(subprocess.call([
            "ssh", "-i", str(state / "id_rsa"), "-p", "22291", "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new", "-o", f"UserKnownHostsFile={state}/known_hosts",
            "-o", "ConnectTimeout=10", "root@127.0.0.1", args.command]))
    if args.action == "stop":
        with socket.socket(socket.AF_UNIX) as sock:
            sock.settimeout(10)
            sock.connect(str(state / "qmp.sock"))
            stream = sock.makefile("rwb", buffering=0)
            json.loads(stream.readline())
            for action in ("qmp_capabilities", "system_powerdown"):
                stream.write(json.dumps({"execute": action}).encode() + b"\n")
                while True:
                    response = json.loads(stream.readline())
                    if "error" in response:
                        raise RuntimeError("QMP rejected lifecycle command")
                    if "return" in response:
                        break
        print("Requested graceful shutdown of owned test guest")


if __name__ == "__main__":
    main()
