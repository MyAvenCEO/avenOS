FROM alpine:3.20
RUN apk add --no-cache dovecot
ENTRYPOINT ["dovecot", "-F", "-c", "/fixture/dovecot.conf"]
