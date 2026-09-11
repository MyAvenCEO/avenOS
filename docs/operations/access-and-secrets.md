# Source build access

Status: authoritative

The application source repository holds no cloud installation environments or deployment
credentials. GitHub Actions builds and publishes application artifacts. The separate
private maintenance repository owns installation environments and provider credentials.

`PACKAGE_READ_TOKEN` downloads the private brand packages during dependency installation.
`GITHUB_TOKEN` supplies job-scoped repository/package access; publication jobs explicitly
request contents, package or attestation write permissions where required. The manifest
attestation also requires an OIDC identity. Development and verification jobs have no
installation environment and cannot access database, SSH, cloud, SMTP or backup secrets.

Use [Workstation setup](workstation-setup.md) for local package authentication. Client
publishing may use platform signing credentials as documented in
[Client releases](client-releases.md); those credentials do not grant cloud deployment
access. Never embed LLM provider keys or installation credentials in downloadable clients.
