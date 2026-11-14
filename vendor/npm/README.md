# Vendored npm packages

`@myavenceo/aven-ceo` 0.13.2 and `@myavenceo/aven-vibes` 0.9.5 were published to GitHub
Packages under the `@myavenceo` scope. Since the organization became MaiaCityCoop, that scope no
longer resolves (`npm package "aven-ceo" does not exist under owner "myavenceo"`), so every
fresh install failed.

These tarballs are the published packages, repacked unchanged from the installed copies of the
locked versions. `package.json` files depend on them with `file:`, and the root `overrides`
point `aven-ceo`'s own dependency on `aven-vibes` here too. bun extracts them into
`node_modules` like registry packages, so images that copy only `node_modules` still work.

This is temporary. Once the packages are published under the new scope, depend on the
published versions again and delete this directory.
