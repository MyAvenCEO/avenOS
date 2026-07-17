// board 0112 — inventory list logic: map each stock row to {name, location, qty}. The quantity badge shows
// the amount + its unit/scale when present ("3 kg"), else a bare "N×" so the badge always reads as a count.
export const inventoryLogic = `function initState(source){source=source||{};var it=source.items||[];var out=[];for(var i=0;i<it.length;i++){var t=it[i]||{};var amt=t.amount!=null&&t.amount!==''?String(t.amount):'';var unit=t.scale?String(t.scale):'';var qty=amt?(unit?amt+' '+unit:amt+'\\u00d7'):'\\u2014';out.push({name:t.name||'\\u2014',location:t.location?String(t.location):'',qty:qty});}return{count:out.length+' Positionen',items:out,emptyMsg:out.length?'':'Noch kein Bestand \\u2014 sag mir was du einlagerst.'};}
function handleEvent(t, p, s) { return s }`
