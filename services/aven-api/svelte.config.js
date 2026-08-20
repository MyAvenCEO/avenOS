import adapter from '@sveltejs/adapter-node'

export default {
	kit: {
		adapter: adapter(),
		csp: {
			mode: 'auto',
			directives: {
				'script-src': ['self'],
				'frame-src': [
					'self',
					'https://creem.io',
					'https://checkout.creem.io',
					'https://www.creem.io'
				],
				'frame-ancestors': ['none'],
				'object-src': ['none'],
				'base-uri': ['self']
			}
		}
	}
}
