// board 0112 — locations grid logic: each location → {name, countLabel}. Driven by the `locations` actor,
// which lists the location ENTITIES (incl. empty ones) with per-location item counts from the aggregate.
export const locationsLogic = `function initState(source){source=source||{};var ls=source.locations||[];var out=[];for(var i=0;i<ls.length;i++){var l=ls[i]||{};out.push({name:String(l.key||'\\u2014'),countLabel:Number(l.count||0)+' Position(en)'});}return{count:out.length+' Orte',locations:out,emptyMsg:out.length?'':'Noch keine Lagerorte \\u2014 lagere etwas ein.'};}
function handleEvent(t, p, s) { return s }`
