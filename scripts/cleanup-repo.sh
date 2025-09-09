#!/bin/bash

# Discord Bot Repository Cleanup Script
# This script helps maintain a professional GitHub repository

set -e

echo "🧹 Starting repository cleanup..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ️${NC} $1"
}

# Check if GitHub CLI is available
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed. Please install it first."
    print_info "Install with: brew install gh (macOS) or visit https://cli.github.com/"
    exit 1
fi

# Check if logged in to GitHub
if ! gh auth status &> /dev/null; then
    print_error "Not logged in to GitHub CLI. Please run 'gh auth login' first."
    exit 1
fi

print_info "Starting cleanup for repository: $(git remote get-url origin)"

# 1. Close and delete old Dependabot PRs (keeping only the latest ones)
echo ""
print_info "📋 Analyzing Dependabot PRs..."

# Get all Dependabot PRs
dependabot_prs=$(gh pr list --author "app/dependabot" --json number,title,createdAt --limit 50)

if [ "$dependabot_prs" != "[]" ]; then
    echo "$dependabot_prs" | jq -r '.[] | "\(.number) \(.title) \(.createdAt)"' | sort -k3 | head -n -5 | while read -r pr_number title created_at; do
        print_warning "Closing old Dependabot PR #$pr_number: $title"
        gh pr close "$pr_number" --comment "Closing old dependency update. Newer version available." --delete-branch || true
    done
    print_status "Cleaned up old Dependabot PRs"
else
    print_status "No Dependabot PRs to clean up"
fi

# 2. Check for merge conflicts in remaining PRs
echo ""
print_info "🔍 Checking for merge conflicts in remaining PRs..."

remaining_prs=$(gh pr list --json number,title,mergeable)
echo "$remaining_prs" | jq -r '.[] | select(.mergeable == "CONFLICTING") | "\(.number) \(.title)"' | while read -r pr_number title; do
    print_warning "PR #$pr_number has merge conflicts: $title"
    print_info "Consider resolving conflicts or closing: gh pr close $pr_number"
done

# 3. Run local quality checks
echo ""
print_info "🔧 Running local quality checks..."

if npm run lint > /dev/null 2>&1 || pnpm lint > /dev/null 2>&1; then
    print_status "Linting passed"
else
    print_error "Linting failed. Run 'pnpm lint' to see details."
fi

if npm run typecheck > /dev/null 2>&1 || pnpm typecheck > /dev/null 2>&1; then
    print_status "TypeScript checks passed"
else
    print_error "TypeScript checks failed. Run 'pnpm typecheck' to see details."
fi

if npm test > /dev/null 2>&1 || pnpm test > /dev/null 2>&1; then
    print_status "Tests passed"
else
    print_error "Tests failed. Run 'pnpm test' to see details."
fi

# 4. Check for secrets in repository
echo ""
print_info "🔒 Checking for potential secrets..."

# Check .env files
if find . -name ".env*" -not -path "./node_modules/*" -not -name ".env.example" | head -5 | grep -q ".env"; then
    print_warning "Found .env files in repository. Ensure they're in .gitignore:"
    find . -name ".env*" -not -path "./node_modules/*" -not -name ".env.example" | head -5
fi

# Check for common secret patterns
if grep -r -E "(token|key|secret|password)\s*=\s*['\"][^'\"]{10,}['\"]" . --include="*.js" --include="*.ts" --include="*.json" --exclude-dir=node_modules 2>/dev/null | head -5 | grep -q .; then
    print_warning "Found potential secrets in code. Review these matches:"
    grep -r -E "(token|key|secret|password)\s*=\s*['\"][^'\"]{10,}['\"]" . --include="*.js" --include="*.ts" --include="*.json" --exclude-dir=node_modules 2>/dev/null | head -5 || true
fi

# 5. Update repository settings recommendations
echo ""
print_info "⚙️ Repository Settings Recommendations:"
print_info "   - Enable branch protection on 'main' branch"
print_info "   - Require PR reviews before merging" 
print_info "   - Enable 'Automatically delete head branches'"
print_info "   - Set up Dependabot security updates"
print_info "   - Configure code scanning (CodeQL)"

# 6. Suggest README improvements
echo ""
print_info "📚 Documentation Recommendations:"
if [ ! -f "README.md" ] || [ $(wc -l < README.md) -lt 20 ]; then
    print_warning "README.md could be expanded with:"
    print_info "   - Clear setup instructions"
    print_info "   - Prerequisites and requirements"
    print_info "   - Usage examples"
    print_info "   - Contributing guidelines"
    print_info "   - License information"
fi

# 7. Check GitHub Actions status
echo ""
print_info "🚀 GitHub Actions Status:"
workflow_runs=$(gh run list --limit 5 --json status,conclusion,workflowName)
echo "$workflow_runs" | jq -r '.[] | "\(.workflowName): \(.status) (\(.conclusion // "running"))"' | while read -r line; do
    if echo "$line" | grep -q "failure"; then
        print_error "$line"
    elif echo "$line" | grep -q "success"; then
        print_status "$line"
    else
        print_warning "$line"
    fi
done

echo ""
print_status "Repository cleanup analysis complete!"
print_info "Next steps:"
print_info "  1. Review and merge good Dependabot PRs: gh pr list"
print_info "  2. Fix any failing CI/CD: gh run list"
print_info "  3. Configure branch protection: Settings > Branches"
print_info "  4. Review security alerts: Settings > Security & Analysis"

echo -e "${GREEN}🎉 Repository is ready for professional use!${NC}"