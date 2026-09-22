/** Protocol meaning for a successfully captured response, not task completion.
 * Keep this next to the tool observation, not in every conversation's prompt.
 * Status alone does not establish domain values, existence or collection coverage.
 * See RFC 9110 section 15, especially 15.5.5 (404 can conceal existence). */
export function httpResponseDiagnostic(statusCode: number): {
	scope: 'http-status-only'
	explanation: string
} {
	if (!Number.isSafeInteger(statusCode) || statusCode < 200 || statusCode > 599)
		throw Error('HTTP_RESPONSE_STATUS_INVALID')
	let explanation: string
	if (statusCode === 404)
		explanation =
			'The requested resource was not found or its existence was not disclosed. The domain value remains UNKNOWN: this status establishes neither missing domain records nor zero/empty values, and does not establish access denial or its cause. Report what this response did not reveal, not what is absent in the underlying system. Do not invent the response shape.'
	else if (statusCode === 204 || statusCode === 205)
		explanation =
			'The server reports success without response content. No body value or empty collection can be inferred from this status.'
	else if (statusCode === 206)
		explanation =
			'This is a partial-content response. Capturing all transferred bytes does not establish that the complete resource or collection was read.'
	else if (statusCode < 300)
		explanation =
			'The server reports HTTP success. Domain values and task completion still depend on the captured content and its schema; this status alone proves neither a count nor complete collection coverage.'
	else if (statusCode === 304)
		explanation =
			'This is a conditional validation response, not a new response body. Only an independently authorized stored representation may supply its content.'
	else if (statusCode < 400)
		explanation =
			'A redirection response was captured. It is not proof that the destination was fetched or that its content is available.'
	else if (statusCode === 401)
		explanation =
			'The server requires valid authentication for this request. The status alone does not identify which credential, configuration or authentication requirement caused the failure.'
	else if (statusCode === 403)
		explanation =
			'The server refused the request. The status alone does not establish the reason or permit a different account or destination.'
	else
		explanation =
			'The server returned an unsuccessful HTTP status. Any captured error body is not a successful domain result; unavailable values remain unknown rather than zero or empty.'
	return { scope: 'http-status-only', explanation }
}
