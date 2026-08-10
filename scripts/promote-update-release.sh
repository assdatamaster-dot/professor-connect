#!/bin/sh
set -eu

base_path=${1:-}
archive_path=${2:-}
version=${3:-}
git_sha=${4:-}
expected_archive_sha256=${5:-}
retention=${6:-3}

fail() {
  printf 'UPDATE_PROMOTION_FAILED: %s\n' "$1" >&2
  exit 1
}

case "$base_path" in
  /*) ;;
  *) fail 'UPDATE_DEPLOY_PATH deve ser absoluto' ;;
esac
case "$base_path" in
  /|*/../*|*/..|*' '*) fail 'UPDATE_DEPLOY_PATH inseguro' ;;
esac
case "$archive_path" in
  /tmp/professor-connect-*.tgz) ;;
  *) fail 'arquivo de entrada fora do diretório temporário permitido' ;;
esac
case "$version" in
  *[!0-9A-Za-z.+-]*|'') fail 'versão inválida' ;;
esac
case "$git_sha" in
  *[!0-9a-f]*|'') fail 'Git SHA inválido' ;;
esac
case "$expected_archive_sha256" in
  *[!0-9a-f]*|'') fail 'SHA-256 do pacote inválido' ;;
esac
case "$retention" in
  *[!0-9]*|'') fail 'retenção inválida' ;;
esac
[ "$retention" -ge 2 ] || fail 'retenção deve preservar ao menos current e previous'

for command_name in tar sha256sum openssl base64 stat sed grep find readlink ln mv diff sort tr mkdir rm; do
  command -v "$command_name" >/dev/null 2>&1 || fail "comando ausente no servidor: $command_name"
done
[ -f "$archive_path" ] || fail 'pacote transferido não encontrado'

actual_archive_sha256=$(sha256sum "$archive_path" | sed 's/[[:space:]].*$//')
[ "$actual_archive_sha256" = "$expected_archive_sha256" ] || fail 'SHA-256 do pacote transferido diverge'
unexpected_entries=$(tar -tzf "$archive_path" | grep -Ev '^(teacher|student)(/.*)?$|^release-report\.(json|md)$|^SHA256SUMS\.txt$' || true)
[ -z "$unexpected_entries" ] || fail 'pacote contém caminhos fora do payload permitido'
unsafe_entries=$(tar -tzf "$archive_path" | grep -E '(^/|(^|/)\.\.(/|$)|\\)' || true)
[ -z "$unsafe_entries" ] || fail 'pacote contém caminho inseguro'

release_key="${version}-${git_sha}"
staging_root="$base_path/.staging/$release_key"
release_root="$base_path/.releases/$release_key"

mkdir -p "$base_path/.staging" "$base_path/.releases"
if [ -e "$staging_root" ]; then
  case "$staging_root" in
    "$base_path/.staging/"*) rm -rf -- "$staging_root" ;;
    *) fail 'staging fora do caminho autorizado' ;;
  esac
fi
mkdir -p "$staging_root"
trap 'rm -f -- "$archive_path"; if [ -d "$staging_root" ]; then rm -rf -- "$staging_root"; fi' EXIT HUP INT TERM
tar -xzf "$archive_path" -C "$staging_root"
if find "$staging_root" -type l | grep -q .; then
  fail 'pacote contém link simbólico inesperado'
fi

