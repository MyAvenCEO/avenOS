import { type Kysely, sql } from 'kysely'

// board 0113 — the stepper rides along on EVERY promotion step (Samuel: "ensure the progress bar
// stepper is being displayed in each step"). The step actors now emit the skill-plan card next to
// their content card; this migration teaches the card's logic the two states that were missing:
//   data   → Daten DONE, current Aktoren (mint_data succeeded)
//   seeded → Seed DONE, current Live (seed_data succeeded)
// (plan→current Plan · wired→current Seed · live→all done, as before.) Pure config change.

const LOGIC = `function initState(source){source=source||{};
var stepKey=String(source.step||'plan');
var idx=stepKey==='plan'?1:(stepKey==='data'?3:(stepKey==='wired'?4:(stepKey==='seeded'?5:(stepKey==='live'?6:1))));
var labels=['Design','Plan','Daten','Aktoren','Seed','Live'];
var steps=[];
for(var i=0;i<labels.length;i++){
	var st=i<idx?'done':(i===idx?'current':'pending');
	steps.push({label:labels[i],state:st,mark:i<idx?'\\u2713':String(i+1)});
}
var hints={
	plan:'Noch nichts erstellt \\u2014 dieser Plan ist ein Vorschlag aus deinen Beispieldaten. Sag \\u201eweiter\\u201c, um die Datenschicht zu bauen, oder \\u00e4ndere ihn (z.\\u2009B. Feld entfernen, Typ umbenennen).',
	data:'Datenschicht steht \\u2014 Vokabular (x1\\u2013x5), Bundle und CRUD-Operationen sind angelegt. Sag \\u201eweiter\\u201c, um die Aktoren zu verdrahten.',
	wired:'Skill + Sandbox-Aktor sind verdrahtet (Code-Testlauf bestanden). Als N\\u00e4chstes: Beispieldaten einspielen \\u2014 oder \\u00fcberspringen und direkt promoten.',
	seeded:'Beispieldaten sind als echte Datens\\u00e4tze gespeichert. Sag \\u201eweiter\\u201c f\\u00fcr den finalen Schritt: promoten und live gehen.',
	live:'Die App ist live \\u2014 echte Daten, gleiche Karte.'
};
var es=source.entities||[];var out=[];
for(var j=0;j<es.length;j++){var e=es[j]||{};
	out.push({type:String(e.type||'\\u2014'),
		fieldsLabel:(e.fields||[]).join('  \\u00b7  '),
		seedLabel:(e.seedRows||0)>0?((e.seedRows)+' Beispielzeilen als Startdaten'):''});
}
var ag=source.aggregates||[];
return{app:String(source.app||'\\u2014'),steps:steps,
	hint:hints[stepKey]||hints.plan,
	entityHeading:out.length?'Was gespeichert wird':'',
	entities:out,
	aggLabel:ag.length?('\\u0192 Live berechnet (nicht gespeichert): '+ag.join(', ')):''};}
function handleEvent(t, p, s) { return s }`

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`INSERT INTO vibe_logic (name, body) VALUES ('skill-plan', ${LOGIC}) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
}

export async function down(): Promise<void> {
	// re-run 0096 to restore the previous logic.
}
