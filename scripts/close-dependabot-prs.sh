#!/bin/bash

# Close all open Dependabot PRs
# This script will close all Dependabot PRs and let the new monthly schedule create fresh ones

echo "🧹 Closing all open Dependabot PRs..."

# Get list of Dependabot PR numbers
pr_numbers=$(gh pr list --state open --author "app/dependabot" --json number --jq '.[].number')

if [ -z "$pr_numbers" ]; then
    echo "✅ No Dependabot PRs found to close"
    exit 0
fi

# Close each PR
for pr in $pr_numbers; do
    echo "Closing PR #$pr..."
    gh pr close $pr --comment "🤖 Closing to reset Dependabot schedule - new PRs will be created monthly"
done

echo "✅ All Dependabot PRs have been closed"
echo "📅 Next Dependabot PRs will be created on the first Monday of next month"