validate_application() {
  application=$1
  application_root="$staging_root/$application"
  manifest="$application_root/latest.yml"
  release_info="$application_root/release-info.json"

  [ -f "$manifest" ] || fail "$application: latest.yml ausente"
  [ -f "$release_info" ] || fail "$application: release-info.json ausente"
  [ -f "$application_root/beta.yml" ] || fail "$application: beta.yml ausente"
  [ -f "$application_root/alpha.yml" ] || fail "$application: alpha.yml ausente"

  manifest_version=$(sed -n 's/^version:[[:space:]]*//p' "$manifest" | sed -n '1p')
  artifact=$(sed -n 's/^path:[[:space:]]*//p' "$manifest" | sed -n '1p')
  expected_sha512=$(sed -n 's/^sha512:[[:space:]]*//p' "$manifest" | sed -n '1p')
  expected_size=$(sed -n 's/^[[:space:]]*size:[[:space:]]*//p' "$manifest" | sed -n '1p')

  [ "$manifest_version" = "$version" ] || fail "$application: versão do manifesto divergente"
  case "$artifact" in
    ''|*/*|*\\*|..*) fail "$application: nome de artefato inseguro" ;;
  esac
  artifact_path="$application_root/$artifact"
  [ -f "$artifact_path" ] || fail "$application: instalador ausente"
  [ -f "$artifact_path.blockmap" ] || fail "$application: blockmap ausente"
  actual_size=$(stat -c '%s' "$artifact_path")
  [ "$actual_size" = "$expected_size" ] || fail "$application: tamanho divergente"
  actual_sha512=$(openssl dgst -sha512 -binary "$artifact_path" | base64 | tr -d '\r\n')
  [ "$actual_sha512" = "$expected_sha512" ] || fail "$application: SHA-512 divergente"

  grep -Fq "\"application\": \"$application\"" "$release_info" || fail "$application: identidade inválida"
  grep -Fq "\"version\": \"$version\"" "$release_info" || fail "$application: versão do release-info divergente"
  grep -Fq "\"gitSha\": \"$git_sha\"" "$release_info" || fail "$application: Git SHA divergente"
  grep -Fq '"dirty": false' "$release_info" || fail "$application: build dirty recusado"
}

validate_application teacher
validate_application student

if [ -e "$release_root" ]; then
  diff -qr "$staging_root" "$release_root" >/dev/null 2>&1 || fail 'a mesma versão/SHA já existe com conteúdo diferente'
  rm -rf -- "$staging_root"
else
  mv -- "$staging_root" "$release_root"
fi

for application in teacher student; do
  live_path="$base_path/$application"
  if [ -e "$live_path" ] && [ ! -L "$live_path" ]; then
    fail "$application já existe como diretório real; faça a migração inicial para symlink"
  fi
done

previous_key=$(sed -n '1p' "$base_path/.current-release" 2>/dev/null || true)
case "$previous_key" in
  *[!0-9A-Za-z.+-]*) fail 'identidade da release atual é inválida' ;;
esac

if [ ! -L "$base_path/teacher" ]; then
  ln -s '.current/teacher' "$base_path/teacher"
fi
if [ ! -L "$base_path/student" ]; then
  ln -s '.current/student' "$base_path/student"
fi
[ "$(readlink "$base_path/teacher")" = '.current/teacher' ] || fail 'symlink Teacher não pertence ao layout atômico esperado'
[ "$(readlink "$base_path/student")" = '.current/student' ] || fail 'symlink Student não pertence ao layout atômico esperado'

rm -f -- "$base_path/.current.next.$release_key"
ln -s ".releases/$release_key" "$base_path/.current.next.$release_key"
mv -Tf "$base_path/.current.next.$release_key" "$base_path/.current"
printf '%s\n' "$release_key" >"$base_path/.current-release.next"
mv -Tf "$base_path/.current-release.next" "$base_path/.current-release"
if [ -n "$previous_key" ] && [ "$previous_key" != "$release_key" ]; then
  printf '%s\n' "$previous_key" >"$base_path/.previous-release.next"
  mv -Tf "$base_path/.previous-release.next" "$base_path/.previous-release"
elif [ -z "$previous_key" ]; then
  rm -f -- "$base_path/.previous-release"
fi

kept=0
additional_retention=$((retention - 2))
for directory in $(find "$base_path/.releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | sed 's/^[^ ]* //'); do
  key=${directory##*/}
  if [ "$key" = "$release_key" ] || [ "$key" = "$previous_key" ]; then
    continue
  fi
  kept=$((kept + 1))
  if [ "$kept" -gt "$additional_retention" ]; then
    case "$directory" in
      "$base_path/.releases/"*) rm -rf -- "$directory" ;;
      *) fail 'retenção tentou acessar caminho não autorizado' ;;
    esac
  fi
done

trap - EXIT HUP INT TERM
rm -f -- "$archive_path"
printf 'UPDATE_PROMOTION_OK version=%s gitSha=%s\n' "$version" "$git_sha"
