<script lang="ts">
/**
 * The avenOS brandmark — the clean logo shape, no app-icon rectangle around it.
 * Single source of truth: `app/static/aven-logo.svg` (the app icon adds the
 * rounded card behind it, see `app/src-tauri/icons/app-icon-source.svg`).
 */
type Props = {
	/** Extra classes on the `<img>` (sizing lives with the caller). */
	class?: string
	/** Decorative by default; pass a label when the mark carries meaning. */
	alt?: string
}

const { class: className = 'h-12 w-auto', alt = '' }: Props = $props()
</script>

<img src="/aven-logo.svg" {alt} class={className} aria-hidden={alt ? undefined : 'true'}>
