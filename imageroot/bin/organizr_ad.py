#!/usr/bin/env python3

# SPDX-License-Identifier: GPL-3.0-or-later

"""Keep Organizr's LDAP backend aligned with the selected NS8 AD domain."""

import argparse
import fcntl
import ipaddress
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RETRY_INTERVAL = 15


class ReconcileError(RuntimeError):
    """An error that can be reported without exposing LDAP credentials."""


class TransientError(ReconcileError):
    """A failure that can pass later; Organizr settings were left unchanged."""


class NameCollisionError(ReconcileError):
    """The reserved local administrator name also exists in AD."""


def is_enabled(settings):
    return settings.get("ORGANIZR_AD_ENABLED") == "true"


def ensure_recovery_name_free(host, port, base, bind_dn, bind_password, domain_name):
    """Prevent an AD login from resolving to Organizr's local administrator."""
    try:
        from ldap3 import NONE, SUBTREE, Connection, Server
        from ldap3.utils.conv import escape_filter_chars

        server = Server(host, port=port, connect_timeout=10, get_info=NONE)
        connection = Connection(
            server, user=bind_dn, password=bind_password,
            auto_bind=True, receive_timeout=15, raise_exceptions=True,
        )
        try:
            connection.search(
                search_base=base,
                search_filter="(|(sAMAccountName=ns8-recovery-admin)"
                f"(userPrincipalName={escape_filter_chars('ns8-recovery-admin@' + domain_name)}))",
                search_scope=SUBTREE,
                attributes=["distinguishedName"],
                size_limit=1,
            )
            if connection.entries:
                raise NameCollisionError(
                    "The name ns8-recovery-admin already exists in AD; "
                    "reserve it for the local Organizr administrator."
                )
            if connection.result.get("result") != 0:
                raise ReconcileError("The AD account lookup did not complete successfully.")
        finally:
            connection.unbind()
    except ReconcileError:
        raise
    except Exception:
        # The provider may still be starting, e.g. after a node reboot.
        raise TransientError("Could not verify the reserved administrator name in AD.") from None


def resolve_ad(settings):
    from agent.ldapproxy import Ldapproxy

    domain_name = settings.get("ORGANIZR_AD_DOMAIN", "").strip()
    if not domain_name:
        raise ReconcileError("Select an NS8 Active Directory domain.")
    domain = Ldapproxy().get_domain(domain_name)
    if domain is None or domain.get("schema") != "ad":
        raise ReconcileError("The selected NS8 Active Directory domain is unavailable.")

    host = str(domain.get("host", ""))
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = host == "localhost"
    if not loopback:
        raise ReconcileError("The NS8 LDAP proxy did not return a loopback address.")
    try:
        port = int(domain["port"])
    except (KeyError, TypeError, ValueError):
        raise ReconcileError("The NS8 LDAP proxy did not return a valid port.") from None
    if not 1 <= port <= 65535:
        raise ReconcileError("The NS8 LDAP proxy did not return a valid port.")

    base = str(domain.get("base_dn", "")).strip()
    bind_dn = str(domain.get("bind_dn", "")).strip()
    bind_password = str(domain.get("bind_password", ""))
    if not base or not bind_dn or not bind_password:
        raise ReconcileError("The selected AD domain has incomplete LDAP bind settings.")
    ensure_recovery_name_free(host, port, base, bind_dn, bind_password, domain_name)

    return {
        "authBackendHost": f"ldap://10.0.2.2:{port}",
        "authBaseDN": settings.get("ORGANIZR_AD_USER_SEARCH_BASE", "").strip() or base,
        "authBackendHostPrefix": "",
        # Adldap binds the login name verbatim; AD simple bind needs a UPN
        # (or a full DN) rather than an unqualified sAMAccountName.
        "authBackendHostSuffix": f"@{domain_name}",
        "ldapBindUsername": bind_dn,
        "ldapBindPassword": bind_password,
        "ldapType": "1",
        # The NS8 host-local proxy handles TLS to the account provider.
        "ldapSSL": "false",
        "ldapTLS": "false",
    }


def request_json(base_url, key, path, *, method="GET", data=None):
    headers = {"Token": key}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        base_url + path,
        data=None if data is None else json.dumps(data).encode("utf-8"),
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise ReconcileError(f"Organizr returned HTTP {error.code} for {path}.") from None
    except (OSError, ValueError):
        raise ReconcileError(f"Organizr did not respond to {path}.") from None
    if result.get("response", {}).get("result") != "success":
        raise ReconcileError(f"Organizr rejected the request to {path}.")
    return result


def wait_ready(base_url):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(base_url + "/", timeout=3) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.HTTPError):
            pass
        time.sleep(3)
    raise TransientError("Organizr did not become ready for AD configuration.")


def reconcile_once():
    import agent

    setup = agent.read_envfile("organizr-setup.env")
    if setup.get("ORGANIZR_SETUP_MODE") != "managed" or setup.get("ORGANIZR_SETUP_COMPLETE") != "true":
        return
    settings = agent.read_envfile("organizr-ad.env")
    if not is_enabled(settings) and settings.get("ORGANIZR_AD_MANAGED") != "true":
        return

    port = os.environ.get("TCP_PORT", "")
    if not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise ReconcileError("The Organizr web port is invalid.")
    key = agent.read_envfile("organizr-api.env")["ORGANIZR_API_KEY"]
    if len(key) != 20:
        raise ReconcileError("The stored Organizr API key is invalid.")
    base_url = f"http://127.0.0.1:{port}/api/v2"

    lock_path = Path(".organizr-ad.lock")
    lock_path.touch(mode=0o600, exist_ok=True)
    lock_path.chmod(0o600)
    with lock_path.open("r+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        wait_ready(f"http://127.0.0.1:{port}")
        if is_enabled(settings):
            # Resolve and check AD before changing Organizr: an unreachable
            # provider must not turn off an AD login that already works.
            try:
                ldap = resolve_ad(settings)
            except NameCollisionError:
                request_json(base_url, key, "/config", method="PUT", data={"authType": "internal"})
                raise
            request_json(base_url, key, "/config", method="PUT", data=ldap)
            try:
                request_json(base_url, key, "/test/ldap", method="POST", data={})
            except ReconcileError:
                # Keep local authentication available until LDAP passes its test.
                request_json(base_url, key, "/config", method="PUT", data={"authType": "internal"})
                raise
            request_json(base_url, key, "/config", method="PUT", data={"authType": "both", "authBackend": "ldap"})
        else:
            request_json(base_url, key, "/config", method="PUT", data={
                "authType": "internal",
                "authBackend": "",
                "authBackendHost": "",
                "authBackendHostPrefix": "",
                "authBackendHostSuffix": "",
                "authBaseDN": "",
                "ldapBindUsername": "",
                "ldapBindPassword": "",
            })


def reconcile(retry_seconds=0):
    """Reconcile once, retrying transient failures until the deadline."""
    deadline = time.monotonic() + retry_seconds
    while True:
        try:
            return reconcile_once()
        except TransientError as error:
            if time.monotonic() >= deadline:
                raise
            print(f"Organizr AD configuration will be retried: {error}", file=sys.stderr)
            time.sleep(RETRY_INTERVAL)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--retry", type=int, default=0, metavar="SECONDS",
        help="keep retrying transient AD or Organizr failures for this many seconds",
    )
    args = parser.parse_args(argv)
    try:
        reconcile(args.retry)
    except (ReconcileError, FileNotFoundError, KeyError) as error:
        # Never print an upstream response or the bind credentials.
        print(f"Organizr AD configuration failed: {error}", file=sys.stderr)
        return 1
    return 0
