/**
 * The founder's single north-star: **cashflow per hour** — euros pulled out of
 * the business per hour worked. It rises when cashflow grows OR hours shrink,
 * so it folds both levers ("work less × pull more out") into one score that
 * climbs the Fibonacci level ladder.
 */

import { type LevelInfo, levelFor } from '$lib/leveling'

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
export function formatEur(value: number): string {
	return EUR.format(value)
}

export type FounderWeek = {
	/** Monday of the tracked week (ISO date). */
	weekOf: string
	/** Hours the founder personally worked that week. */
	hours: number
	/** Owner take-home (cash pulled out) that week, EUR. */
	cashflow: number
}

/**
 * Oldest → newest. Hours trending down (89 → 32), cashflow trending up
 * (€90 → €250/wk). Numbers start low so the leveling has room to climb:
 * cashflow/hour begins near €1/h (Level 1) and works upward.
 */
export const FOUNDER_HISTORY: FounderWeek[] = [
	{ weekOf: '2026-03-30', hours: 89, cashflow: 90 },
	{ weekOf: '2026-04-06', hours: 81, cashflow: 108 },
	{ weekOf: '2026-04-13', hours: 74, cashflow: 126 },
	{ weekOf: '2026-04-20', hours: 66, cashflow: 144 },
	{ weekOf: '2026-04-27', hours: 58, cashflow: 165 },
	{ weekOf: '2026-05-04', hours: 52, cashflow: 185 },
	{ weekOf: '2026-05-11', hours: 46, cashflow: 205 },
	{ weekOf: '2026-05-18', hours: 41, cashflow: 222 },
	{ weekOf: '2026-05-25', hours: 36, cashflow: 238 },
	{ weekOf: '2026-06-01', hours: 32, cashflow: 250 }
]

/**
 * The concrete next move: to reach `rate` €/h from the current (hours, cashflow),
 * either pull more cash out at today's hours, or cut hours at today's cashflow.
 * We surface both and flag whichever is the smaller *relative* effort.
 */
export interface NextStep {
	/** Target €/h rung (the next level). */
	rate: number
	/** Extra €/week to add at current hours to hit `rate`. */
	addCash: number
	/** Resulting weekly cashflow on the cash path. */
	cashTarget: number
	/** Hours/week to cut at current cashflow to hit `rate`. */
	cutHours: number
	/** Resulting weekly hours on the hours path. */
	hoursTarget: number
	/** Whichever lever is the lighter lift. */
	easier: 'cash' | 'hours'
}

export function nextStep(hours: number, cashflow: number, rate: number): NextStep {
	const cashTarget = rate * hours
	const addCash = Math.max(0, cashTarget - cashflow)
	const hoursTarget = rate > 0 ? cashflow / rate : hours
	const cutHours = Math.max(0, hours - hoursTarget)
	const cashEffort = cashflow > 0 ? addCash / cashflow : Number.POSITIVE_INFINITY
	const hoursEffort = hours > 0 ? cutHours / hours : Number.POSITIVE_INFINITY
	return {
		rate,
		addCash,
		cashTarget,
		cutHours,
		hoursTarget,
		easier: hoursEffort <= cashEffort ? 'hours' : 'cash'
	}
}

export interface FounderStatus {
	hours: number
	cashflow: number
	/** Cashflow per hour — the north-star. */
	perHour: number
	level: LevelInfo
	/** Change in hours vs the first tracked week (negative = fewer hours). */
	hoursDelta: number
	/** Change in cashflow vs the first tracked week (positive = more cash). */
	cashDelta: number
	/** Number of tracked weeks. */
	weeks: number
	next: NextStep
}

export function founderStatus(history: FounderWeek[] = FOUNDER_HISTORY): FounderStatus {
	const first = history[0]
	const latest = history[history.length - 1]
	const hours = latest.hours
	const cashflow = latest.cashflow
	const perHour = hours > 0 ? cashflow / hours : 0
	const level = levelFor(perHour, { direction: 'up' })
	return {
		hours,
		cashflow,
		perHour,
		level,
		hoursDelta: first.hours > 0 ? (hours - first.hours) / first.hours : 0,
		cashDelta: first.cashflow > 0 ? (cashflow - first.cashflow) / first.cashflow : 0,
		weeks: history.length,
		next: nextStep(hours, cashflow, level.next)
	}
}
