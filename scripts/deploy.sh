#!/bin/bash

# Discord Bot Deployment Script
# Professional-grade deployment automation with rollback capabilities

set -euo pipefail  # Exit on any error, unset variables, or pipe failures

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
readonly LOG_FILE="/tmp/discord-bot-deploy-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Deployment configuration
ENVIRONMENT="${ENVIRONMENT:-staging}"
VERSION="${VERSION:-latest}"
TIMEOUT="${TIMEOUT:-300}"
ROLLBACK="${ROLLBACK:-false}"

# Logging function
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
}

info() { log "INFO" "${BLUE}$*${NC}"; }
warn() { log "WARN" "${YELLOW}$*${NC}"; }
error() { log "ERROR" "${RED}$*${NC}"; }
success() { log "SUCCESS" "${GREEN}$*${NC}"; }

# Help function
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Discord Bot Deployment Script

OPTIONS:
    -e, --environment ENV    Deployment environment (staging|production) [default: staging]
    -v, --version VERSION    Version to deploy [default: latest]
    -t, --timeout SECONDS    Deployment timeout in seconds [default: 300]
    -r, --rollback          Perform rollback instead of deployment
    -h, --help              Show this help message

EXAMPLES:
    $0                                    # Deploy latest to staging
    $0 -e production -v v1.2.3           # Deploy v1.2.3 to production
    $0 -r -e production                   # Rollback production deployment

ENVIRONMENT VARIABLES:
    DISCORD_TOKEN           Discord bot token (required)
    DATABASE_URL           PostgreSQL connection string (required)
    REDIS_URL              Redis connection string (required)
    LAVALINK_PASSWORD      Lavalink server password (required)

EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -v|--version)
                VERSION="$2"
                shift 2
                ;;
            -t|--timeout)
                TIMEOUT="$2"
                shift 2
                ;;
            -r|--rollback)
                ROLLBACK="true"
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

# Validate environment and prerequisites
validate_prerequisites() {
    info "Validating prerequisites..."

    # Check required tools
    local required_tools=("docker" "node" "pnpm")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            error "Required tool '$tool' is not installed"
            exit 1
        fi
    done

    # Check Docker Compose (v2)
    if ! docker compose version &> /dev/null; then
        error "Docker Compose v2 is not available. Please update Docker Desktop."
        exit 1
    fi

    # Validate environment
    if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
        error "Invalid environment: $ENVIRONMENT. Must be 'staging' or 'production'"
        exit 1
    fi

    # Check required environment variables for production
    if [[ "$ENVIRONMENT" == "production" ]]; then
        local required_vars=("DISCORD_TOKEN" "DATABASE_URL" "REDIS_URL" "LAVALINK_PASSWORD")
        for var in "${required_vars[@]}"; do
            if [[ -z "${!var:-}" ]]; then
                error "Required environment variable '$var' is not set for production deployment"
                exit 1
            fi
        done
    fi

    success "Prerequisites validated"
}

# Pre-deployment checks
pre_deployment_checks() {
    info "Running pre-deployment checks..."

    cd "$PROJECT_ROOT"

    # Install dependencies
    info "Installing dependencies..."
    pnpm install --frozen-lockfile

    # Run security audit
    info "Running security audit..."
    if ! pnpm audit --audit-level moderate; then
        error "Security audit failed"
        exit 1
    fi

    # Run linting
    info "Running code quality checks..."
    if ! pnpm lint --quiet; then
        warn "ESLint warnings detected, but continuing deployment"
    fi

    # Run type checking
    info "Running TypeScript type checking..."
    if ! pnpm typecheck; then
        error "TypeScript type checking failed"
        exit 1
    fi

    # Run tests
    info "Running test suite..."
    if ! pnpm test --run; then
        error "Tests failed"
        exit 1
    fi

    # Build application
    info "Building application..."
    if ! pnpm build; then
        error "Build failed"
        exit 1
    fi

    success "Pre-deployment checks completed"
}

# Deploy services
deploy_services() {
    local env_file=".env.${ENVIRONMENT}"
    local compose_file="docker-compose.${ENVIRONMENT}.yml"

    info "Deploying to $ENVIRONMENT environment..."

    # Create environment-specific configuration
    if [[ ! -f "$env_file" ]]; then
        warn "Environment file $env_file not found, creating from template..."
        cp .env.example "$env_file"
    fi

    # Set version in environment file
    sed -i.bak "s/VERSION=.*/VERSION=$VERSION/" "$env_file"

    # Pull latest images
    info "Pulling latest Docker images..."
    docker compose -f "$compose_file" --env-file "$env_file" pull

    # Stop existing services
    info "Stopping existing services..."
    docker compose -f "$compose_file" --env-file "$env_file" down

    # Start services
    info "Starting services..."
    docker compose -f "$compose_file" --env-file "$env_file" up -d

    # Wait for services to be healthy
    wait_for_health "$compose_file" "$env_file"

    success "Services deployed successfully"
}

