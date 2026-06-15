/** Hardcoded network id for this build — must match Rust `NETWORK_SEED`. */
export const NETWORK_SEED = 'ceo.aven/testnet/abagana'

export const NETWORK_PATH_DISPLAY = `.avenOS/${NETWORK_SEED}`

/**
 * Network the user lands in after the Select Network intro. testnet ("abagana") is
 * the full, crypto-backed experience (vault, signup, accounts, sync). mainnet
 * ("alberobello") is a separate world that currently renders a mocked chat UI only —
 * no vault/crypto is wired yet (its data root is established under
 * `<Documents>/.avenOS/ceo.aven/mainnet/alberobello`).
 */
export type NetworkId = 'testnet' | 'mainnet'

export type NetworkInfo = {
	id: NetworkId
	/** HKDF/data-path seed for this network. */
	seed: string
	/** Path segments under `<Documents>/.avenOS/`. */
	pathSegments: readonly string[]
	/** Short name shown in the picker tag (e.g. "abagana"). */
	codename: string
}

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
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
