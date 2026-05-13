import { App } from '@modelcontextprotocol/ext-apps'

type Todo = { id: string; text: string; done: boolean }
type TodoListConfig = { title?: string; items?: Todo[] }

const state: { title: string; todos: Todo[] } = { title: 'Todos', todos: [] }

function byId<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id)
	if (!el) throw new Error(`Missing #${id}`)
	return el as T
}

const $title = byId<HTMLElement>('title')
const $list = byId<HTMLElement>('list')
const $count = byId<HTMLElement>('count')
const $form = byId<HTMLFormElement>('add-form')
const $input = byId<HTMLInputElement>('add-input')
const $clearDone = byId<HTMLElement>('clear-done-btn')

const app = new App({ name: 'Aven Todos', version: '1.0.0' })

const uid = () => Math.random().toString(36).slice(2, 10)

function render() {
	$title.textContent = state.title
	$list.innerHTML = ''
	if (state.todos.length === 0) {
		const li = document.createElement('li')
		li.className = 'empty'
		li.textContent = 'No todos yet — add one above.'
		$list.appendChild(li)
	} else {
		for (const t of state.todos) {
			const li = document.createElement('li')
			li.className = `todo${t.done ? ' done' : ''}`
			li.dataset.id = t.id
			li.innerHTML = `
              <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Toggle">
              <span class="text" contenteditable="plaintext-only" spellcheck="false"></span>
              <button class="delete" aria-label="Delete">×</button>
            `
			const textEl = li.querySelector('.text')
			if (!textEl) throw new Error('Missing .text in row')
			textEl.textContent = t.text
			$list.appendChild(li)
		}
	}
	const remaining = state.todos.filter((t) => !t.done).length
	$count.textContent = `${remaining} of ${state.todos.length} remaining`
}

async function pushModelContext() {
	await app.updateModelContext({
		structuredContent: { title: state.title, todos: state.todos },
		content: [
			{
				type: 'text',
				text: `${state.todos.filter((t) => !t.done).length} of ${state.todos.length} todos remaining.`
			}
		]
	})
}

function applyConfig(cfg: TodoListConfig | undefined) {
	if (!cfg) return
	if (typeof cfg.title === 'string') state.title = cfg.title
	if (Array.isArray(cfg.items)) {
		state.todos = cfg.items.map((it) => ({
			id: it.id ?? uid(),
			text: it.text ?? '',
			done: !!it.done
		}))
	}
	render()
	void pushModelContext()
}

$form.addEventListener('submit', (e) => {
	e.preventDefault()
	const text = $input.value.trim()
	if (!text) return
	state.todos.push({ id: uid(), text, done: false })
	$input.value = ''
	render()
	void pushModelContext()
})

$list.addEventListener('change', (e) => {
	const t = e.target as HTMLInputElement
	if (t.type !== 'checkbox') return
	const li = t.closest('.todo')
	const todo = state.todos.find((x) => x.id === li?.dataset.id)
	if (!todo) return
	todo.done = t.checked
	render()
	void pushModelContext()
})

$list.addEventListener('click', (e) => {
	const t = e.target as HTMLElement
	if (!t.classList?.contains('delete')) return
	const li = t.closest('.todo')
	state.todos = state.todos.filter((x) => x.id !== li?.dataset.id)
	render()
	void pushModelContext()
})

$list.addEventListener('input', (e) => {
	const t = e.target as HTMLElement
	if (!t.classList?.contains('text')) return
	const li = t.closest('.todo')
	const todo = state.todos.find((x) => x.id === li?.dataset.id)
	if (!todo) return
	todo.text = (t.textContent ?? '').trim()
	void pushModelContext()
})

$clearDone.addEventListener('click', () => {
	state.todos = state.todos.filter((t) => !t.done)
	render()
	void pushModelContext()
})

app.ontoolinput = (params) => applyConfig(params.arguments as TodoListConfig | undefined)
app.ontoolresult = (result) => {
	const sc = result.structuredContent as TodoListConfig | undefined
	if (sc) applyConfig(sc)
}

void app.connect()
render()
void pushModelContext()
