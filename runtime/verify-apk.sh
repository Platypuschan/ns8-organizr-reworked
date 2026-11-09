#!/bin/sh
# Rebuild targets, not an exact lockfile. Compare with apk's own version rules.
set -eu
manifest=${1:-/usr/local/share/organizr/apk-refresh.txt}
installed=$(mktemp)
targets=$(mktemp)
trap 'rm -f "$installed" "$targets"' EXIT
awk '/^P:/{p=substr($0,3)} /^V:/{print p "=" substr($0,3)}' /lib/apk/db/installed | sort > "$installed"
# Reject malformed/empty inventories and duplicate entries, never skip bad lines.
awk '
NR == 1 { if ($0 !~ /^# registry=https:\/\/dl-cdn.alpinelinux.org\/alpine\?branch=v[0-9]+\.[0-9]+\&components=main,community\&arch=x86_64$/) exit 1; next }
{ if ($0 !~ /^[a-z0-9][a-z0-9+_.-]*=[0-9][0-9a-zA-Z_.-]*-r[0-9]+$/) exit 1;
  split($0,a,"="); if (seen[a[1]]++) exit 1; print; count++ }
END { if (!count) exit 1 }
' "$manifest" > "$targets"
sort -o "$targets" "$targets"
branch=$(head -n 1 "$manifest" | sed 's/.*branch=\([^&]*\).*/\1/')
for component in main community; do
    grep -Fqx "https://dl-cdn.alpinelinux.org/alpine/$branch/$component" /etc/apk/repositories
done
[ "$(grep -cv '^#' /etc/apk/repositories)" -eq 2 ]
[ "$(apk --print-arch)" = x86_64 ]
[ "$(cut -d= -f1 "$installed")" = "$(cut -d= -f1 "$targets")" ] || {
    echo 'Installed package inventory changed: review and regenerate all targets' >&2; exit 1;
}
while IFS='=' read -r package target; do
    apk version --check "$target" >/dev/null
    actual=$(awk -F= -v p="$package" '$1==p {print $2}' "$installed")
    [ -n "$actual" ] && [ "$(apk version -t "$actual" "$target")" != '<' ] || {
        echo "APK target not reached: $package actual=$actual target=$target" >&2; exit 1;
    }
done < "$targets"
for php in php83 php83-fpm; do
    actual=$(awk -F= -v p="$php" '$1==p {print $2}' "$installed")
    [ -n "$actual" ] && [ "$(apk version -t "$actual" 8.3.36-r0)" != '<' ] || {
        echo 'PHP security floor violated' >&2; exit 1;
    }
done
# Optional baseline is either a raw installed snapshot or a previous manifest.
# Its targets and *all* installed versions must never be downgraded.
if [ "$#" -gt 1 ]; then
    while IFS='=' read -r package previous; do
        case "$package" in \#*|'') continue;; esac
        apk version --check "$previous" >/dev/null
        actual=$(awk -F= -v p="$package" '$1==p {print $2}' "$installed")
        [ -n "$actual" ] && [ "$(apk version -t "$actual" "$previous")" != '<' ] || {
            echo "APK downgrade/removal: $package $previous -> $actual" >&2; exit 1;
        }
    done < "$2"
fi
printf 'APK targets verified (%s installed packages)\n' "$(wc -l < "$installed")"
