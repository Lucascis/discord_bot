#!/bin/bash
# Discord Bot - Test Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[ℹ]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_info "Discord Bot - Running Tests"
echo "================================"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    print_status "Installing dependencies..."
    pnpm install
fi

# Start test infrastructure
print_status "Starting test infrastructure (PostgreSQL, Redis)..."
docker compose -f docker-compose.test.yml up -d postgres-test redis-test

# Wait for services
print_status "Waiting for test services to be ready..."
sleep 5

# Run database setup for tests
print_status "Setting up test database..."
export NODE_ENV=test
export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/discord_bot_test"
export REDIS_URL="redis://localhost:6380"

pnpm --filter @discord-bot/database prisma migrate deploy
pnpm --filter @discord-bot/database prisma db seed

# Run TypeScript compilation check
print_status "Running TypeScript type checking..."
if ! pnpm typecheck; then
    print_error "TypeScript type checking failed!"
    docker compose -f docker-compose.test.yml down
    exit 1
fi

# Run ESLint
print_status "Running ESLint..."
if ! pnpm lint --max-warnings 0; then
    print_warning "ESLint found issues. Continuing with tests..."
fi

# Run tests
print_status "Running test suite..."
if pnpm test; then
    print_status "All tests passed!"
    TEST_RESULT=0
else
    print_error "Some tests failed!"
    TEST_RESULT=1
fi

# Generate test coverage report
print_status "Generating coverage report..."
pnpm test --coverage || true

# Cleanup test infrastructure
print_status "Cleaning up test infrastructure..."
docker compose -f docker-compose.test.yml down

echo ""
if [ $TEST_RESULT -eq 0 ]; then
    print_status "✨ All tests completed successfully!"
else
    print_error "❌ Tests failed. Please check the output above."
fi

exit $TEST_RESULT