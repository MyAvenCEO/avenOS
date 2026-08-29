FROM postgres:17-alpine

RUN apk add --no-cache ca-certificates restic tzdata

WORKDIR /operations
COPY deploy/operations/backup.sh deploy/operations/restore.sh deploy/operations/entrypoint.sh deploy/operations/healthcheck.sh ./
RUN chmod 0555 ./*.sh

USER 65532:65532
ENTRYPOINT ["/operations/entrypoint.sh"]
