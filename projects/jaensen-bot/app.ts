import { registerProvider } from '@flue/sdk/app'

registerProvider('minimax', {
	api: 'openai',
	baseUrl: 'http://box:8000/v1',
	apiKey: 'local'
})
