/** Heuristic: running inside WKWebView on iPhone/iPad (incl. iPad desktop UA). */
export function isIosHostedTauriShell(): boolean {
	if (typeof navigator === 'undefined') return false
	const ua = navigator.userAgent ?? ''
	if (/iPhone|iPod|iPad/i.test(ua)) return true
	const platform = navigator.platform ?? ''
	const maxTouch =
		'maxTouchPoints' in navigator && typeof navigator.maxTouchPoints === 'number'
			? navigator.maxTouchPoints
			: 0
	return platform === 'MacIntel' && maxTouch > 1
}
