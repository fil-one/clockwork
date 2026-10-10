#!/bin/sh
# Entry point the git hooks use to run lefthook (the `lefthook` key in
# lefthook.yml). --no-stage-fixed stops lefthook from moving the unstaged part
# of partially staged files into a "lefthook auto backup" git stash entry
# during pre-commit; every worktree shares the git stash.
bin="$(cd "$(dirname "$0")/.." && pwd)/node_modules/.bin/lefthook"
if [ ! -x "$bin" ]; then
  echo "lefthook: $bin not found. Run pnpm install, or commit with LEFTHOOK=0 to skip hooks." >&2
  exit 1
fi
exec "$bin" "$@" --no-stage-fixed
