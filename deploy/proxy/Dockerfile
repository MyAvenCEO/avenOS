FROM caddy:2.11.6-alpine@sha256:d44355d3c2149dc580ce2cac735955d1c08d3d00882c30489c241aa51a5c10d9
ARG OS_SECURITY_REFRESH=local
RUN test -n "$OS_SECURITY_REFRESH" && apk upgrade --no-cache
