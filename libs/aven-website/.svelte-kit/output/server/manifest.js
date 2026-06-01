export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["hero.png","samuel.jpg","robots.txt","daniel.png","favicon.svg"]),
	mimeTypes: {".png":"image/png",".jpg":"image/jpeg",".txt":"text/plain",".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.oVabqPKM.js",app:"_app/immutable/entry/app.KGQCf3ld.js",imports:["_app/immutable/entry/start.oVabqPKM.js","_app/immutable/chunks/DcGChRvy.js","_app/immutable/chunks/Vr3czogh.js","_app/immutable/chunks/CZPcR42g.js","_app/immutable/chunks/CRWD5eUP.js","_app/immutable/entry/app.KGQCf3ld.js","_app/immutable/chunks/BBMWjWfL.js","_app/immutable/chunks/CZPcR42g.js","_app/immutable/chunks/CRWD5eUP.js","_app/immutable/chunks/ibwe1TAv.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js')),
			__memo(() => import('./nodes/6.js')),
			__memo(() => import('./nodes/7.js')),
			__memo(() => import('./nodes/8.js')),
			__memo(() => import('./nodes/9.js')),
			__memo(() => import('./nodes/10.js')),
			__memo(() => import('./nodes/11.js')),
			__memo(() => import('./nodes/14.js')),
			__memo(() => import('./nodes/15.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/api/aven/chat",
				pattern: /^\/api\/aven\/chat\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/chat/_server.ts.js'))
			},
			{
				id: "/api/aven/conversation",
				pattern: /^\/api\/aven\/conversation\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/conversation/_server.ts.js'))
			},
			{
				id: "/api/aven/intent",
				pattern: /^\/api\/aven\/intent\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/intent/_server.ts.js'))
			},
			{
				id: "/api/aven/jaensen/debug/actors",
				pattern: /^\/api\/aven\/jaensen\/debug\/actors\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/jaensen/debug/actors/_server.ts.js'))
			},
			{
				id: "/api/aven/jaensen/debug/actors/events",
				pattern: /^\/api\/aven\/jaensen\/debug\/actors\/events\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/jaensen/debug/actors/events/_server.ts.js'))
			},
			{
				id: "/api/aven/jaensen/events",
				pattern: /^\/api\/aven\/jaensen\/events\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/jaensen/events/_server.ts.js'))
			},
			{
				id: "/api/aven/jaensen/events/stream",
				pattern: /^\/api\/aven\/jaensen\/events\/stream\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/jaensen/events/stream/_server.ts.js'))
			},
			{
				id: "/api/aven/jaensen/intents",
				pattern: /^\/api\/aven\/jaensen\/intents\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/jaensen/intents/_server.ts.js'))
			},
			{
				id: "/api/aven/jaensen/intents/[intentId]",
				pattern: /^\/api\/aven\/jaensen\/intents\/([^/]+?)\/?$/,
				params: [{"name":"intentId","optional":false,"rest":false,"chained":false}],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/jaensen/intents/_intentId_/_server.ts.js'))
			},
			{
				id: "/api/aven/jaensen/messages",
				pattern: /^\/api\/aven\/jaensen\/messages\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/aven/jaensen/messages/_server.ts.js'))
			},
			{
				id: "/api/boring-avatar",
				pattern: /^\/api\/boring-avatar\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/boring-avatar/_server.ts.js'))
			},
			{
				id: "/api/memory/graph",
				pattern: /^\/api\/memory\/graph\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/memory/graph/_server.ts.js'))
			},
			{
				id: "/api/memory/ingest",
				pattern: /^\/api\/memory\/ingest\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/memory/ingest/_server.ts.js'))
			},
			{
				id: "/api/memory/maia-doc",
				pattern: /^\/api\/memory\/maia-doc\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/memory/maia-doc/_server.ts.js'))
			},
			{
				id: "/api/memory/notes",
				pattern: /^\/api\/memory\/notes\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/memory/notes/_server.ts.js'))
			},
			{
				id: "/api/memory/note",
				pattern: /^\/api\/memory\/note\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/memory/note/_server.ts.js'))
			},
			{
				id: "/api/waitlist",
				pattern: /^\/api\/waitlist\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/waitlist/_server.ts.js'))
			},
			{
				id: "/(workspace)/aven",
				pattern: /^\/aven\/?$/,
				params: [],
				page: { layouts: [0,2,], errors: [1,,], leaf: 5 },
				endpoint: null
			},
			{
				id: "/debug/actors",
				pattern: /^\/debug\/actors\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 13 },
				endpoint: null
			},
			{
				id: "/docs",
				pattern: /^\/docs\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 9 },
				endpoint: null
			},
			{
				id: "/docs/vibe-apps",
				pattern: /^\/docs\/vibe-apps\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 10 },
				endpoint: null
			},
			{
				id: "/favicon.ico",
				pattern: /^\/favicon\.ico\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/favicon.ico/_server.ts.js'))
			},
			{
				id: "/(workspace)/memory",
				pattern: /^\/memory\/?$/,
				params: [],
				page: { layouts: [0,2,], errors: [1,,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/(workspace)/me",
				pattern: /^\/me\/?$/,
				params: [],
				page: { layouts: [0,2,], errors: [1,,], leaf: 6 },
				endpoint: null
			},
			{
				id: "/pricing",
				pattern: /^\/pricing\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 12 },
				endpoint: null
			},
			{
				id: "/skills",
				pattern: /^\/skills\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 11 },
				endpoint: null
			},
			{
				id: "/(workspace)/talk",
				pattern: /^\/talk\/?$/,
				params: [],
				page: { layouts: [0,2,], errors: [1,,], leaf: 7 },
				endpoint: null
			},
			{
				id: "/waitlist",
				pattern: /^\/waitlist\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 8 },
				endpoint: null
			}
		],
		prerendered_routes: new Set(["/skills/avenmaia/blog-writer","/skills/avenmaia/golden-offer","/skills/aventin/email-ingestor","/skills/aventin/document-extractor","/skills/aventin/brain-memorizer","/skills/aventin/book-keeper","/skills/aventin/human-reviewer"]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
