/** Some providers put leading reasoning envelopes in content instead of a
 * separate reasoning field. Never show that envelope, even across SSE fragments.
 * Once ordinary answer text starts, preserve all subsequent literal markup. */
export class VisibleModelText {
	#buffer = ''
	#closing = ''
	#visible = false
	push(text: string): string {
		if (this.#visible) return text
		this.#buffer += text
		for (;;) {
			if (this.#closing) {
				const at = this.#buffer.indexOf(this.#closing)
				if (at < 0) {
					this.#buffer = this.#buffer.slice(-(this.#closing.length - 1))
					return ''
				}
				this.#buffer = this.#buffer.slice(at + this.#closing.length)
				this.#closing = ''
			}
			const prefix = this.#buffer.trimStart()
			const opening = ['<think>', '<thinking>'].find((tag) => prefix.startsWith(tag))
			if (opening) {
				this.#buffer = prefix.slice(opening.length)
				this.#closing = opening.replace('<', '</')
				continue
			}
			if (!prefix || ['<think>', '<thinking>'].some((tag) => tag.startsWith(prefix))) return ''
			this.#visible = true
			const answer = this.#buffer
			this.#buffer = ''
			return answer
		}
	}
}
