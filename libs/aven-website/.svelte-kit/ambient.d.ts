
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/private';
 * 
 * console.log(ENVIRONMENT); // => "production"
 * console.log(PUBLIC_BASE_URL); // => throws error during build
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/private' {
	export const NVM_INC: string;
	export const _ZO_DOCTOR: string;
	export const VSCODE_CRASH_REPORTER_PROCESS_TYPE: string;
	export const NODE: string;
	export const NVM_CD_FLAGS: string;
	export const INIT_CWD: string;
	export const SHELL: string;
	export const TERM: string;
	export const VSCODE_PROCESS_TITLE: string;
	export const HOMEBREW_REPOSITORY: string;
	export const TMPDIR: string;
	export const AVEN_RELAY_URL: string;
	export const CURSOR_WORKSPACE_LABEL: string;
	export const FPATH: string;
	export const JAENSEN_TINFOIL_API_KEY: string;
	export const MallocNanoZone: string;
	export const JAENSEN_TINFOIL_BASE_URL: string;
	export const NO_COLOR: string;
	export const AVENOS_RELAY_SEED_HEX: string;
	export const AVENOS_RELAY_PUBLIC_KEY_HEX: string;
	export const CURSOR_LAYOUT: string;
	export const PNPM_HOME: string;
	export const npm_config_local_prefix: string;
	export const NVM_DIR: string;
	export const USER: string;
	export const COMMAND_MODE: string;
	export const SSH_AUTH_SOCK: string;
	export const __CF_USER_TEXT_ENCODING: string;
	export const npm_execpath: string;
	export const npm_lifecycle_script: string;
	export const PATH: string;
	export const _: string;
	export const npm_package_json: string;
	export const __CFBundleIdentifier: string;
	export const JOBS: string;
	export const PWD: string;
	export const VSCODE_HANDLES_UNCAUGHT_ERRORS: string;
	export const JAZZ_ADMIN_SECRET: string;
	export const VSCODE_ESM_ENTRYPOINT: string;
	export const LANG: string;
	export const CURSOR_AGENT: string;
	export const npm_package_name: string;
	export const XPC_FLAGS: string;
	export const MACH_PORT_RENDEZVOUS_PEER_VALDATION: string;
	export const FORCE_COLOR: string;
	export const XPC_SERVICE_NAME: string;
	export const HOME: string;
	export const SHLVL: string;
	export const VSCODE_NLS_CONFIG: string;
	export const HOMEBREW_PREFIX: string;
	export const JAENSEN_TINFOIL_MODEL: string;
	export const LOGNAME: string;
	export const DEV_GENESIS_NETWORK_ID: string;
	export const VSCODE_CODE_CACHE_PATH: string;
	export const VSCODE_IPC_HOOK: string;
	export const BUN_INSTALL: string;
	export const NVM_BIN: string;
	export const VSCODE_PID: string;
	export const npm_config_user_agent: string;
	export const HOMEBREW_CELLAR: string;
	export const INFOPATH: string;
	export const OSLogRateLimit: string;
	export const BACKEND_SECRET: string;
	export const VSCODE_CWD: string;
	export const VSCODE_L10N_BUNDLE_LOCATION: string;
	export const AVEN_RELAY: string;
	export const npm_node_execpath: string;
	export const npm_package_version: string;
	export const npm_command: string;
	export const npm_lifecycle_event: string;
}

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/public';
 * 
 * console.log(ENVIRONMENT); // => throws error during build
 * console.log(PUBLIC_BASE_URL); // => "http://site.com"
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/public' {
	export const PUBLIC_JAZZ_APP_ID: string;
	export const PUBLIC_JAZZ_SERVER_URL: string;
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * 
 * console.log(env.ENVIRONMENT); // => "production"
 * console.log(env.PUBLIC_BASE_URL); // => undefined
 * ```
 */
declare module '$env/dynamic/private' {
	export const env: {
		NVM_INC: string;
		_ZO_DOCTOR: string;
		VSCODE_CRASH_REPORTER_PROCESS_TYPE: string;
		NODE: string;
		NVM_CD_FLAGS: string;
		INIT_CWD: string;
		SHELL: string;
		TERM: string;
		VSCODE_PROCESS_TITLE: string;
		HOMEBREW_REPOSITORY: string;
		TMPDIR: string;
		AVEN_RELAY_URL: string;
		CURSOR_WORKSPACE_LABEL: string;
		FPATH: string;
		JAENSEN_TINFOIL_API_KEY: string;
		MallocNanoZone: string;
		JAENSEN_TINFOIL_BASE_URL: string;
		NO_COLOR: string;
		AVENOS_RELAY_SEED_HEX: string;
		AVENOS_RELAY_PUBLIC_KEY_HEX: string;
		CURSOR_LAYOUT: string;
		PNPM_HOME: string;
		npm_config_local_prefix: string;
		NVM_DIR: string;
		USER: string;
		COMMAND_MODE: string;
		SSH_AUTH_SOCK: string;
		__CF_USER_TEXT_ENCODING: string;
		npm_execpath: string;
		npm_lifecycle_script: string;
		PATH: string;
		_: string;
		npm_package_json: string;
		__CFBundleIdentifier: string;
		JOBS: string;
		PWD: string;
		VSCODE_HANDLES_UNCAUGHT_ERRORS: string;
		JAZZ_ADMIN_SECRET: string;
		VSCODE_ESM_ENTRYPOINT: string;
		LANG: string;
		CURSOR_AGENT: string;
		npm_package_name: string;
		XPC_FLAGS: string;
		MACH_PORT_RENDEZVOUS_PEER_VALDATION: string;
		FORCE_COLOR: string;
		XPC_SERVICE_NAME: string;
		HOME: string;
		SHLVL: string;
		VSCODE_NLS_CONFIG: string;
		HOMEBREW_PREFIX: string;
		JAENSEN_TINFOIL_MODEL: string;
		LOGNAME: string;
		DEV_GENESIS_NETWORK_ID: string;
		VSCODE_CODE_CACHE_PATH: string;
		VSCODE_IPC_HOOK: string;
		BUN_INSTALL: string;
		NVM_BIN: string;
		VSCODE_PID: string;
		npm_config_user_agent: string;
		HOMEBREW_CELLAR: string;
		INFOPATH: string;
		OSLogRateLimit: string;
		BACKEND_SECRET: string;
		VSCODE_CWD: string;
		VSCODE_L10N_BUNDLE_LOCATION: string;
		AVEN_RELAY: string;
		npm_node_execpath: string;
		npm_package_version: string;
		npm_command: string;
		npm_lifecycle_event: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://example.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.ENVIRONMENT); // => undefined, not public
 * console.log(env.PUBLIC_BASE_URL); // => "http://example.com"
 * ```
 * 
 * ```
 * 
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		PUBLIC_JAZZ_APP_ID: string;
		PUBLIC_JAZZ_SERVER_URL: string;
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
