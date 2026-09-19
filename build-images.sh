#!/bin/bash

# SPDX-License-Identifier: GPL-3.0-or-later

set -Eeuo pipefail

images=()
repobase="${REPOBASE:-ghcr.io/platypuschan}"
reponame="organizr-reworked"
repository_source="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-Platypuschan/ns8-organizr-reworked}"

# Organizr publishes one multi-architecture rolling tag, so pin the image
# manifest for reproducible NS8 installs. Renovate updates this digest.
# The application itself is refreshed from the selected branch at startup.
organizr_image="ghcr.io/organizr/organizr:latest@sha256:1ce319d73cdfd2666ec7ef21e15907531fabc8a6f333c4ac61e2b2e9d2d162f5"
node_image="docker.io/library/node:24.20.0-slim"

container="$(buildah from scratch)"
nodebuilder=""

cleanup() {
    buildah rm -f "${container}" >/dev/null 2>&1 || true
    if [[ -n "${nodebuilder}" ]]; then
        buildah rm -f "${nodebuilder}" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

echo "Pulling the pinned Node.js build image..."
nodebuilder="$(buildah from -v "${PWD}:/usr/src:Z" "${node_image}")"

echo "Building static UI files..."
buildah run \
    --workingdir=/usr/src/ui \
    --env="NODE_OPTIONS=--openssl-legacy-provider" \
    "${nodebuilder}" \
    sh -c "corepack enable && yarn install --immutable && yarn build"

buildah add "${container}" imageroot /imageroot
buildah add "${container}" ui/dist /ui

buildah config --entrypoint=/ \
    --label="org.opencontainers.image.source=${repository_source}" \
    --label="org.nethserver.authorizations=traefik@node:routeadm" \
    --label="org.nethserver.tcp-ports-demand=1" \
    --label="org.nethserver.rootfull=0" \
    --label="org.nethserver.min-core=3.2.2" \
    --label="org.nethserver.images=${organizr_image}" \
    "${container}"

buildah commit "${container}" "${repobase}/${reponame}"
images+=("${repobase}/${reponame}")

if [[ -n "${CI:-}" ]]; then
    printf "images=%s\n" "${images[*],,}" >>"${GITHUB_OUTPUT}"
else
    printf "Publish the images with:\n\n"
    for image in "${images[@],,}"; do
        printf "  buildah push %s docker://%s:%s\n" "${image}" "${image}" "${IMAGETAG:-latest}"
    done
    printf "\n"
fi
