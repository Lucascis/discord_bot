#!/bin/sh
if [ -z "$husky_skip_init" ]; then
  debug () {
    [ "$HUSKY_DEBUG" = "1" ] && echo "$1"
  }

  readonly hook_name="$(basename "$0")"
  debug "husky:starting $hook_name hook"

  if [ "$HUSKY" = "0" ]; then
    debug "husky:skipping hook (HUSKY=0)"
    exit 0
  fi

  readonly husky_dir="$(cd "$(dirname "$0")/.." && pwd)"
  readonly husky_root="$(cd "$husky_dir/.." && pwd)"
  readonly husky_skip_init=1
  export husky_skip_init

  sh -e "$husky_dir/$hook_name" "$@"
  exitCode="$?"

  if [ $exitCode != 0 ]; then
    echo "husky - $hook_name hook exited with code $exitCode (error)"
  fi

  exit $exitCode
fi
