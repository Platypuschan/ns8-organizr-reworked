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
- a one-time choice between Organizr's wizard and unattended NS8 setup
- optional NS8-managed Active Directory login through the host's LDAP proxy

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
  "lets_encrypt": false,
  "setup_mode": "managed",
  "ad_enabled": true,
  "ad_domain": "ad.example.test"
}
EOF
~~~

Use a resolvable fully qualified hostname. Enable Let's Encrypt only when the
hostname and the certificate challenge are reachable as required by your DNS
and firewall setup.

Choose `managed` to let NS8 run Organizr's first-run wizard before the public
route is created. It uses SQLite inside the persistent volume, generates the
application keys and a long registration password, and creates a local
recovery administrator with a randomized username. Expand **Initial administrator** on the module
settings page to view its username and generated password. The secrets are
stored in a module state file with mode `0600` and included in NS8 backups.
The SQLite database is stored at `/config/ns8-organizr-db/organizr.db`, outside
the web root. Tabs and other Organizr settings remain editable in its web
interface. Changing this administrator's password inside Organizr
does not change the password shown in NS8.

For direct AD login, select **Active Directory login** and an NS8 AD account
domain in the module settings, or supply `ad_enabled` and `ad_domain` as in the
example. NS8 binds the domain and configures Organizr's LDAP backend through
its local LDAP proxy. The first successful sign-in creates an Organizr account
for that AD username. The local administrator remains available. Optionally set
`ad_user_search_base` to an LDAP DN to limit the search to one organizational
unit; the default is the domain base DN. The backend accepts any user with valid
credentials in the selected domain. There is no AD group restriction or AD
administrator mapping; manage access levels in Organizr.

**Organizr limitation:** In its combined database and backend mode, Organizr
stores a local hash of each AD user's password. An earlier password can still work
after an AD password change or account deactivation. Disabling AD integration
switches Organizr to its local database, which can also authenticate accounts
previously created from AD. Remove or disable those accounts in Organizr when
revoking access. This integration should not be used where immediate AD account
revocation is required.

Choose `manual` to use the ordinary Organizr first-run wizard. Open the public
URL promptly after configuration: until the wizard is completed, anyone with
network access can create the first administrator. To select this mode via the
API, set `"setup_mode": "manual"`. The setup mode is required for every
configuration request; the settings page sends the saved mode after setup.

AD integration requires managed setup; manual setup leaves the Organizr LDAP
settings to you. The setup mode is fixed as soon as the first configuration begins. To change
it, install a separate instance and migrate its data.

Retrieve the current NS8 route configuration with:

~~~bash
api-cli run module/organizr-reworked1/get-configuration
~~~

## Backup and restore

NS8 backs up the complete `organizr-app` volume. It contains the Organizr
working tree, SQLite data, uploaded assets and the container's nginx/PHP
configuration. The setup mode, AD selection, API key and generated administrator
credentials are included as module state files. A restored or cloned instance
recreates its Traefik route and refreshes its LDAP bind settings from NS8.

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
