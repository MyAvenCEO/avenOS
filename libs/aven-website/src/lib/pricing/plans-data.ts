/**
 * The pricing SSOT moved into the brand package (card 0162) — one config for
 * the website's product pages, the id service's Polar product sync, and the
 * app's billing pane. This file stays as a thin re-export so the website's
 * internal `./plans-data` imports keep working.
 */

export * from '@avenos/aven-brand/pricing'
