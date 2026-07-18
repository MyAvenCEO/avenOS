// The invoice viewer reuses the generic structured-document view; its per-type shape comes from
// `mapper.ts` (raw invoice JSON → DocView). Re-exported here so each doctype has a `view.ts`. 0064.
export { docView as invoiceView } from '../_doc/view.js'
