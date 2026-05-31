
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/boring-avatar" | "/api/waitlist" | "/favicon.ico" | "/pricing" | "/skills" | "/skills/avenmaia" | "/skills/avenmaia/[slug]" | "/skills/aventin" | "/skills/aventin/[slug]" | "/waitlist";
		RouteParams(): {
			"/skills/avenmaia/[slug]": { slug: string };
			"/skills/aventin/[slug]": { slug: string }
		};
		LayoutParams(): {
			"/": { slug?: string };
			"/api": Record<string, never>;
			"/api/boring-avatar": Record<string, never>;
			"/api/waitlist": Record<string, never>;
			"/favicon.ico": Record<string, never>;
			"/pricing": Record<string, never>;
			"/skills": { slug?: string };
			"/skills/avenmaia": { slug?: string };
			"/skills/avenmaia/[slug]": { slug: string };
			"/skills/aventin": { slug?: string };
			"/skills/aventin/[slug]": { slug: string };
			"/waitlist": Record<string, never>
		};
		Pathname(): "/" | "/api/boring-avatar" | "/api/waitlist" | "/favicon.ico" | "/pricing" | "/skills" | `/skills/avenmaia/${string}` & {} | `/skills/avenmaia/${string}/` & {} | `/skills/aventin/${string}` & {} | `/skills/aventin/${string}/` & {} | "/waitlist";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/samuel.jpg" | "/hero.png" | "/robots.txt" | "/daniel.png" | "/favicon.svg" | string & {};
	}
}