#!/usr/bin/env bun
/**
 * Tauri desktop dev: SvelteKit on :1420 (`beforeDevCommand`). Views render in-process via aven-ui + sandbox-quickjs.
 */
import { runDesktopDev } from './dev-app-desktop.ts'

void runDesktopDev('darwin')
