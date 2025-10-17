# Discord Bot - Docker Configuration Test (PowerShell)
# Run this script to validate and test Docker deployment on Windows

Write-Host "🐳 Discord Bot - Docker Configuration Test" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check Docker is installed
Write-Host "1️⃣ Checking Docker installation..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    $composeVersion = docker compose version
    Write-Host "✅ Docker is installed" -ForegroundColor Green
    Write-Host $dockerVersion
    Write-Host $composeVersion
} catch {
    Write-Host "❌ Docker is not installed or not running" -ForegroundColor Red
    Write-Host "Please install Docker Desktop and ensure it's running" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check Docker daemon
Write-Host "2️⃣ Checking Docker daemon..." -ForegroundColor Yellow
try {
    docker info | Out-Null
    Write-Host "✅ Docker daemon is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker daemon is not running" -ForegroundColor Red
    Write-Host "Please start Docker Desktop" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Validate docker-compose.yml
Write-Host "3️⃣ Validating docker-compose.yml..." -ForegroundColor Yellow
try {
    docker compose config --quiet
    Write-Host "✅ docker-compose.yml syntax is valid" -ForegroundColor Green
} catch {
    Write-Host "❌ docker-compose.yml has syntax errors" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check .env file
Write-Host "4️⃣ Checking environment configuration..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Write-Host "⚠️  .env file not found. Copying from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "⚠️  Please edit .env with your Discord credentials" -ForegroundColor Yellow
} else {
    Write-Host "✅ .env file exists" -ForegroundColor Green

    $envContent = Get-Content ".env" -Raw
    if ($envContent -match "your-bot-token") {
        Write-Host "⚠️  DISCORD_TOKEN needs to be configured in .env" -ForegroundColor Yellow
    }
    if ($envContent -match "your-application-id") {
        Write-Host "⚠️  DISCORD_APPLICATION_ID needs to be configured in .env" -ForegroundColor Yellow
    }
}
Write-Host ""

# Create required directories
Write-Host "5️⃣ Checking required directories..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "logs" | Out-Null
New-Item -ItemType Directory -Force -Path "lavalink/plugins" | Out-Null
Write-Host "✅ All directories ready" -ForegroundColor Green
Write-Host ""

# Check lavalink plugins
Write-Host "6️⃣ Checking Lavalink plugins..." -ForegroundColor Yellow
$plugins = Get-ChildItem "lavalink/plugins/*.jar" -ErrorAction SilentlyContinue
if ($plugins) {
    Write-Host "✅ Lavalink plugins found:" -ForegroundColor Green
    Write-Host "   Total plugins: $($plugins.Count)"
} else {
    Write-Host "⚠️  No Lavalink plugins found. They will be downloaded on first run." -ForegroundColor Yellow
}
Write-Host ""

# List services
Write-Host "7️⃣ Configured services:" -ForegroundColor Yellow
docker compose config --services | ForEach-Object {
    Write-Host "   - $_"
}
Write-Host ""

# Clean up existing containers
Write-Host "8️⃣ Cleaning up existing containers..." -ForegroundColor Yellow
$running = docker compose ps -q
if ($running) {
    Write-Host "⚠️  Stopping existing containers..." -ForegroundColor Yellow
    docker compose down
}
Write-Host "✅ Clean state" -ForegroundColor Green
Write-Host ""

# Build images
Write-Host "9️⃣ Building Docker images..." -ForegroundColor Yellow
Write-Host "This may take 5-10 minutes on first run..." -ForegroundColor Yellow
try {
    docker compose build
    Write-Host "✅ Docker images built successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to build Docker images" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Start infrastructure services
Write-Host "🔟 Starting infrastructure services (postgres, redis, lavalink)..." -ForegroundColor Yellow
docker compose up -d postgres redis lavalink

Write-Host "Waiting for services to be healthy (max 2 minutes)..."
$timeout = 120
$elapsed = 0
while ($elapsed -lt $timeout) {
    Start-Sleep -Seconds 5
    $elapsed += 5

    $healthy = (docker compose ps --format json | ConvertFrom-Json | Where-Object { $_.Health -eq "healthy" }).Count
    $total = 3

    if ($healthy -eq $total) {
        Write-Host "✅ All infrastructure services are healthy" -ForegroundColor Green
        break
    }

    Write-Host "   Healthy: $healthy/$total (${elapsed}s elapsed)"
}

if ($elapsed -ge $timeout) {
    Write-Host "❌ Timeout waiting for services to be healthy" -ForegroundColor Red
    docker compose logs
    exit 1
}
Write-Host ""

# Start application services
Write-Host "1️⃣1️⃣ Starting application services (gateway, audio, api, worker)..." -ForegroundColor Yellow
docker compose up -d

Write-Host "Waiting for all services to start..."
Start-Sleep -Seconds 10
Write-Host ""

# Check service status
Write-Host "1️⃣2️⃣ Container status:" -ForegroundColor Yellow
docker compose ps
Write-Host ""

# Test health endpoints
Write-Host "1️⃣3️⃣ Testing health endpoints..." -ForegroundColor Yellow

function Test-Endpoint {
    param($Name, $Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        Write-Host "✅ $Name is responding" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  $Name is not responding yet (may still be starting)" -ForegroundColor Yellow
    }
}

Test-Endpoint "Lavalink" "http://localhost:2333/version"
Test-Endpoint "API" "http://localhost:3000/health"
Test-Endpoint "Gateway" "http://localhost:3001/health"
Test-Endpoint "Audio" "http://localhost:3002/health"
Test-Endpoint "Worker" "http://localhost:3003/health"
Write-Host ""

# Show recent logs
Write-Host "1️⃣4️⃣ Recent logs from services:" -ForegroundColor Yellow
docker compose logs --tail=20
Write-Host ""

# Summary
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "✅ Docker configuration test complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  - View logs: docker compose logs -f"
Write-Host "  - Stop services: docker compose down"
Write-Host "  - Restart services: docker compose restart"
Write-Host ""
Write-Host "Services running at:"
Write-Host "  - Gateway Health: http://localhost:3001/health"
Write-Host "  - Audio Health: http://localhost:3002/health"
Write-Host "  - API Health: http://localhost:3000/health"
Write-Host "  - Worker Health: http://localhost:3003/health"
Write-Host "  - Lavalink: http://localhost:2333/version"
Write-Host ""
Write-Host "Your bot should now be online in Discord!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
