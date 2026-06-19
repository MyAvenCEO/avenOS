#!/usr/bin/env bun
/**
 * Tauri desktop dev (Linux): SvelteKit on :1420 (`beforeDevCommand`).
 * Views render in-process via aven-ui + sandbox-quickjs.
 *
 * Sets a couple of well-known WebKitGTK 2.x env defaults that fix common
 * rendering glitches on modern Linux desktops. Override by exporting them
 * before running this script.
 */
import { runDesktopDev } from './dev-app-desktop.ts'

void runDesktopDev('linux')
