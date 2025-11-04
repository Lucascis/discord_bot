# Discord Music Bot - Production Deployment Script (PowerShell)
# Version: 1.0.0
# Last Updated: November 3, 2025

$ErrorActionPreference = "Stop"

# Script header
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🚀 Discord Music Bot - Production Deploy" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

function Log-Info {
    param($Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Blue
}

function Log-Success {
    param($Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Log-Warning {
    param($Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Log-Error {
    param($Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

# 1. Pre-deployment checks
Log-Info "Running pre-deployment checks..."

# Check if .env exists
if (-not (Test-Path ".env")) {
    Log-Error ".env file not found!"
    Log-Info "Please create .env from .env.example:"
    Log-Info "  Copy-Item .env.example .env"
    Log-Info "  # Edit .env with your production values"
    exit 1
}
Log-Success ".env file exists"

# Check if Docker is running
try {
    docker info | Out-Null
    Log-Success "Docker is running"
} catch {
    Log-Error "Docker is not running!"
    Log-Info "Please start Docker Desktop and try again"
    exit 1
}

# Check if docker-compose is available
try {
    docker-compose version | Out-Null
    Log-Success "docker-compose is available"
} catch {
    Log-Error "docker-compose not found!"
    Log-Info "Please install Docker Compose v2+"
    exit 1
}

# Check required environment variables
Log-Info "Validating environment variables..."
Get-Content .env | ForEach-Object {
    if ($_ -match "^DISCORD_TOKEN=(.+)$") {
        if ($matches[1] -eq "your-bot-token") {
            Log-Error "DISCORD_TOKEN is not set!"
            Log-Info "Please update .env with your Discord bot token"
            exit 1
        }
    }
    if ($_ -match "^DISCORD_APPLICATION_ID=(.+)$") {
        if ($matches[1] -eq "your-application-id") {
            Log-Error "DISCORD_APPLICATION_ID is not set!"
            Log-Info "Please update .env with your Discord application ID"
            exit 1
        }
    }
}
Log-Success "Required environment variables are set"

# 2. Build Docker images
Log-Info "Building Docker images (this may take a few minutes)..."
docker-compose build --no-cache
if ($LASTEXITCODE -ne 0) {
    Log-Error "Docker build failed!"
    exit 1
}
Log-Success "Docker images built successfully"

# 3. Stop existing services (if running)
Log-Info "Stopping existing services..."
docker-compose down --remove-orphans 2>$null
Log-Success "Existing services stopped"

# 4. Start services
Log-Info "Starting all services..."
docker-compose up -d
if ($LASTEXITCODE -ne 0) {
    Log-Error "Failed to start services!"
    exit 1
}
Log-Success "Services started"

# 5. Wait for services to be ready
Log-Info "Waiting for services to be healthy (this may take up to 2 minutes)..."
Start-Sleep -Seconds 10

# Wait for PostgreSQL
Log-Info "Waiting for PostgreSQL..."
$timeout = 60
$counter = 0
while ($counter -lt $timeout) {
    try {
        docker-compose exec -T postgres pg_isready -U postgres 2>$null | Out-Null
        break
    } catch {
        Start-Sleep -Seconds 2
        $counter += 2
    }
}
if ($counter -ge $timeout) {
    Log-Error "PostgreSQL failed to start within $timeout seconds"
    docker-compose logs postgres
    exit 1
}
Log-Success "PostgreSQL is ready"

# Wait for Redis
Log-Info "Waiting for Redis..."
$counter = 0
while ($counter -lt $timeout) {
    try {
        docker-compose exec -T redis redis-cli ping 2>$null | Out-Null
        break
    } catch {
        Start-Sleep -Seconds 2
        $counter += 2
    }
}
if ($counter -ge $timeout) {
    Log-Error "Redis failed to start within $timeout seconds"
    docker-compose logs redis
    exit 1
}
Log-Success "Redis is ready"

# Wait for Lavalink
Log-Info "Waiting for Lavalink..."
$counter = 0
while ($counter -lt 90) {
    try {
        Invoke-WebRequest -Uri "http://localhost:2333/version" -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null
        break
    } catch {
        Start-Sleep -Seconds 3
        $counter += 3
    }
}
if ($counter -ge 90) {
    Log-Error "Lavalink failed to start within 90 seconds"
    docker-compose logs lavalink
    exit 1
}
Log-Success "Lavalink is ready"

# 6. Verify all services are healthy
Log-Info "Verifying service health..."

# Check Gateway
try {
    Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -ErrorAction Stop | Out-Null
    Log-Success "Gateway service is healthy"
} catch {
    Log-Warning "Gateway health check failed - checking logs..."
    docker-compose logs --tail=20 gateway
}

# Check Audio
try {
    Invoke-WebRequest -Uri "http://localhost:3002/health" -UseBasicParsing -ErrorAction Stop | Out-Null
    Log-Success "Audio service is healthy"
} catch {
    Log-Warning "Audio health check failed - checking logs..."
    docker-compose logs --tail=20 audio
}

# Check API
try {
    Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -ErrorAction Stop | Out-Null
    Log-Success "API service is healthy"
} catch {
    Log-Warning "API health check failed - checking logs..."
    docker-compose logs --tail=20 api
}

# Check Worker
try {
    Invoke-WebRequest -Uri "http://localhost:3003/health" -UseBasicParsing -ErrorAction Stop | Out-Null
    Log-Success "Worker service is healthy"
} catch {
    Log-Warning "Worker health check failed - checking logs..."
    docker-compose logs --tail=20 worker
}

# 7. Display service status
Write-Host ""
Log-Info "Service status:"
docker-compose ps

# 8. Display helpful information
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Log-Success "Deployment completed successfully!"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Log-Info "Next steps:"
Write-Host "  1. Check bot is online in Discord"
Write-Host "  2. Test /play command"
Write-Host "  3. Monitor logs: docker-compose logs -f"
Write-Host ""
Log-Info "Useful commands:"
Write-Host "  View logs:        docker-compose logs -f [service]"
Write-Host "  Restart service:  docker-compose restart [service]"
Write-Host "  Stop all:         docker-compose down"
Write-Host "  Service status:   docker-compose ps"
Write-Host ""
Log-Info "Health check URLs:"
Write-Host "  Gateway:  http://localhost:3001/health"
Write-Host "  Audio:    http://localhost:3002/health"
Write-Host "  API:      http://localhost:3000/health"
Write-Host "  Worker:   http://localhost:3003/health"
Write-Host "  Lavalink: http://localhost:2333/version"
Write-Host ""
Log-Success "Happy music streaming! 🎵"
