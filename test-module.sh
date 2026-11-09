#!/bin/bash

# SPDX-License-Identifier: GPL-3.0-or-later

set -Eeuo pipefail

LEADER_NODE="${1:?missing leader node address}"
IMAGE_URL="${2:?missing module image URL}"
SCENARIO="${3:?missing test scenario}"
PREVIOUS_IMAGE_URL="${PREVIOUS_IMAGE_URL:-}"
SSH_KEYFILE="${SSH_KEYFILE:-${HOME}/.ssh/id_ecdsa}"
RUNNER_IMAGE="ghcr.io/marketsquare/robotframework-browser/rfbrowser-stable:19.11.0"
# Each invocation owns only its runner; never replace another test's container.
read -r RUN_ID < /proc/sys/kernel/random/uuid
CONTAINER_NAME="rf-organizr-${SCENARIO}-${RUN_ID}"
SSH_PORT="${SSH_PORT:-22}"
NS8_URL="${NS8_URL:-https://${LEADER_NODE}}"
# Leave Podman's default network untouched in CI. Local forwarded VM ports can
# explicitly opt in with PODMAN_NETWORK=host (no global containers.conf change).
NETWORK_ARGS=()
if [[ -n "${PODMAN_NETWORK:-}" ]]; then
    NETWORK_ARGS=(--network "${PODMAN_NETWORK}")
fi
OUTPUT_DIR="${OUTPUT_DIR:-tests/outputs/${SCENARIO}}"

case "${SCENARIO}" in
    install) ;;
    update)
        if [[ -z "${PREVIOUS_IMAGE_URL}" ]]; then
            echo "The update scenario needs PREVIOUS_IMAGE_URL; run test-module-update.sh." >&2
            exit 64
        fi
        ;;
    *)
        echo "Unsupported test scenario '${SCENARIO}'; expected install or update." >&2
        exit 64
        ;;
esac

if [[ ! -r "${SSH_KEYFILE}" ]]; then
    echo "SSH key is not readable: ${SSH_KEYFILE}" >&2
    exit 66
fi

SSH_PRIVATE_KEY="$(<"${SSH_KEYFILE}")"
export IMAGE_URL LEADER_NODE PREVIOUS_IMAGE_URL SCENARIO SSH_PRIVATE_KEY SSH_PORT NS8_URL

cleanup() {
    podman rm --force "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "${OUTPUT_DIR}"

set +e
podman run --interactive \
    --name "${CONTAINER_NAME}" \
    "${NETWORK_ARGS[@]}" \
    --volume "${PWD}:/home/pwuser/ns8-module:z" \
    --env IMAGE_URL \
    --env PREVIOUS_IMAGE_URL \
    --env LEADER_NODE \
    --env SSH_PORT \
    --env NS8_URL \
    --env SCENARIO \
    --env SSH_PRIVATE_KEY \
    "${RUNNER_IMAGE}" \
    bash -l -s <<'EOF'
set -Eeuo pipefail

umask 077
printf '%s\n' "${SSH_PRIVATE_KEY}" > /home/pwuser/ns8-key
pip install --quiet --disable-pip-version-check robotframework-sshlibrary==3.8.0

cd /home/pwuser/ns8-module
# Parse only suite sources, never previous private output directories. Those
# may be unreadable to this new runner and must not be traversed by Robot.
mkdir -p /home/pwuser/suite
cp tests/*.robot /home/pwuser/suite/
exec robot \
    -v "NODE_ADDR:${LEADER_NODE}" \
    -v "SSH_PORT:${SSH_PORT}" \
    -v "NS8_URL:${NS8_URL}" \
    -v "IMAGE_URL:${IMAGE_URL}" \
    -v "PREVIOUS_IMAGE_URL:${PREVIOUS_IMAGE_URL}" \
    -v "SSH_KEYFILE:/home/pwuser/ns8-key" \
    -v "SCENARIO:${SCENARIO}" \
    --name "organizr-${SCENARIO}" \
    --outputdir /home/pwuser/outputs \
    /home/pwuser/suite/
EOF
test_status=$?
set -e

podman cp \
    "${CONTAINER_NAME}:/home/pwuser/outputs/." \
    "${OUTPUT_DIR}/" 2>/dev/null || true

exit "${test_status}"
