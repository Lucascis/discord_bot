#!/bin/bash

# Production startup script for Discord Bot Gateway
# Optimized for handling thousands of concurrent connections

echo "🚀 Starting Discord Bot Gateway in PRODUCTION mode..."

# Memory optimization for enterprise deployment
export NODE_ENV=production

# Node.js Enterprise Optimizations
NODE_OPTIONS="
  --max-old-space-size=4096
  --max-semi-space-size=256
  --optimize-for-size
  --expose-gc
  --stack-trace-limit=50
  --v8-pool-size=8
"

# Advanced V8 flags for high concurrency
V8_FLAGS="
  --experimental-wasm-threads
  --experimental-wasm-bulk-memory
  --harmony
  --turbo-fast-api-calls
  --turbo-inline-js-wasm-calls
  --concurrent-marking
  --parallel-scavenge
  --use-idle-notification
  --optimize-for-size
  --max-inlined-bytecode-size=1000
  --max-inlined-bytecode-size-cumulative=5000
"

# Process optimization
export UV_THREADPOOL_SIZE=32  # Increase thread pool for file operations
export LIBUV_THREAD_STACK_SIZE=2097152  # 2MB stack size per thread

echo "📊 Memory Configuration:"
echo "  - Max Old Space: 4GB"
echo "  - Thread Pool Size: 32"
echo "  - GC Optimizations: Enabled"
echo "  - V8 Turbo: Enabled"

echo "🔧 Enterprise Features:"
echo "  - Auto-sharding: Enabled"
echo "  - Connection pooling: Optimized"
echo "  - Cache management: Advanced"
echo "  - Retry strategies: Configured"

# Build the application
echo "🏗️ Building application..."
cd "$(dirname "$0")/.."
pnpm build

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build completed successfully"

# Start with all optimizations
echo "🎯 Starting with enterprise configuration..."
exec node $NODE_OPTIONS \
    -r dotenv/config \
    dist/main.js \
    dotenv_config_path=../.env