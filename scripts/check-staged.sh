#!/bin/sh
# Pre-commit checks on the staged content, the version a commit records.
# Usage: sh scripts/check-staged.sh format|secrets
#
# The hook never stashes (see scripts/lefthook.sh), so the working tree can
# differ from the index. This writes the staged version of each added, copied,
# modified or renamed file to a temporary directory that mirrors the repository,
# with the index's ignore files, and runs one tool there. The directory sits
# under node_modules so the tools resolve their plugins from this checkout.
set -eu

mode=$1
root=$(git rev-parse --show-toplevel)
cd "$root"

mkdir -p node_modules/.cache
mirror=$(mktemp -d "$root/node_modules/.cache/staged.XXXXXX")
trap 'rm -rf "$mirror"' EXIT

staged=$(git diff --cached --name-only --diff-filter=ACMR | wc -l)
[ "$staged" -gt 0 ] || exit 0

git diff --cached --name-only -z --diff-filter=ACMR |
  git checkout-index --prefix="$mirror/" -z --stdin
git ls-files -z -- .prettierignore .secretlintignore ':(glob)**/.gitignore' |
  git checkout-index --prefix="$mirror/" -f -z --stdin

cd "$mirror"
case "$mode" in
  format)
    "$root/node_modules/.bin/prettier" --check --ignore-unknown \
      --config "$root/prettier.config.mjs" .
    ;;
  secrets)
    "$root/node_modules/.bin/secretlint" \
      --secretlintrc "$root/.secretlintrc.json" \
      --secretlintignore .secretlintignore "**/*"
    ;;
  *)
    echo "usage: sh scripts/check-staged.sh format|secrets" >&2
    exit 2
    ;;
esac
