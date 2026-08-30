import terminalKitImport from 'terminal-kit'

interface FormResult {
	submit: string
	fields: { answer: string }
}

interface TerminalDocument {
	destroy(): void
	giveFocusTo(element: unknown): void
}

interface TerminalForm {
	on(event: 'submit', listener: (result: FormResult) => void): void
}

interface TerminalApi {
	width: number
	height: number
	clear(): void
	hideCursor(hidden?: boolean): void
	grabInput(enabled: boolean | { mouse?: string }): void
	styleReset(): void
	on(event: 'key', listener: (key: string) => void): void
	off(event: 'key', listener: (key: string) => void): void
	createDocument(): TerminalDocument
}

interface TerminalKitApi {
	terminal: TerminalApi
	Text: new (options: Record<string, unknown>) => unknown
	TextBox: new (options: Record<string, unknown>) => unknown
	Form: new (options: Record<string, unknown>) => TerminalForm
}

const terminalKit = terminalKitImport as unknown as TerminalKitApi

export class TuiInterruptedError extends Error {
	constructor() {
		super('interrupted')
		this.name = 'TuiInterruptedError'
	}
}

function cleanLine(value: string): string {
	return value.replaceAll(/[\r\n\t]+/g, ' ').trim()
}

export function wrapTerminalText(value: string, width: number): string[] {
	if (!Number.isSafeInteger(width) || width < 10)
		throw new Error('Terminal text width is too small.')
	const lines: string[] = []
	for (const source of value.split('\n')) {
		let remaining = source.trimEnd()
		if (!remaining) {
			lines.push('')
			continue
		}
		while (remaining.length > width) {
			const candidate = remaining.slice(0, width + 1)
			const breakAt = candidate.lastIndexOf(' ')
			const take = breakAt > 0 ? breakAt : width
			lines.push(remaining.slice(0, take).trimEnd())
			remaining = remaining.slice(take).trimStart()
		}
		lines.push(remaining)
	}
	return lines
}

export class BootstrapTui {
	readonly #terminal = terminalKit.terminal
	#title = 'avenOS deployment bootstrap'
	#context = ''
	#status: string[] = []
	#active = false

	isSupported(): boolean {
		return this.#terminal.width >= 60 && this.#terminal.height >= 20
	}

	setContext(title: string, context: string): void {
		this.#title = cleanLine(title) || 'avenOS deployment bootstrap'
		this.#context = context.trim()
	}

	status(message: string): void {
		const normalized = cleanLine(message)
		if (!normalized) return
		this.#status.push(normalized)
		this.#status = this.#status.slice(-5)
	}

	async ask(input: { label: string; defaultValue?: string; secret?: boolean }): Promise<string> {
		if (this.#active) throw new Error('The terminal form is already active.')
		this.#active = true
		const terminal = this.#terminal
		terminal.clear()
		terminal.hideCursor(true)
		const document = terminal.createDocument()
		const width = Math.max(40, Math.min(100, terminal.width - 4))
		const x = Math.max(2, Math.floor((terminal.width - width) / 2) + 1)
		const status = this.#status.length > 0 ? `\n\nRecent checks\n${this.#status.join('\n')}` : ''
		const body = `${this.#context}${status}`.trim()
		const wrappedBody = wrapTerminalText(body, width)
		const bodyHeight = Math.max(3, Math.min(terminal.height - 9, wrappedBody.length))
		const visibleBody = wrappedBody.slice(0, bodyHeight)
		if (wrappedBody.length > bodyHeight)
			visibleBody[bodyHeight - 1] = '… Resize the terminal to show the remaining details.'

		new terminalKit.TextBox({
			parent: document,
			x,
			y: 2,
			width,
			height: 1,
			content: this.#title,
			attr: { color: 'brightCyan', bold: true }
		})
		new terminalKit.TextBox({
			parent: document,
			x,
			y: 4,
			width,
			height: bodyHeight,
			content: visibleBody.join('\n'),
			attr: { color: 'white' }
		})
		new terminalKit.TextBox({
			parent: document,
			x,
			y: 4 + bodyHeight,
			width,
			height: 2,
			content: wrapTerminalText(
				`${input.label}\nTab/arrow keys move · Enter advances · Ctrl+C cancels`,
				width
			)
				.slice(0, 2)
				.join('\n'),
			attr: { color: 'brightWhite', bold: true }
		})
		const form = new terminalKit.Form({
			parent: document,
			x,
			y: 6 + bodyHeight,
			width,
			inputs: [
				{
					key: 'answer',
					label: '> ',
					content: input.secret ? '' : (input.defaultValue ?? ''),
					hiddenContent: Boolean(input.secret)
				}
			],
			buttons: [{ content: '<Continue>', value: 'continue' }]
		})

		return await new Promise<string>((resolve, reject) => {
			let settled = false
			const finish = (callback: () => void) => {
				if (settled) return
				settled = true
				terminal.off('key', onKey)
				document.destroy()
				terminal.grabInput(false)
				terminal.hideCursor(false)
				terminal.styleReset()
				terminal.clear()
				this.#active = false
				callback()
			}
			const onKey = (key: string) => {
				if (key === 'CTRL_C' || key === 'ESCAPE') finish(() => reject(new TuiInterruptedError()))
			}
			terminal.on('key', onKey)
			form.on('submit', (result) =>
				finish(() => resolve(result.fields.answer.trim() || input.defaultValue || ''))
			)
			document.giveFocusTo(form)
		})
	}

	close(): void {
		this.#terminal.grabInput(false)
		this.#terminal.hideCursor(false)
		this.#terminal.styleReset()
	}
}
