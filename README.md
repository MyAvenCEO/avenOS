# AvenOS (SvelteKit)

SvelteKit app scaffolded with [`sv`](https://github.com/sveltejs/cli), managed with **Bun** only.

## Creating a project (reference)

```sh
bunx sv create my-app
```

To recreate this project with the same configuration:

```sh
bunx sv@0.15.2 create --template minimal --types ts --install bun .
```

## Developing

```sh
bun install
bun run dev

# or start the server and open the app in a new browser tab
bun run dev -- --open
```

## Building

```sh
bun run build
bun run preview
```

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
