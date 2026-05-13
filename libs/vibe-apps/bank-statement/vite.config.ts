import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	root: __dirname,
	plugins: [viteSingleFile()],
	build: {
		outDir: path.join(__dirname, 'dist'),
		emptyOutDir: true,
		rollupOptions: {
			input: path.join(__dirname, 'index.html')
		}
	},
	resolve: {
		preserveSymlinks: true
	}
})
