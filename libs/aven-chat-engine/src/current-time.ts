/** Fresh device time, not a date inferred from conversation or document history. */
export function currentTimeContext(
	now = new Date(),
	timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
): string {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
			weekday: 'long',
			timeZoneName: 'longOffset'
		})
			.formatToParts(now)
			.map(({ type, value }) => [type, value])
	)
	return [
		'CURRENT DEVICE TIME (refreshed for this request):',
		`UTC: ${now.toISOString()}`,
		`Local: ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}; ${parts.weekday}; timezone ${timeZone}.`,
		'Use this clock for now/today/tomorrow unless the user specifies another timezone or historical reference date. Source dates remain historical facts, not the current date. Before proposing or creating a future plan for a date already in the past, flag that mismatch and clarify the intended date. Do not silently roll a year forward. Explicit retrospective requests are allowed. Current time alone does not establish current payment, booking or other business status.'
	].join('\n')
}
