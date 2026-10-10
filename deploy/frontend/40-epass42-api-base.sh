#!/bin/sh
# ePass 42 frontend entrypoint hook (runs before nginx starts).
#
# The SPA is built with the literal placeholder `__EPASS42_API_BASE__` as its
# public API base; replace it with the runtime $EPASS42_API_BASE in every page
# shell.  The value only appears in the Nuxt runtime-config block of the HTML
# files, so a plain text substitution is safe (no JavaScript assets are touched).
#
# Empty EPASS42_API_BASE means same-origin (the client calls the API on the
# frontend's own origin and the reverse proxy routes it).
set -eu

: "${EPASS42_API_BASE:=}"

# Escape the characters that are special in a sed replacement.
replacement=$(printf '%s' "$EPASS42_API_BASE" | sed -e 's/[\\&|]/\\&/g')

find /usr/share/nginx/html -type f -name '*.html' -exec \
    sed -i "s|__EPASS42_API_BASE__|${replacement}|g" {} \;

echo "epass42: frontend API base set to '${EPASS42_API_BASE}'"