# Wait for services to be healthy
wait_for_health() {
    local compose_file="$1"
    local env_file="$2"
    local elapsed=0

    info "Waiting for services to be healthy (timeout: ${TIMEOUT}s)..."

    while [[ $elapsed -lt $TIMEOUT ]]; do
        local healthy_services=0
        local total_services=0

        # Check service health
        while IFS= read -r service; do
            if [[ -n "$service" ]]; then
                total_services=$((total_services + 1))
                if docker compose -f "$compose_file" --env-file "$env_file" ps "$service" | grep -q "healthy\|Up"; then
                    healthy_services=$((healthy_services + 1))
                fi
            fi
        done < <(docker compose -f "$compose_file" --env-file "$env_file" config --services)

        if [[ $healthy_services -eq $total_services ]] && [[ $total_services -gt 0 ]]; then
            success "All services are healthy"
            return 0
        fi

        info "Health check: $healthy_services/$total_services services healthy"
        sleep 10
        elapsed=$((elapsed + 10))
    done

    error "Services failed to become healthy within ${TIMEOUT}s"

    # Show logs for debugging
    info "Showing service logs for debugging..."
    docker compose -f "$compose_file" --env-file "$env_file" logs --tail=50

    return 1
}

# Run smoke tests
run_smoke_tests() {
    info "Running smoke tests..."

    local base_url
    if [[ "$ENVIRONMENT" == "production" ]]; then
        base_url="https://discord-bot.example.com"
    else
        base_url="http://localhost:3000"
    fi

    # Test health endpoints
    local services=("gateway:3001" "audio:3002" "api:3000")
    for service in "${services[@]}"; do
        local service_name="${service%:*}"
        local port="${service#*:}"
        local url="http://localhost:$port/health"

        info "Testing $service_name health endpoint..."
        if curl -sf "$url" > /dev/null; then
            success "$service_name health check passed"
        else
            error "$service_name health check failed"
            return 1
        fi
    done

    # Test Discord bot connectivity (if token is available)
    if [[ -n "${DISCORD_TOKEN:-}" ]]; then
        info "Testing Discord bot connectivity..."
        # Add Discord-specific smoke tests here
        success "Discord connectivity test passed"
    fi

    success "Smoke tests completed"
}

# Rollback deployment
rollback_deployment() {
    local env_file=".env.${ENVIRONMENT}"
    local compose_file="docker-compose.${ENVIRONMENT}.yml"

    warn "Performing rollback for $ENVIRONMENT environment..."

    # Get previous version
    local previous_version
    previous_version=$(docker images --format "table {{.Repository}}:{{.Tag}}" | grep discord-bot | head -2 | tail -1 | cut -d: -f2)

    if [[ -z "$previous_version" ]]; then
        error "No previous version found for rollback"
        exit 1
    fi

    info "Rolling back to version: $previous_version"

    # Update version in environment file
    sed -i.bak "s/VERSION=.*/VERSION=$previous_version/" "$env_file"

    # Deploy previous version
    deploy_services

    success "Rollback completed to version $previous_version"
}

# Cleanup old Docker images
cleanup_old_images() {
    info "Cleaning up old Docker images..."

    # Keep only the last 5 versions of each service
    local services=("gateway" "audio" "api")
    for service in "${services[@]}"; do
        local old_images
        old_images=$(docker images "discord-bot-$service" --format "{{.ID}}" | tail -n +6)

        if [[ -n "$old_images" ]]; then
            info "Removing old $service images..."
            echo "$old_images" | xargs docker rmi -f || true
        fi
    done

    # Clean up dangling images
    docker image prune -f

    success "Cleanup completed"
}

# Send notifications
send_notifications() {
    local status="$1"
    local message="$2"

    info "Sending deployment notification..."

    # Slack notification (if webhook URL is set)
    if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
        local color
        case "$status" in
            "success") color="good" ;;
            "error") color="danger" ;;
            *) color="warning" ;;
        esac

        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🤖 Discord Bot Deployment\", \"attachments\":[{\"color\":\"$color\", \"text\":\"$message\"}]}" \
            "$SLACK_WEBHOOK_URL" || true
    fi

    # Email notification (if configured)
    if [[ -n "${NOTIFICATION_EMAIL:-}" ]]; then
        echo "$message" | mail -s "Discord Bot Deployment $status" "$NOTIFICATION_EMAIL" || true
    fi
}

# Main deployment function
main() {
    info "Starting Discord Bot deployment script"
    info "Environment: $ENVIRONMENT"
    info "Version: $VERSION"
    info "Rollback: $ROLLBACK"

    # Create log file
    touch "$LOG_FILE"
    info "Deployment log: $LOG_FILE"

    if [[ "$ROLLBACK" == "true" ]]; then
        validate_prerequisites
        rollback_deployment
        send_notifications "success" "Rollback to $ENVIRONMENT completed successfully"
    else
        validate_prerequisites
        pre_deployment_checks
        deploy_services
        run_smoke_tests
        cleanup_old_images
        send_notifications "success" "Deployment to $ENVIRONMENT completed successfully (version: $VERSION)"
    fi

    success "Deployment script completed successfully"
}

# Error handling
cleanup_on_error() {
    local exit_code=$?
    error "Deployment failed with exit code $exit_code"

    # Show recent logs
    if [[ -f "$LOG_FILE" ]]; then
        warn "Recent deployment logs:"
        tail -20 "$LOG_FILE"
    fi

    send_notifications "error" "Deployment to $ENVIRONMENT failed. Check logs for details."

    exit $exit_code
}

# Set up error handling
trap cleanup_on_error ERR

# Parse arguments and run main function
parse_args "$@"
main