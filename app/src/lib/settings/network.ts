/** Hardcoded network id for this build — must match Rust `NETWORK_SEED`. */
export const NETWORK_SEED = 'ceo.aven/testnet/abagana'

export const NETWORK_PATH_DISPLAY = `.avenOS/${NETWORK_SEED}`

/**
 * Network the user lands in after the Select Network intro. testnet ("abagana") is
 * the full, crypto-backed experience (vault, signup, accounts, sync). mainnet
 * ("alberobello") is a separate world that currently renders a mocked chat UI only —
 * no vault/crypto is wired yet (its data root is established under
 * `<Documents>/.avenOS/ceo.aven/mainnet/alberobello`). city ("avenCITY") is the
 * third world: the three.js hex island from `@avenos/aven-city`. It holds its
 * state in the running scene, so unlike the other two it has NO seed and no data
 * root — see NETWORKS below.
 */
export type NetworkId = 'testnet' | 'mainnet' | 'city'

export type NetworkInfo = {
	id: NetworkId
	/** HKDF/data-path seed for this network. */
	seed: string
	/** Path segments under `<Documents>/.avenOS/`. */
	pathSegments: readonly string[]
	/** Short name shown in the picker tag (e.g. "abagana"). */
	codename: string
}

/**
 * Partial on purpose: only worlds that own a seeded data root appear here. city
 * deliberately has no entry — nothing about avenCITY is persisted to
 * `<Documents>/.avenOS/` yet, and a placeholder seed would claim otherwise.
 */
export const NETWORKS: Partial<Record<NetworkId, NetworkInfo>> = {
	testnet: {
		id: 'testnet',
		seed: NETWORK_SEED,
		pathSegments: ['ceo.aven', 'testnet', 'abagana'],
		codename: 'abagana'
	},
	mainnet: {
		id: 'mainnet',
		seed: 'ceo.aven/mainnet/alberobello',
		pathSegments: ['ceo.aven', 'mainnet', 'alberobello'],
		codename: 'alberobello'
	}
}
