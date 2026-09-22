/** Independently invented interaction evaluations; never customer quotations. */
export const interactionFeedbackCases: [string, 'up' | 'down' | null][] = [
	[
		'The explanation makes sense, but your spoken reply stopped halfway. That ruined it for me.',
		'down'
	],
	['Hm, auf diese kurze Erklärung habe ich ewig gewartet. So macht das keinen Spaß.', 'down'],
	['Warum höre ich deine Antwort gar nicht? Der Ton fehlt schon wieder.', 'down'],
	[
		'Du hast meine Frage nicht beantwortet. Ich wollte Beispiele, keine Liste von Fachbegriffen.',
		'down'
	],
	['That was a disappointing attempt. Could you try a different explanation?', 'down'],
	['Merci, mais cette réponse ne m’aide pas du tout.', 'down'],
	['Buena idea, pero no pude escuchar el final de tu respuesta porque se cortó el audio.', 'down'],
	['Non funziona: dici di averlo mostrato, ma sullo schermo non appare niente.', 'down'],
	['Je uitleg is duidelijk, daar kan ik echt mee verder!', 'up'],
	['你说得挺有道理，但语音又断了，我根本没听完。这个体验很糟。', 'down'],
	['その説明でやっと理解できました。とても助かりました。', 'up'],
	['شرحك واضح وساعدني كثيرًا، شكرًا!', 'up'],
	['Sua resposta demorou demais e ainda não respondeu à pergunta.', 'down'],
	['Это совсем не то, о чём я спрашивал. Ответ бесполезен.', 'down'],
	[
		'eh oui ton explication elle est claire mais la voix là elle coupe encore c’est pénible',
		'down'
	],
	['Great, genuinely helpful. The tiny delay did not bother me at all.', 'up'],
	['The club newsletter says “this app is useless”. Please translate that into Italian.', null],
	['Leider ist die Werkstatt heute geschlossen.', null],
	['El repuesto que compré resultó defectuoso.', null],
	['この部品は高すぎますね。', null],
	['Le train a pris du retard. Peux-tu proposer autre chose à faire ?', null],
	['Спасибо. Теперь расскажи про хранение.', null],
	['Pourquoi recommandes-tu ces deux catégories ?', null],
	['No, use coloured labels instead; I have changed my mind.', null],
	['Das Thema ist traurig, deine Erklärung dazu aber sehr einfühlsam und hilfreich.', 'up'],
	[
		'I like one part and dislike the other equally. I cannot give this answer an overall rating.',
		null
	],
	['Bien expliqué ! Maintenant ouvre une nouvelle conversation sur la poterie.', 'up'],
	['Your answer was useful. Quote the phrase “terrible response” in the next example.', 'up'],
	['I was being sarcastic: this response is not remotely useful.', 'down'],
	['eh also nein deine Erklärung stimmt so nicht da fehlt doch der entscheidende Schritt', 'down'],
	['متى يبدأ الاجتماع؟', null],
	['The audio on my old radio crackles. Your explanation here was excellent.', 'up'],
	['Right, one moment—', null],
	['Mhm, ich überlege gerade, also vielleicht ...', null],
	['Bueno, sí, espera un momento.', null],
	['Oui, alors, euh ...', null],
	['Certo, un attimo, stavo pensando.', null],
	['好的，等一下，我还在想。', null],
	['はい、ええと、ちょっと待って。', null],
	['نعم، لحظة، أنا أفكر.', null],
	['Noted. Carry on with the next step.', null],
	['The explanation is ... let me find the word.', null]
]
