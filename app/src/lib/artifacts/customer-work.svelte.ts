/** Active customer writes remain busy through publication and follow-up work. */
export const customerWork = $state({
	uploads: false,
	documents: 0,
	reconciliations: 0,
	feedback: 0,
	tasks: 0,
	conversations: 0
})
