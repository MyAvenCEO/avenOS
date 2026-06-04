<script lang="ts">
import { BoardView, boardItemHref, getBoardColumns, type WorkItem } from '@avenos/aven-board'
import { t } from '$lib/i18n'
import { navigateApp } from '$lib/shell'

const BOARD_BASE = '/avens/avenCEO/board'
const columns = getBoardColumns()

function open(item: WorkItem, e: MouseEvent): void {
	navigateApp(boardItemHref(item, BOARD_BASE), e)
}
</script>

<svelte:head>
	<title>{t('board.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<BoardView
	{columns}
	base={BOARD_BASE}
	title={t('board.title')}
	subtitle={t('board.subtitle')}
	emptyLabel={t('board.empty')}
	onOpen={open}
/>
