#!/bin/bash
# Discord Bot - Stop Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_status "Stopping Discord Bot Services..."

# Stop all services
docker compose -f docker-compose.production.yml down

# Optional: Remove volumes (uncomment if needed)
# print_warning "Removing data volumes..."
# docker compose -f docker-compose.production.yml down -v

print_status "All services stopped successfully!"