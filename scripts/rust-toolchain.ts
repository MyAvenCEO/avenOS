/**
 * Single source of truth for the AvenOS app Rust toolchain (see app/src-tauri/rust-toolchain.toml).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const DEFAULT_RUST_TOOLCHAIN_CHANNEL = '1.93.1'

export function tauriRustToolchainToml(repoRoot: string): string {
	return path.join(repoRoot, 'app/src-tauri/rust-toolchain.toml')
}

/** Channel string for `RUSTUP_TOOLCHAIN` (e.g. `1.93.1`). */
export function readRustToolchainChannel(repoRoot: string): string {
	const p = tauriRustToolchainToml(repoRoot)
	if (!existsSync(p)) return DEFAULT_RUST_TOOLCHAIN_CHANNEL
	const toml = readFileSync(p, 'utf8')
	const m = /^\s*channel\s*=\s*"([^"]+)"/m.exec(toml)
	return m?.[1]?.trim() || DEFAULT_RUST_TOOLCHAIN_CHANNEL
}

export function rustupToolchainEnv(repoRoot: string): { RUSTUP_TOOLCHAIN: string } {
	return { RUSTUP_TOOLCHAIN: readRustToolchainChannel(repoRoot) }
}

/** Shell prefix for Xcode build phases (`export RUSTUP_TOOLCHAIN=…`). */
export function rustToolchainShellExports(repoRoot: string): string {
	const ch = readRustToolchainChannel(repoRoot)
	return `export RUSTUP_TOOLCHAIN=${ch}; export PATH="\${HOME}/.cargo/bin:\${PATH}"; `
}

/** Same as [`rustToolchainShellExports`] with quoting for `project.pbxproj` `shellScript` strings. */
export function rustToolchainShellExportsPbx(repoRoot: string): string {
	const ch = readRustToolchainChannel(repoRoot)
	return `export RUSTUP_TOOLCHAIN=${ch}; export PATH=\\"\${HOME}/.cargo/bin:\${PATH}\\"; `
}
