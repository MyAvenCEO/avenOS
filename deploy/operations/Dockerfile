FROM postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73

ARG OS_SECURITY_REFRESH=local
RUN test -n "$OS_SECURITY_REFRESH" && apk upgrade --no-cache && apk add --no-cache ca-certificates restic tzdata jq

WORKDIR /operations
COPY deploy/operations/backup.sh deploy/operations/restore.sh deploy/operations/entrypoint.sh deploy/operations/healthcheck.sh ./
RUN chmod 0555 ./*.sh

COPY deploy/identity /release/deploy/identity
COPY deploy/platform /release/deploy/platform
COPY deploy/runtime/identity.py deploy/runtime/host.py deploy/runtime/initialize.py deploy/runtime/prepare.py deploy/runtime/rollout.py deploy/runtime/start.py deploy/runtime/recover.py deploy/runtime/db-init.sh /release/deploy/runtime/
COPY deploy/release/archive.py /release/deploy/release/archive.py
RUN printf '1\n' > /release/contract-version

USER 65532:65532
ENTRYPOINT ["/operations/entrypoint.sh"]
