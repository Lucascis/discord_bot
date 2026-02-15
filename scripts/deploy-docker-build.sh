#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/_docker-main.sh"

ensure_docker_main
check_conflicting_projects_main
cleanup_project_containers_main

export DOCKER_TAG="${DOCKER_TAG:-$(git rev-parse --short HEAD)}"
echo "[deploy] Building docker images with tag: ${DOCKER_TAG}"
compose_main build

echo "[deploy] Build completed"
