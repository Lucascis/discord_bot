# 📁 Project Structure

**Last Updated**: November 22, 2025
**Status**: ✅ Synced with current repo

---

## Root Directory (high‑level)

- `README.md` – Overview and quick start
- `Dockerfile`, `docker-compose*.yml` – Build and local orchestration
- `package.json`, `pnpm-workspace.yaml` – Monorepo configuration
- `tsconfig*.json`, `vitest.config.ts` – TypeScript and testing configuration

---

## Complete Directory Structure

```
discord_bot/
│
├── 📚 docs/ - Detailed Documentation
│   ├── INDEX.md (Documentation index)
│   ├── ARCHITECTURE.md
│   ├── CONFIGURATION.md
│   ├── CONTRIBUTING.md
│   ├── DEVELOPMENT_GUIDE.md
│   ├── TESTING_GUIDE.md
│   ├── METRICS.md
│   ├── CHANGELOG.md
│   ├── DATABASE_MIGRATION_GUIDE.md
│   ├── DEPLOYMENT_GUIDE.md
│   ├── ENTERPRISE_BILLING_SYSTEM.md
│   ├── KUBERNETES_DEPLOYMENT_GUIDE.md
│   ├── MARKET_RESEARCH.md
│   ├── PROJECT_STRUCTURE.md
│   │
│   ├── architecture/
│   │
│   ├── commercial/
│   │   ├── FEATURES.md
│   │   └── PRICING.md
│   │
│   ├── guides/
│   │   ├── TROUBLESHOOTING.md
│   │   └── redis-cluster-setup.md
│   │
│   ├── operations/
│   │   ├── LAUNCH_CHECKLIST.md
│   │   ├── MULTI_INSTANCE_DEPLOYMENT.md
│   │   ├── SECURITY.md
│   │   └── runbook.md
│   │
│   └── reference/
│       └── API_REFERENCE.md
│
├── 🔧 scripts/ - Utility Scripts
│   ├── cleanup-guild-commands.mjs
│   ├── generate-perf-report.js
│   ├── patch-next-font.js
│   ├── performance-monitor.js
│   ├── prod.sh
│   ├── start-all.sh
│   └── stop.sh
│
├── 🎮 gateway/ - Discord Bot Service
│   ├── src/
│   ├── dist/ (generated)
│   ├── package.json
│   └── tsconfig.json
│
├── 🎵 audio/ - Music Playback Service
│   ├── src/
│   ├── dist/ (generated)
│   ├── package.json
│   └── tsconfig.json
│
├── 🌐 api/ - REST API Service
│   ├── src/
│   ├── test/
│   ├── dist/ (generated)
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── ⚙️ worker/ - Background Jobs Service
│   ├── src/
│   ├── dist/ (generated)
│   ├── package.json
│   └── tsconfig.json
│
├── 📦 packages/ - Shared Libraries
│   ├── audio-control/
│   ├── cache/
│   ├── cluster/
│   ├── commands/
│   ├── config/
│   ├── cqrs/
│   ├── database/
│   ├── event-store/
│   ├── logger/
│   ├── observability/
│   ├── performance/
│   ├── subscription/
│   └── tsconfig/
│
├── 🎼 lavalink/ - Audio Server Config
│   ├── application.yml
│   ├── plugins/
│   └── README.md
│
└── 📁 .github/ - GitHub Configuration
    ├── workflows/
    └── SECURITY.md
```

---

## Organization Rules

### Root Directory Should Contain:
✅ Essential quick-start documentation
✅ Deployment guides
✅ Project status and reports
✅ Configuration files (Docker, package.json, etc.)

### Root Directory Should NOT Contain:
❌ Service-specific files
❌ Temporary/work-in-progress files
❌ Build artifacts (dist/, node_modules/)
❌ Test files
❌ Duplicate documentation
❌ Old/obsolete files

### docs/ Directory Should Contain:
✅ Detailed technical documentation
✅ Architecture documentation
✅ API reference
✅ Guides and tutorials
✅ Commercial/business documentation

### scripts/ Directory Should Contain:
✅ Shell scripts (.sh)
✅ Deployment scripts
✅ Utility scripts
✅ Development tools

---

## File Count Summary

| Location | File Count | Status |
|----------|-----------|--------|
| Root .md files | 2 | ✅ Essential only |
| Root config files | 28 | ✅ Required |
| docs/ | 35 | ✅ Organized |
| scripts/ | 7 | ✅ All .sh/.js/.mjs |
| Services (4) | Full source | ✅ Complete |
| Packages (13) | Full source | ✅ Complete |

**Total Root Files**: 30 (2 docs + 28 config)
**Status**: ✅ Clean and organized

---

## Quick Reference

### Main Documentation Files (Priority Order)

1. **docs/INDEX.md** - Documentation Home
2. **docs/DEVELOPMENT_GUIDE.md** - Setup and workflow
3. **docs/DEPLOYMENT_GUIDE.md** - Production deployment
4. **docs/CONFIGURATION.md** - Environment variables
5. **docs/ARCHITECTURE.md** - System design
6. **docs/TROUBLESHOOTING.md** - Common issues

---

## Verification Commands

```bash
# Verify structure
find . -maxdepth 1 -name "*.md"
find scripts -name "*.sh"

# Verify all packages
ls packages/

# Check Docker files
ls docker-compose*.yml
```

---

**Project is now clean, organized, and production-ready! 🎉**
