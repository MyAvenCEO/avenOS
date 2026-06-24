import type { ViewDef } from '../../engine/types.js'

// ViewNode has no $if support — conditional visibility is handled via logic.js computing
// display-ready state strings (e.g. bk-img is hidden via CSS when fileUrl is empty).
export const bookkeepingView: ViewDef = {
	content: {
		class: 'bk-shell',
		children: [
			{
				class: 'bk-layout',
				children: [
					// Left 60%: document preview
					{
						class: 'bk-preview',
						children: [
							{
								class: 'bk-preview-inner',
								children: [
									{
										tag: 'img',
										// $imgClass / $noPreviewClass toggle a bk-hidden class from state
										// (logic.js) — no [src] attribute selectors (forbidden engine-side). 0063.
										class: '$imgClass',
										attrs: { src: '$fileUrl', alt: '$title' }
									},
									{
										class: '$noPreviewClass',
										text: '$noPreviewLabel'
									}
								]
							}
						]
					},
					// Right 40%: classification metadata
					{
						class: 'bk-meta',
						children: [
							{
								class: 'bk-eyebrow',
								text: '$eyebrow'
							},
							{
								// Full class computed in logic.js (state.chipClass): the engine forbids
								// splicing a $ref mid-class, so the whole value must be one $ref. 0063.
								class: '$chipClass',
								text: '$docTypeLabel'
							},
							{
								tag: 'h2',
								class: 'bk-title',
								text: '$title'
							},
							{
								class: 'bk-description',
								text: '$description'
							},
							{
								class: 'bk-tags',
								children: [
									{
										$each: {
											items: '$tags',
											// $each resolves $$<field> on object items — tags are wrapped
											// as { label } in logic.js (a bare string yields undefined).
											template: {
												class: 'bk-tag',
												text: '$$label'
											}
										}
									}
								]
							},
							{
								// Parties involved — issuer ("identity of the party"), recipient, others.
								class: 'bk-parties',
								children: [
									{
										class: 'bk-parties-label',
										text: '$partiesLabel'
									},
									{
										$each: {
											items: '$parties',
											template: {
												class: 'bk-party',
												children: [
													{ class: 'bk-party-role', text: '$$role' },
													{ class: 'bk-party-name', text: '$$name' }
												]
											}
										}
									}
								]
							},
							{
								class: 'bk-empty',
								text: '$emptyLabel'
							}
						]
					}
				]
			}
		]
	}
}
