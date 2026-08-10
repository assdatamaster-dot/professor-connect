#!/bin/sh
set -eu

base_path=${1:-}
target_key=${2:-}

fail() {
  printf 'UPDATE_ROLLBACK_FAILED: %s\n' "$1" >&2
  exit 1
}

case "$base_path" in
  /*) ;;
  *) fail 'UPDATE_DEPLOY_PATH deve ser absoluto' ;;
esac
case "$base_path" in
  /|*/../*|*/..|*' '*) fail 'UPDATE_DEPLOY_PATH inseguro' ;;
esac

current_key=$(cat "$base_path/.current-release" 2>/dev/null || true)
if [ -z "$target_key" ]; then
  target_key=$(cat "$base_path/.previous-release" 2>/dev/null || true)
fi
case "$target_key" in
  *[!0-9A-Za-z.+-]*|'') fail 'release de rollback inválida ou ausente' ;;
esac

release_root="$base_path/.releases/$target_key"
[ -d "$release_root/teacher" ] || fail 'Teacher da release alvo não encontrado'
[ -d "$release_root/student" ] || fail 'Student da release alvo não encontrado'
[ -f "$release_root/teacher/latest.yml" ] || fail 'manifesto Teacher ausente'
[ -f "$release_root/student/latest.yml" ] || fail 'manifesto Student ausente'

[ -L "$base_path/teacher" ] || fail 'symlink Teacher ausente'
[ "$(readlink "$base_path/teacher")" = '.current/teacher' ] || fail 'symlink Teacher inválido'
[ -L "$base_path/student" ] || fail 'symlink Student ausente'
[ "$(readlink "$base_path/student")" = '.current/student' ] || fail 'symlink Student inválido'

rm -f -- "$base_path/.current.rollback.$target_key"
ln -s ".releases/$target_key" "$base_path/.current.rollback.$target_key"
mv -Tf "$base_path/.current.rollback.$target_key" "$base_path/.current"
printf '%s\n' "$target_key" >"$base_path/.current-release.rollback"
mv -Tf "$base_path/.current-release.rollback" "$base_path/.current-release"
if [ -n "$current_key" ] && [ "$current_key" != "$target_key" ]; then
  printf '%s\n' "$current_key" >"$base_path/.previous-release.rollback"
  mv -Tf "$base_path/.previous-release.rollback" "$base_path/.previous-release"
fi

printf 'UPDATE_ROLLBACK_OK target=%s previous=%s\n' "$target_key" "$current_key"
