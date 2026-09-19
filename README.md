# Organizr for NethServer 8

This repository packages [Organizr](https://organizr.app/) as a NethServer 8
application. Organizr provides a single dashboard for self-hosted services and
bookmarks, with optional user accounts and per-tab access controls.

The module provides:

- the official `ghcr.io/organizr/organizr` container
- HTTPS access through the NS8 Traefik instance
- persistent Organizr configuration and application data
- integration with the NS8 backup, clone, restore, status and log views
- a rootless Podman service with one loopback-only backend port

## Runtime design

The module deliberately uses the stable Organizr branch (`v2-master`). The
official container manifest is pinned by digest for reproducible installs and
is kept current by Renovate. The container stores its complete working tree
and configuration below `/config`, which is backed by the Podman volume
`organizr-app`.

The upstream container does not embed the Organizr PHP application. On start,
it clones or updates the selected Organizr branch inside `/config`. Therefore a
container restart can also update Organizr even when the NS8 module image has
not changed. Create an NS8 application backup before planned restarts or
updates and review the [Organizr releases](https://github.com/causefx/Organizr/releases).

## Install

Install the module on an NS8 node:

~~~bash
add-module ghcr.io/platypuschan/organizr-reworked:latest 1
~~~

The command returns the instance ID, for example `organizr-reworked1`.

## Configure

Configure the public hostname through the NS8 application UI or the API:

~~~bash
api-cli run module/organizr-reworked1/configure-module --data - <<'EOF'
{
  "host": "organizr.example.test",
  "http2https": true,
  "lets_encrypt": false
}
EOF
~~~

Use a resolvable fully qualified hostname. Enable Let's Encrypt only when the
hostname and the certificate challenge are reachable as required by your DNS
and firewall setup.

Open `https://organizr.example.test` after configuration and complete the
Organizr first-run wizard. User accounts, tabs, authentication providers and
all other application settings are managed in Organizr itself.

Retrieve the current NS8 route configuration with:

~~~bash
api-cli run module/organizr-reworked1/get-configuration
~~~

## Backup and restore

NS8 backs up the complete `organizr-app` volume. It contains the Organizr
working tree, SQLite data, uploaded assets and the container's nginx/PHP
configuration. A restored or cloned instance recreates its Traefik route and
starts with the restored volume.

For the most consistent backup, avoid changing Organizr settings while the
backup is running. To eliminate writes completely, stop the service for the
duration of the backup:

~~~bash
runagent -m organizr-reworked1 systemctl --user stop organizr.service
# run the NS8 application backup
runagent -m organizr-reworked1 systemctl --user start organizr.service
~~~

## Update

After creating and verifying a backup, update the module with:

~~~bash
api-cli run update-module --data '{
  "module_url": "ghcr.io/platypuschan/organizr-reworked:latest",
  "instances": ["organizr-reworked1"],
  "force": true
}'
~~~

The update restarts the Organizr container. Because of the upstream image
behavior described above, that restart also checks out the current stable
Organizr code.

## Troubleshooting

Inspect the module service and container with:

~~~bash
runagent -m organizr-reworked1 systemctl --user status organizr.service
runagent -m organizr-reworked1 journalctl --user -u organizr.service --no-pager -n 200
runagent -m organizr-reworked1 podman logs organizr
runagent -m organizr-reworked1 podman exec -it organizr /bin/bash
~~~

The first start can take longer because the official container downloads the
Organizr source into the persistent volume.

## Uninstall

~~~bash
remove-module --no-preserve organizr-reworked1
~~~

`--no-preserve` permanently removes the instance data. Verify backups first.

## Testing

Static checks and the UI build run for every push and pull request. The module
also includes Robot Framework install and update scenarios for the reusable
NS8 QEMU test workflow.

The Organizr logo bundled in the module UI comes from the GPL-3.0-licensed
[Organizr repository](https://github.com/causefx/Organizr).
