
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
	export const SHELL: string;
	export const SESSION_MANAGER: string;
	export const QT_ACCESSIBILITY: string;
	export const XDG_CONFIG_DIRS: string;
	export const SSH_AGENT_LAUNCHER: string;
	export const PYTHONUNBUFFERED: string;
	export const NVM_INC: string;
	export const XDG_MENU_PREFIX: string;
	export const JAENSEN_OPENAI_BASE_URL: string;
	export const GNOME_DESKTOP_SESSION_ID: string;
	export const JOBS: string;
	export const TERMINAL_EMULATOR: string;
	export const NODE: string;
	export const PROCESS_LAUNCHED_BY_Q: string;
	export const LC_ADDRESS: string;
	export const GNOME_SHELL_SESSION_MODE: string;
	export const LC_NAME: string;
	export const SSH_AUTH_SOCK: string;
	export const AVEN_RELAY: string;
	export const TERM_SESSION_ID: string;
	export const npm_config_local_prefix: string;
	export const XMODIFIERS: string;
	export const DESKTOP_SESSION: string;
	export const LC_MONETARY: string;
	export const GTK_MODULES: string;
	export const PWD: string;
	export const XDG_SESSION_DESKTOP: string;
	export const LOGNAME: string;
	export const XDG_SESSION_TYPE: string;
	export const PROCESS_LAUNCHED_BY_CW: string;
	export const PNPM_HOME: string;
	export const SYSTEMD_EXEC_PID: string;
	export const npm_lifecycle_script: string;
	export const _: string;
	export const XAUTHORITY: string;
	export const DESKTOP_STARTUP_ID: string;
	export const GJS_DEBUG_TOPICS: string;
	export const JAENSEN_OPENAI_API_KEY: string;
	export const HOME: string;
	export const USERNAME: string;
	export const IM_CONFIG_PHASE: string;
	export const LANG: string;
	export const LC_PAPER: string;
	export const LS_COLORS: string;
	export const XDG_CURRENT_DESKTOP: string;
	export const WAYLAND_DISPLAY: string;
	export const INVOCATION_ID: string;
	export const FIG_TERM: string;
	export const MANAGERPID: string;
	export const CMAKE_CXX_COMPILER_LAUNCHER: string;
	export const INIT_CWD: string;
	export const DOTNET_BUNDLE_EXTRACT_BASE_DIR: string;
	export const GJS_DEBUG_OUTPUT: string;
	export const NVM_DIR: string;
	export const GNOME_SETUP_DISPLAY: string;
	export const LESSCLOSE: string;
	export const XDG_SESSION_CLASS: string;
	export const JAENSEN_OPENAI_MODEL: string;
	export const TERM: string;
	export const LC_IDENTIFICATION: string;
	export const npm_package_name: string;
	export const DEV_GENESIS_NETWORK_ID: string;
	export const LESSOPEN: string;
	export const USER: string;
	export const DISPLAY: string;
	export const SHLVL: string;
	export const NVM_CD_FLAGS: string;
	export const LC_TELEPHONE: string;
	export const QT_IM_MODULE: string;
	export const LC_MEASUREMENT: string;
	export const INTELLIJ_TERMINAL_COMMAND_BLOCKS_REWORKED: string;
	export const npm_config_user_agent: string;
	export const npm_execpath: string;
	export const LD_LIBRARY_PATH: string;
	export const XDG_RUNTIME_DIR: string;
	export const CMAKE_C_COMPILER_LAUNCHER: string;
	export const DEBUGINFOD_URLS: string;
	export const LC_TIME: string;
	export const npm_package_json: string;
	export const BUN_INSTALL: string;
	export const CUDA_HOME: string;
	export const JOURNAL_STREAM: string;
	export const XDG_DATA_DIRS: string;
	export const JAZZ_ADMIN_SECRET: string;
	export const PATH: string;
	export const BACKEND_SECRET: string;
	export const GDMSESSION: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const NVM_BIN: string;
	export const AVEN_RELAY_URL: string;
	export const GIO_LAUNCHED_DESKTOP_FILE_PID: string;
	export const npm_node_execpath: string;
	export const GIO_LAUNCHED_DESKTOP_FILE: string;
	export const LC_NUMERIC: string;
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
	export const PUBLIC_JAZZ_SERVER_URL: string;
	export const PUBLIC_JAZZ_APP_ID: string;
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
		SHELL: string;
		SESSION_MANAGER: string;
		QT_ACCESSIBILITY: string;
		XDG_CONFIG_DIRS: string;
		SSH_AGENT_LAUNCHER: string;
		PYTHONUNBUFFERED: string;
		NVM_INC: string;
		XDG_MENU_PREFIX: string;
		JAENSEN_OPENAI_BASE_URL: string;
		GNOME_DESKTOP_SESSION_ID: string;
		JOBS: string;
		TERMINAL_EMULATOR: string;
		NODE: string;
		PROCESS_LAUNCHED_BY_Q: string;
		LC_ADDRESS: string;
		GNOME_SHELL_SESSION_MODE: string;
		LC_NAME: string;
		SSH_AUTH_SOCK: string;
		AVEN_RELAY: string;
		TERM_SESSION_ID: string;
		npm_config_local_prefix: string;
		XMODIFIERS: string;
		DESKTOP_SESSION: string;
		LC_MONETARY: string;
		GTK_MODULES: string;
		PWD: string;
		XDG_SESSION_DESKTOP: string;
		LOGNAME: string;
		XDG_SESSION_TYPE: string;
		PROCESS_LAUNCHED_BY_CW: string;
		PNPM_HOME: string;
		SYSTEMD_EXEC_PID: string;
		npm_lifecycle_script: string;
		_: string;
		XAUTHORITY: string;
		DESKTOP_STARTUP_ID: string;
		GJS_DEBUG_TOPICS: string;
		JAENSEN_OPENAI_API_KEY: string;
		HOME: string;
		USERNAME: string;
		IM_CONFIG_PHASE: string;
		LANG: string;
		LC_PAPER: string;
		LS_COLORS: string;
		XDG_CURRENT_DESKTOP: string;
		WAYLAND_DISPLAY: string;
		INVOCATION_ID: string;
		FIG_TERM: string;
		MANAGERPID: string;
		CMAKE_CXX_COMPILER_LAUNCHER: string;
		INIT_CWD: string;
		DOTNET_BUNDLE_EXTRACT_BASE_DIR: string;
		GJS_DEBUG_OUTPUT: string;
		NVM_DIR: string;
		GNOME_SETUP_DISPLAY: string;
		LESSCLOSE: string;
		XDG_SESSION_CLASS: string;
		JAENSEN_OPENAI_MODEL: string;
		TERM: string;
		LC_IDENTIFICATION: string;
		npm_package_name: string;
		DEV_GENESIS_NETWORK_ID: string;
		LESSOPEN: string;
		USER: string;
		DISPLAY: string;
		SHLVL: string;
		NVM_CD_FLAGS: string;
		LC_TELEPHONE: string;
		QT_IM_MODULE: string;
		LC_MEASUREMENT: string;
		INTELLIJ_TERMINAL_COMMAND_BLOCKS_REWORKED: string;
		npm_config_user_agent: string;
		npm_execpath: string;
		LD_LIBRARY_PATH: string;
		XDG_RUNTIME_DIR: string;
		CMAKE_C_COMPILER_LAUNCHER: string;
		DEBUGINFOD_URLS: string;
		LC_TIME: string;
		npm_package_json: string;
		BUN_INSTALL: string;
		CUDA_HOME: string;
		JOURNAL_STREAM: string;
		XDG_DATA_DIRS: string;
		JAZZ_ADMIN_SECRET: string;
		PATH: string;
		BACKEND_SECRET: string;
		GDMSESSION: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		NVM_BIN: string;
		AVEN_RELAY_URL: string;
		GIO_LAUNCHED_DESKTOP_FILE_PID: string;
		npm_node_execpath: string;
		GIO_LAUNCHED_DESKTOP_FILE: string;
		LC_NUMERIC: string;
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
		PUBLIC_JAZZ_SERVER_URL: string;
		PUBLIC_JAZZ_APP_ID: string;
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
