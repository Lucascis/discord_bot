#!/usr/bin/env bash
set -euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-discordbot_main}"
EXPECTED_SERVICES=(postgres redis lavalink gateway api audio worker panel)

log_docker_main() {
  printf '[docker-main] %s\n' "$*"
}

compose_main() {
  docker compose -p "${COMPOSE_PROJECT}" "$@"
}

ensure_docker_main() {
  if ! command -v docker >/dev/null 2>&1; then
    log_docker_main "docker command not found"
    return 1
  fi

  if ! docker info >/dev/null 2>&1; then
    log_docker_main "docker daemon is not reachable"
    return 1
  fi
}

check_conflicting_projects_main() {
  local expected_services_csv
  expected_services_csv="$(IFS='|'; echo "${EXPECTED_SERVICES[*]}")"

  local conflicts
  conflicts="$(
    docker ps --format '{{.ID}} {{.Names}} {{.Label "com.docker.compose.project"}} {{.Label "com.docker.compose.service"}}' \
      | awk -v project="${COMPOSE_PROJECT}" -v re="^(${expected_services_csv})$" '
          $4 ~ re && $3 != "" && $3 != project { print $0 }
        '
  )"

  if [[ -n "${conflicts}" ]]; then
    log_docker_main "conflicting compose project detected for discord-bot services:"
    printf '%s\n' "${conflicts}"
    log_docker_main "stop conflicting stacks before continuing"
    return 1
  fi
}

cleanup_project_containers_main() {
  log_docker_main "removing exited/created containers for project ${COMPOSE_PROJECT}"
  docker ps -aq \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "status=exited" \
    --filter "status=created" \
    | xargs -r docker rm -f >/dev/null

  log_docker_main "pruning stopped containers with project label ${COMPOSE_PROJECT}"
  docker container prune -f --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" >/dev/null

  log_docker_main "removing stale renamed containers left by force-recreate"
  docker ps -aq \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "name=_discord-" \
    | xargs -r docker rm -f >/dev/null || true
}
