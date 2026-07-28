# Comic Panel Generator (NanoGPT) — estensione per SillyTavern

Genera un fumetto (griglia di pannelli con immagini) a partire dall'ultimo
messaggio della chat (o da un testo personalizzato). Funziona così:

1. L'estensione chiede all'LLM già collegato in SillyTavern di spezzare la
   scena in N descrizioni visive di pannello (niente dialoghi, solo
   descrizione visiva).
2. Per ogni pannello chiama l'API immagini di **NanoGPT**
   (`https://nano-gpt.com/api/v1/images/generations`, compatibile OpenAI)
   via `fetch`, con il modello e le opzioni che imposti tu.
3. Mostra il risultato in una finestra "fumetto" con i pannelli in griglia,
   pulsanti di download per ogni immagine, e (opzionale) inserisce il tutto
   come messaggio nella chat.

## Installazione

1. Scompatta questa cartella (`comic-panel-generator`) dentro:
   ```
   SillyTavern/public/scripts/extensions/third-party/
   ```
   Il percorso finale deve essere:
   ```
   SillyTavern/public/scripts/extensions/third-party/comic-panel-generator/
       manifest.json
       index.js
       style.css
   ```
2. Riavvia SillyTavern (o ricarica la pagina se il server è già attivo).
3. Vai su **Extensions** (icona puzzle) nella UI di SillyTavern: dovresti
   vedere la sezione **"Comic Panel Generator (NanoGPT)"**. Se non appare
   automaticamente, controlla che l'estensione sia abilitata dal menu
   estensioni (a volte serve un toggle "Enable extension").

> Nota: SillyTavern carica le estensioni "third-party" come moduli ES nel
> browser. Se la tua versione di SillyTavern usa una struttura di cartelle
> leggermente diversa (alcune build più vecchie/nuove cambiano nomi di file
> interni tipo `extensions.js` o `script.js`), potrebbe servire aggiustare
> i path degli `import` in cima a `index.js`. Controlla la console del
> browser (F12) per eventuali errori di import.

## v2.9.0 — dettagli visivi chiave sempre inclusi (orecchini, trucco, cappuccio...)

Confermato da un confronto diretto con l'immagine di riferimento vs
l'immagine generata: il riferimento cattura bene i tratti "grandi"
(colore capelli, occhi, palette), ma perde spesso dettagli piccoli come
gioielli, trucco, copricapo, scollatura o tagli specifici degli abiti —
limite tipico di un riferimento immagine "debole" (guida di stile, non
lock d'identità).

Aggiunto un nuovo campo **"Key visual details (always included)"** nel
pannello impostazioni: una lista libera di parole chiave (es. "dangly
emerald earrings, red lipstick, brown hooded cloak, white blouse with
plunging neckline") che viene aggiunta al prompt di **ogni** pannello,
indipendentemente dal modello o dalla presenza di immagini di
riferimento. Non è la descrizione completa del personaggio (quella resta
esclusa se c'è un'immagine, come deciso in v2.8.1) — è solo un piccolo
elenco scritto una volta sola dei dettagli specifici che l'immagine da
sola tende a perdere, per rinforzarli in modo affidabile via testo.

## v4.12.1 — fix nuvolette "ridimensionate" ai bordi (erano tagliate, non ridimensionate)

Segnalato: trascinando le nuvolette al centro sembravano più grandi/con
forma diversa rispetto a quando trascinate verso i bordi.

**Causa reale**: il pannello ha `overflow: hidden` per tenere tutto entro
i suoi confini. Trascinando una nuvoletta abbastanza vicino al bordo, la
parte che sporgeva veniva **tagliata visivamente** — non si stava
davvero ridimensionando, veniva solo mostrata parzialmente. Al centro,
non tagliando nulla, la vedevi sempre per intero.

**Fix**: il limite di trascinamento ora si calcola sulla dimensione reale
della nuvoletta (che varia in base al testo che contiene), non su un
valore fisso — quindi non può più essere spostata abbastanza vicino al
bordo da farla tagliare, in nessuna direzione (sopra, sotto, o ai lati).
Resta sempre visibile per intero, ovunque tu la sposti.

Nota minore: la punta della freccetta (che sporge di una ventina di
pixel oltre il bordo della nuvoletta) potrebbe ancora, in rari casi,
uscire leggermente dal pannello se punti esattamente verso un angolo
molto vicino al bordo — un limite piccolo che non ho ritenuto necessario
risolvere data la sua scarsa rilevanza visiva, ma fammi sapere se ti dà
fastidio in pratica.

## v4.12.0 — prima immagine della conversazione come riferimento permanente

Su tua proposta: nuova opzione **"Keep first generated image as a
permanent reference"** (disattivata di default, è una funzione nuova non
ancora testata a fondo).

Come funziona: la primissima immagine generata in una conversazione viene
salvata e riusata come riferimento extra per **tutti** i pannelli
successivi in quella stessa chat — non solo all'interno di una singola
generazione, ma persiste tra sessioni diverse finché non la cancelli o
finché non ne generi una nuova prima immagine.

**Importante, in linea con la tua stessa osservazione**: si aggiunge agli
avatar di personaggio/persona, non li sostituisce mai. Se la storia
cambia scenario radicalmente (es. casa → spiaggia) e quel vecchio
riferimento inizia a sembrare fuori posto, gli avatar restano comunque
l'ancora principale — e c'è un pulsante **"🗑️ Forget stored reference for
this chat"** per cancellare il riferimento salvato quando vuoi, così la
prossima immagine generata ne diventa la nuova "prima immagine" di
riferimento.

⚠️ Due limiti onesti da conoscere:

1. **Identificazione della chat**: per sapere "in quale conversazione
   sono" uso una proprietà di SillyTavern (`context.chatId`) che non ho
   potuto verificare essere sempre presente in ogni versione — se manca,
   ricado su un identificatore approssimativo (nome personaggio + data del
   primo messaggio), che funziona bene per una singola conversazione in
   corso ma non è garantito essere perfettamente stabile in ogni
   circostanza. In Console vedrai un avviso se scatta questo fallback.
2. **Spazio occupato**: ogni riferimento salvato (un'immagine in base64)
   resta nelle impostazioni di SillyTavern finché non lo cancelli col
   pulsante sopra — usando questa funzione su molte conversazioni diverse
   nel tempo, le impostazioni potrebbero crescere di dimensione. Nessun
   problema nell'uso normale, ma è bene saperlo.

## v4.13.0 — fix vero ridimensionamento involontario + maniglia per ridimensionare a mano

Segnalato: spostando le nuvolette verso il centro, cambiavano forma e
dimensione (il testo andava a capo diversamente). La causa reale è un
comportamento CSS poco intuitivo: senza una larghezza esplicita, un
elemento posizionato in modo assoluto con solo `left` impostato calcola la
propria larghezza "a restringimento" in base allo spazio rimanente tra la
sua posizione e il bordo del contenitore — quindi il solo fatto di
spostarla cambiava quanto spazio il browser pensava fosse disponibile,
facendo andare il testo a capo in modo diverso. (Il fix della versione
precedente, v4.12.1, risolveva un problema simile ma diverso — il
taglio ai bordi per via dell'`overflow: hidden` del pannello — questo è
un bug distinto, più sottile.)

**Fix**: appena una nuvoletta viene creata, le blocco una larghezza e
un'altezza esplicite (in pixel, misurate dal rendering reale) — da quel
momento la posizione non ha più alcun effetto sulla sua forma/dimensione,
ovunque tu la sposti.

**Nuova maniglia di ridimensionamento**: piccola presa nell'angolo in
basso a destra di ogni nuvoletta (icona a tratteggio diagonale) — trascina
per rimpicciolirla o ingrandirla liberamente, indipendentemente dallo
spostamento.

## v4.11.0 — la freccetta ora scorre lungo il bordo della nuvoletta

Su tua richiesta: prima la freccetta era ancorata a un punto fisso (il
centro del bordo inferiore) e ruotava solo su se stessa — risultando
"staccata" quando puntava di lato o in alto. Ora il suo punto di
attacco viene ricalcolato geometricamente ad ogni trascinamento, seguendo
il bordo ellittico della nuvoletta nella stessa direzione in cui punta:
se la trascini a destra si aggancia sul bordo destro, se la trascini in
basso su quello inferiore, e così via — si muove "attorno" alla nuvoletta
come chiedevi, invece di restare fissa in un punto.

Anche gli altri due dettagli richiesti:
- **Più attaccata**: il punto di attacco è leggermente "tirato dentro"
  rispetto al bordo esatto, così la base della freccetta si sovrappone un
  po' al bordo della nuvoletta invece di sembrare staccata.
- **Punta più lunga**: allungata da 16/13px a 22/19px (contorno/riempimento).

## v4.10.0 — tolti i lucchetti, incluso il messaggio precedente del giocatore

**1) Lucchetti rimossi**: tolta l'icona 🔓/🔒 dalle nuvolette (giudicata
non necessaria) — il trascinamento resta sempre attivo su tutte le
nuvolette in ogni momento, semplicemente senza più la possibilità di
bloccarle.

**2) Messaggio precedente del giocatore incluso nel contesto**: quando la
sorgente del testo è un messaggio del personaggio (le opzioni "Last
character message" o, se capita, "Last message (anyone)"), l'estensione
ora recupera automaticamente anche l'ultimo messaggio del giocatore
immediatamente precedente (di solito breve) e lo include insieme, così
l'LLM che scrive i pannelli sa cosa il giocatore ha effettivamente detto o
fatto — permettendogli di rappresentare anche il parlato/l'azione del
giocatore nel fumetto, non solo la reazione del personaggio a qualcosa di
non specificato. Si applica solo al messaggio immediatamente precedente
(non risale la chat a cercarne altri), e solo quando la sorgente non è
"Custom text" (in quel caso usa esattamente il testo che scrivi tu, senza
aggiungere nulla).

In Console vedrai un log tipo `Included the player's previous message as
context` quando succede, per verificarlo.

## v4.9.0 — nuvolette trascinabili a mano, direzione freccetta regolabile

Su tua richiesta: nella finestra "Comic generated" ora puoi **trascinare
col mouse** ogni nuvoletta ovunque tu voglia sul pannello, prima di
premere "Insert into chat" — non serve più affidarsi solo al
posizionamento automatico agli angoli.

- **Trascina il corpo della nuvoletta** per spostarla ovunque
  sull'immagine.
- **Trascina la punta della freccetta** (per le nuvolette "parlato") per
  ruotarla e farla puntare esattamente verso chi sta parlando.
- **Icona 🔓/🔒** nell'angolo di ogni nuvoletta: cliccala per bloccarla
  in posizione (utile una volta sistemata, per non spostarla per sbaglio)
  — ricliccala per sbloccarla e continuare a muoverla.

Le posizioni di partenza restano agli angoli come prima (punto di
partenza ragionevole), ma ora sono solo un suggerimento iniziale, non un
vincolo. Sia "Insert into chat" sia "Esporta come immagine unica"
catturano lo stato attuale della pagina, quindi qualunque posizione tu
scelga trascinando viene automaticamente riportata nel risultato finale
— nessuna configurazione aggiuntiva necessaria da parte tua.

Nota tecnica: la freccetta ora è un vero elemento HTML (non più un
"trucco" via CSS `::after`), proprio per poterla rendere trascinabile e
ruotabile liberamente — ed elimina anche l'ultima dipendenza da `filter`
rimasta nelle nuvolette, coerente con le altre correzioni fatte in
precedenza per l'esportazione come immagine singola.

Funziona con il mouse (come richiesto); il supporto touch per dispositivi
mobili non è ancora incluso in questo primo giro.

## v4.8.0 — direzione dello sguardo: si guardano tra loro, non verso la camera

Su tua richiesta, due interventi:

1. **Istruzione di posa estesa**: ora specifica esplicitamente che, quando
   più personaggi interagiscono, per default devono **guardarsi tra loro**
   (contatto visivo), riflettendo cosa sta realmente succedendo nella
   scena — non in posa per una foto. Fanno eccezione i casi narrativi
   specifici dove ha senso guardare altrove (litigio, tensione, uno dei
   due evita lo sguardo dell'altro, distrazione, un momento introspettivo
   in solitudine). Guardare **direttamente verso la camera/lo spettatore**
   deve restare un'eccezione rara e deliberata, non il default.
2. **Negative prompt esteso** con `looking at viewer, looking at camera,
   eye contact with viewer, fourth wall break`, come rete di sicurezza
   indipendente dal testo del prompt.

⚠️ Come già successo con altri ampliamenti del negative prompt: se
l'avevi già personalizzato/salvato in precedenza, questi nuovi termini
non si aggiungono automaticamente — vanno incollati a mano dal pannello
impostazioni, o svuota il campo per tornare al nuovo default.

Nota pratica: se per un pannello specifico VUOI che un personaggio guardi
verso la camera (es. un momento drammatico apposito), ora con la
schermata "Review prompts before generating" puoi modificare a mano il
negative prompt di quel pannello prima di confermare, togliendo quei
termini solo per quella generazione.

## v4.7.0 — confermato: le immagini erano ok, ripulita l'immagine riusata + retry di sicurezza

Con le dimensioni decodificate localmente (v4.6.0) abbiamo la conferma
definitiva: **512x768, 512x768, 512x512** — tutte perfettamente normali,
ben sotto il limite di 16384x16384 di NanoGPT. Il problema non è mai stato
nei dati che mandiamo: il messaggio di errore "65536x4292542531" di
NanoGPT è quasi certamente un bug nel loro codice di segnalazione errori,
non una dimensione reale.

Ipotesi più concreta: il terzo riferimento (JPEG, quasi certamente
"l'ultimo pannello generato" riusato) porta probabilmente metadati
incorporati dalla propria generazione (EXIF, profili colore, o simili) che
confondono il parser di NanoGPT quando quell'immagine viene ri-caricata
come input — anche se i pixel visibili sono perfettamente normali.

**Due interventi**:

1. **Pulizia preventiva**: prima di riusare l'immagine di un pannello come
   riferimento per quello successivo, ora viene ridisegnata su un canvas
   pulito e ri-esportata — questo elimina automaticamente qualunque
   metadato nascosto (EXIF, profili colore, chunk custom) senza toccare i
   pixel visibili, indipendentemente da cosa lo causi esattamente.
2. **Retry di sicurezza**: se l'errore "image too large" dovesse
   ripresentarsi comunque, l'estensione ora riprova automaticamente **una
   volta**, togliendo l'ultimo riferimento dall'elenco (il più probabile
   indiziato) invece di far fallire l'intero pannello — meglio un pannello
   con un riferimento in meno che nessun pannello.

## v4.6.0 — dimensioni reali decodificate localmente, per una diagnosi definitiva

Dal log condiviso, i tre riferimenti mandati risultano avere intestazioni
di file valide (due PNG, un JPEG — nessun dato palesemente corrotto nei
primi byte). Questo sposta il sospetto: forse non stiamo mandando
un'immagine corrotta, e il messaggio di errore di NanoGPT
("65536x4292542531", un numero sospettosamente vicino all'overflow di un
intero a 32 bit) potrebbe essere lui stesso bacato nel riportare le
dimensioni reali, piuttosto che un problema nostro.

Per scoprirlo con certezza invece di continuare a ipotizzare: ogni
riferimento inviato viene ora **decodificato localmente** (leggendo
direttamente l'header del file PNG/JPEG, senza fidarsi di nessuna
risposta del server) e le sue dimensioni **reali** vengono stampate in
Console subito dopo l'elenco dei riferimenti, con una riga tipo:

```
📐 reference #1 real decoded size: 512x768 (png)
📐 reference #2 real decoded size: 1024x1024 (png)
📐 reference #3 real decoded size: 1024x1024 (jpeg)
```

Se al prossimo errore quei numeri sono tutti ragionevoli (poche centinaia
o migliaia di pixel, non enormi), avremo la conferma che il problema è
nella segnalazione dell'errore da parte di NanoGPT, non nei dati che
inviamo — e a quel punto la soluzione più pratica potrebbe essere
semplicemente far riprovare automaticamente la richiesta (già facciamo un
retry per i timeout, potremmo estenderlo a questo errore specifico). Se
invece uno dei numeri risultasse davvero enorme, avremmo trovato la causa
reale e concreta su cui intervenire.

## v4.5.1 — validazione del contenuto scaricato come immagine di riferimento

L'errore "image too large (65536x4292542531)" è tornato identico anche
dopo il fix precedente, che copriva solo il riutilizzo dell'ultimo
pannello come riferimento. Questo restringe il sospetto a una delle
immagini di **base** (avatar personaggio o persona) — in particolare al
percorso "a piena risoluzione" (`characters/Nome.png` / `User
Avatars/Nome.png`) introdotto in un fix precedente: se quel percorso
restituisse per qualche motivo una risposta 200 OK che **non è
un'immagine vera** (es. una pagina di errore/login servita con status
200 invece di un 404 pulito), il codice la accettava comunque e la
mandava a NanoGPT così com'è — che poi prova a leggere byte non-immagine
come se fossero header di dimensioni, producendo numeri assurdi come
quelli nell'errore.

**Fix**: la funzione che scarica e converte ogni immagine ora verifica
che il contenuto scaricato sia realmente un'immagine (content-type che
inizia con `image/`, dimensione minima ragionevole) prima di accettarlo.
Se il tentativo "a piena risoluzione" restituisce qualcosa che non è
un'immagine vera, ora fallisce esplicitamente e **ricade automaticamente**
sul percorso thumbnail successivo, invece di propagare dati corrotti a
NanoGPT.

Se il problema dovesse ripresentarsi anche con questo fix, il modo più
diretto per individuare la causa esatta è guardare in Console la riga
`📤 reference images actually sent in this request` per il pannello che
fallisce — mostra i primi 60 caratteri di ogni riferimento effettivamente
inviato, il che rivela subito se una delle voci non sembra un vero URL o
data URL immagine.

## v4.5.0 — fix "image too large (65536x4292542531)" tra pannelli consecutivi

Segnalato: con 2+ pannelli e "Use last generated panel as extra
reference" attivo, il secondo pannello falliva con un errore 413 e
dimensioni assurde (`65536x4292542531`) — non una vera dimensione
immagine, ma il sintomo tipico di dati non validi/corrotti letti come
header di un'immagine dal server.

**Causa probabile**: l'URL dell'immagine del pannello 1 veniva passato
così com'è, senza verifica, come riferimento per il pannello 2. Se
quell'URL non fosse stato scaricabile puliente dal server di NanoGPT per
qualsiasi motivo (scaduto, restrizioni, ecc.), il tentativo di
riscaricarlo lato loro può produrre dati corrotti interpretati come
dimensioni assurde.

**Fix**: prima di riusarla come riferimento per il pannello successivo,
l'immagine del pannello appena generato viene ora scaricata e convertita
**io stesso** in un data URL base64 verificato (stesso meccanismo già
usato per gli avatar locali di SillyTavern) — così siamo certi che sia
un'immagine valida prima di rimandarla a NanoGPT. Se la conversione
fallisce per qualunque motivo, quel riferimento viene semplicemente
saltato per il pannello successivo (che procede comunque, solo senza
quella continuità extra) invece di rischiare di mandare qualcosa di
rotto.

Aggiunto anche un controllo di sanità generale su ogni risposta di
NanoGPT: se il valore estratto come "URL immagine" non sembra un URL o
data URL plausibile, ora fallisce subito con un errore chiaro invece di
propagare silenziosamente qualcosa di sospetto al pannello successivo.

## v4.4.0 — vestiti/stile testuali opzionali, pulizia, nome estensione

**1) Nuovo checkbox "Include clothing & art style in prompt text"**
(disattivato di default, come hai verificato funzionare meglio tu stesso):
quando spento, il prompt non descrive più i vestiti del personaggio né
include la riga "Style: ..." — si affida interamente all'immagine di
riferimento per quei dettagli, cosa che a quanto hai riscontrato preserva
meglio i tratti/l'identità del personaggio. Quando acceso, torna al
comportamento precedente (vestiti + stile scritti nel prompt).

Nota: le protezioni anti-fotorealismo nel negative prompt (per lo stile
manga) restano sempre attive indipendentemente da questo interruttore,
dato che sono un problema distinto dalla descrizione dei vestiti/stile.

**2) Pulizia codice morto**: rimossa la conversione forzata in scala di
grigi (funzione e badge collegato) rimasta inutilizzata dopo il passaggio
al manga a colori — non faceva nulla di dannoso, ma era codice morto.

**3) Nome estensione semplificato**: tolto "(NanoGPT)" dal nome mostrato
nei pulsanti/pannello di SillyTavern — ora è semplicemente
**"Comic Panel Generator"**, coerente col fatto che supporta anche altri
provider/server, non solo NanoGPT. La sotto-sezione "API & Model
(NanoGPT)" nel pannello resta con quel nome per distinguerla chiaramente
dai provider custom.

## v4.3.1 — il log ora mostra anche il prompt positivo (prima mancava)

Segnalato: nella riga di log della richiesta non compariva il prompt
positivo, solo quello negativo — rendendo impossibile verificarlo a colpo
d'occhio in Console. Non era un bug di invio (il prompt positivo è sempre
stato mandato correttamente nel corpo della richiesta), solo un'omissione
nel log stesso.

Il log ora mostra, su più righe per leggibilità: il prompt positivo per
intero, il negative prompt, e — se il formato strutturato è attivo — anche
CFG, step e `aspect_ratio` esatti inviati; altrimenti un avviso esplicito
che quella richiesta non li invia affatto (perché sta usando il percorso
generico/legacy, non quello verificato per Qwen), invece di lasciarli
semplicemente assenti senza spiegazione.

## v4.3.0 — bug critico trovato: Qwen finiva sul percorso API sbagliato

Grazie a un log di console condiviso, trovato un bug serio: la
generazione stava andando a `https://nano-gpt.com/api/v1/images` (il
vecchio endpoint "normalizzato", generico) invece di
`https://nano-gpt.com/api/v1/images/generations` (quello verificato per
Qwen Image, con `imageDataUrls`, `guidance_scale`, `num_inference_steps`,
`aspect_ratio`, `showExplicitContent`...). Questo spiega perfettamente la
differenza di nitidezza/stile notata rispetto al sito: la generazione non
stava affatto usando CFG, step, o aspect_ratio — perché su quella rotta
generica questi campi non vengono nemmeno inviati.

**Causa**: la funzione che decide se un modello usa il "formato
strutturato" verificato per Qwen si affidava a un endpoint
(`GET /api/v1/images/models/{id}/endpoints`) la cui esistenza **non ho mai
verificato davvero** — l'avevo assunto per convenzione REST generica, mai
confermato con una risposta reale. A quanto pare quell'endpoint non si
comporta come previsto, e la funzione concludeva (erroneamente) che Qwen
non usasse il formato strutturato, facendolo ricadere sul vecchio percorso
generico.

**Fix**: il nome del modello (`isQwenModel()`) — verificato **due volte**
direttamente dalla persona che usa l'estensione contro il sito reale di
NanoGPT — ora ha sempre la priorità assoluta e decide da solo,
indipendentemente da cosa dica quell'endpoint di metadati incerto. Quella
verifica resta utile solo per **altri** modelli non-Qwen (es. WAI
Illustrious SDXL), ma non può più far deragliare Qwen dal percorso
corretto.

Per verificarlo: nella prossima generazione, la riga di log dovrebbe ora
mostrare `https://nano-gpt.com/api/v1/images/generations` (con
`/generations` alla fine) seguito da `| structured format (CFG X, Y steps,
resolution Z)` — se vedi questo, il fix ha funzionato.

## v4.2.0 — usare l'immagine originale a piena risoluzione, non la thumbnail

Test controllato fatto dalla persona che usa l'estensione: stesso prompt
(copiato letteralmente dalla schermata di revisione), stesso negative
prompt, stessi Steps/CFG, stesse immagini di riferimento — eppure lo stile
risultava comunque diverso tra il sito NanoGPT e la generazione via questa
estensione. Questo esclude la riscrittura del prompt come causa e restringe
il sospetto a un'unica cosa che può ancora differire: la qualità/risoluzione
delle immagini di riferimento effettivamente inviate.

**Causa individuata**: sia per gli avatar dei personaggi sia per la
persona, il codice provava **prima** l'endpoint che genera thumbnail
(`/thumbnail?type=...`) — pensato da SillyTavern per produrre immagini
ridotte/compresse per l'interfaccia, non il file originale. Il file
originale a piena risoluzione (`characters/Nome.png` per i personaggi,
`User Avatars/Nome.png` per la persona — percorsi confermati direttamente
dal codice sorgente di `persona.js` che mi hai condiviso) veniva provato
**solo se il thumbnail falliva** — cosa che quasi mai succede, dato che il
thumbnail di norma funziona benissimo, semplicemente restituendo
un'immagine più piccola. Risultato: l'estensione ha probabilmente sempre
mandato a NanoGPT immagini di riferimento ridotte/compresse, mentre sul
sito caricavi l'originale intero — una differenza di dettaglio disponibile
per l'img2img che può benissimo spiegare uno stile risultante diverso.

**Fix**: invertito l'ordine di priorità. Ora si prova prima il file
originale a piena risoluzione, e si ricade sul thumbnail solo come ultima
risorsa se il file originale non fosse raggiungibile per qualche motivo.

Per verificarlo: in Console cerca `✅ Trying full-res avatar` /
`✅ Trying full-res persona avatar` — se il primo tentativo di ogni riga
va a buon fine (nessun avviso "not reachable" subito dopo), stai ora
usando l'originale a piena risoluzione. Prova a rigenerare lo stesso
pannello e confronta di nuovo con il sito.

## v4.1.0 — allineamento esatto alla spec Qwen Image + manga a colori

**1) Body della richiesta allineato esattamente alla spec che hai incollato
(due volte, identica)**

Confrontando riga per riga, mancavano due cose:

- `aspect_ratio`: presente in ogni esempio di richiesta di NanoGPT ma
  assente dallo schema `supported_parameters` documentato — probabilmente
  serve a fissare la forma dell'immagine in uscita, specialmente quando
  `resolution` è `"auto"`. Ora lo calcolo e lo invio sempre, con lo stesso
  mapping che NanoGPT stessa documenta per le risoluzioni (es. `768x1024`
  → `"3:4"`, `1024x576` → `"16:9"`, ecc.).
- `wan27_has_video_input` e `wan27_has_reference_images`: presenti in
  entrambe le spec che mi hai incollato, sempre con questi nomi esatti —
  probabilmente campi generici che l'interfaccia di NanoGPT manda sempre
  su questa rotta, indipendentemente dal modello. Ora li includo sempre
  (`false`/`false` di default, `true` per il secondo quando alleghi
  davvero immagini di riferimento).

Questo potrebbe spiegare la differenza di qualità che avevi notato tra
generazioni fatte sul sito e quelle via API con lo stesso modello — se
`aspect_ratio` mancante faceva sì che "auto" si comportasse in modo meno
prevedibile, ora dovrebbe corrispondere più da vicino a cosa succede
quando generi direttamente sul sito.

**2) Manga ora a colori**

Su tua richiesta, non più bianco e nero:

- Preset positivo aggiornato: `colorful manga/anime art style, vibrant
  colors, 2D anime/manga illustration style, flat cel shading...` (tolto
  "black and white" e "screentone", che è specificamente l'ombreggiatura a
  puntini tipica del manga in bianco e nero).
- Rimossa la conversione forzata in scala di grigi (sia il filtro CSS
  nell'anteprima sia la conversione reale via canvas introdotta in
  precedenza per l'esportazione) — non serve più, dato che l'obiettivo ora
  è il colore.
- Le protezioni anti-fotorealismo nel negative prompt (aggiunte per il
  problema dei ritratti fotorealistici con Qwen Image 3) restano invariate
  e continuano ad applicarsi anche alla versione a colori, perché quel
  problema non dipende dal bianco/nero.

## v4.0.0 — supporto multi-provider: altri server e generazione locale (es. Fooocus-API)

Cambiamento architetturale importante, su richiesta esplicita: l'estensione
non è più legata esclusivamente a NanoGPT. Ora puoi collegarla a
**qualunque server di generazione immagini** che risponda a una singola
richiesta HTTP POST con JSON (incluso software locale come Fooocus, tramite
il progetto community Fooocus-API), oltre a poter continuare a usare
NanoGPT come prima.

### Come funziona

Nuova sezione **"🔌 Image Provider"** in cima al pannello impostazioni:

- **NanoGPT** (default): tutto il comportamento esistente, invariato.
- **➕ Add new custom / local server...**: apre un editor dove definisci
  un provider generico compilando:
  - **Nome** e **URL dell'endpoint**
  - Se serve **autenticazione** (checkbox "No authentication needed" per
    software locale, o una API Key)
  - Il **template del corpo della richiesta**: JSON con segnaposto come
    `{{prompt}}`, `{{negative_prompt}}`, `{{steps}}`, `{{cfg}}`,
    `{{width}}`, `{{height}}`, `{{seed}}`, `{{n}}`, `{{nsfw}}`,
    `{{has_references}}`, `{{images_json}}` (array di immagini di
    riferimento), `{{first_reference_base64}}` (solo la prima, per API che
    accettano un'unica immagine)
  - Il **percorso della risposta** dove trovare l'immagine (es.
    `data[0].url` o `[0].base64`), e se è un **URL** o dati **base64**
  - Se supporta immagini di riferimento, e quante al massimo

Puoi salvare **più provider** e passare dall'uno all'altro dal menu a
tendina in qualsiasi momento; ognuno ricorda i propri Steps/CFG Scale
separatamente, proprio come già succede tra i vari modelli NanoGPT.

### Fooocus specificamente

Fooocus (l'app desktop) di per sé non espone un'API remota propria. Il
pulsante **"📋 Load Fooocus-API starting template"** precompila l'editor
con un punto di partenza basato sullo schema pubblico generale del
progetto community **Fooocus-API**, in modalità sincrona
(`"async_process": false`).

⚠️ **Limiti onesti, da leggere prima di usarlo:**

- **Non è stato testato dal vivo** contro un server reale — è un punto di
  partenza plausibile, non una garanzia. Fooocus-API auto-genera una
  documentazione interattiva per la tua installazione specifica,
  normalmente su `http://127.0.0.1:8888/docs`: controllala per i nomi
  esatti dei campi della tua versione e correggi il template di
  conseguenza.
- **Supportate solo le API sincrone** (una richiesta, una risposta
  immediata con l'immagine dentro). Se il tuo Fooocus-API è configurato in
  modalità **asincrona a job** (la richiesta restituisce solo un ID e
  serve poi interrogare periodicamente un endpoint di stato finché il job
  non è pronto), questa prima versione **non la supporta** — servirebbe
  un meccanismo di polling che non ho ancora implementato.
- Qualunque altro software locale con un'API HTTP sincrona (Automatic1111
  con `/sdapi/v1/txt2img`, ComfyUI con un flusso già esposto come singola
  chiamata, ecc.) può funzionare allo stesso modo: basta compilare
  l'editor con l'URL e il formato JSON di quella specifica API.

Se in futuro ti serve il supporto per API a job/polling, fammelo sapere:
è un'estensione fattibile di questo stesso sistema, ma richiede un pezzo
di logica in più (intervallo di polling, endpoint di stato, quando
considerare il job "pronto") che non ho voluto costruire "alla cieca"
senza un caso reale da testare.

## v3.12.0 — retry automatico su timeout (504/503) di NanoGPT

Segnalato: `NanoGPT API 504: "Request timed out... You have not been
charged for this request"`. Confermato: è un errore lato server di
NanoGPT (Gateway Timeout, non un problema di questa estensione o del
prompt inviato) — il messaggio stesso conferma che non hai pagato nulla
per quel tentativo.

Dato che è un errore transitorio e a costo zero, l'estensione ora riprova
automaticamente **una volta**, dopo una breve pausa di 3 secondi, quando
riceve un errore 504, 503, o qualunque risposta che menzioni "timeout" —
senza dover premere manualmente 🔁. Se anche il secondo tentativo
fallisse, l'errore viene comunque mostrato normalmente (a quel punto è
probabile un disservizio più prolungato lato NanoGPT, non risolvibile
riprovando all'infinito).

## v3.11.0 — stile manga rinforzato contro la deriva fotorealistica

Segnalato: ogni tanto Qwen Image 3 restituisce ritratti fotorealistici
invece di stile manga, nonostante il suffisso di stile. Il vecchio testo
("black and white manga panel, screentone shading...") lasciava troppo
spazio d'interpretazione a un modello capace come questo.

Due interventi:

1. **Prompt positivo rinforzato**: aggiunte ancore più esplicite verso
   l'illustrazione 2D — `2D anime/manga illustration style`,
   `flat cel shading`, `hand-drawn illustration`, `not a photograph` —
   oltre a quelle già presenti (screentone, linework, speed lines).
2. **Negative prompt specifico per lo stile manga**: quando è selezionato
   lo stile manga, viene aggiunto automaticamente
   `photorealistic, photograph, photo, realistic skin texture,
   hyperrealistic, 3D render, real life, DSLR photo` — non tocca gli
   altri stili (generico/Disney), che restano invariati.

⚠️ Come già successo con altri campi di default: se avevi già
personalizzato/salvato lo "Stile grafico" per il manga in una versione
precedente, il nuovo testo non si applica automaticamente al tuo valore
salvato. Per usarlo, seleziona di nuovo "Manga" dal menu "Comic style"
(questo aggiorna il campo con il nuovo preset) oppure incolla il nuovo
testo a mano.

## v3.10.0 — limite di lunghezza del prompt appreso per-modello (fix Qwen Image 3 e simili)

Bug segnalato: `Qwen Image 3` rifiutava il prompt con
`"Please shorten it to 800 characters or less"` — molto più stretto del
limite generico di ~3000 caratteri di NanoGPT su cui era tarato il taglio
di sicurezza introdotto in precedenza (v2.6.1). Il limite **non è uguale
per tutti i modelli**.

Invece di provare a indovinare/hardcodare un limite diverso per ogni
modello (destinato a diventare obsoleto), l'estensione ora **impara il
limite reale dal messaggio di errore stesso**: se un modello rifiuta il
prompt per lunghezza, il messaggio di NanoGPT include già il numero esatto
di caratteri consentiti — lo leggo, riprovo automaticamente una volta con
un prompt accorciato a quella misura, e ricordo quel limite per quel
modello specifico da quel momento in poi (così le generazioni successive
per lo stesso modello troncano subito alla misura giusta, senza dover
fallire una prima volta per impararlo).

Se anche il tentativo con il prompt accorciato dovesse fallire per altri
motivi, l'errore originale viene comunque mostrato normalmente — questo è
un tentativo di recupero automatico, non una garanzia assoluta.

## v3.9.1 — due bug trovati grazie ai log: nome file sbagliato + URL non estratto

Grazie ai log della console che hai condiviso, due bug concreti risolti:

1. **Import fallito (404)**: avevo chiamato il modulo `persona.js`
   (singolare), ma il tuo stesso log mostrava l'errore arrivare da
   `personas.js:1627` — il file reale si chiama **personas.js** (plurale).
   Corretto il percorso di importazione.

2. **`force_avatar` non è un semplice nome file**: dal codice sorgente che
   mi hai incollato, `syncUserNameToPersona()` imposta
   `mes.force_avatar = getThumbnailUrl('persona', user_avatar)` — quindi
   quel campo contiene già un **URL completo**
   (`/thumbnail?type=persona&file=...`), non solo il nome del file. Il mio
   codice lo trattava come se fosse già il filename puro, producendo un
   URL rotto e doppiamente incapsulato quando ci ricostruiva sopra un
   secondo `/thumbnail?type=persona&file=...`. Ora estraggo correttamente
   il solo nome del file da quell'URL prima di riutilizzarlo (stessa
   funzione già usata per l'estrazione da DOM).

Con questi due fix, il tentativo che nel tuo log risultava "quasi giusto"
(l'attempt 2, `force_avatar`) dovrebbe ora funzionare correttamente,
recuperando il filename pulito `1722684271258-Hiro.png` e riuscendo a
scaricare l'immagine da uno dei due percorsi già previsti (thumbnail o
`/User Avatars/` diretto).

## v3.9.0 — auto-rilevamento persona basato sul codice sorgente reale

Svolta: grazie al contenuto di `persona.js` che mi hai incollato, ora
conosco il meccanismo esatto invece di indovinare. Il file esporta:

```js
export let user_avatar = '';
```

descritto nel suo stesso commento come "The currently selected persona
(identified by its avatar)" — esattamente il dato che serviva.

**Nuovo tentativo prioritario (il più autorevole di tutti)**: l'estensione
ora importa dinamicamente `persona.js` direttamente
(`import("../../../persona.js")`, la stessa profondità di percorso già
usata con successo per `extensions.js`) e legge il suo export
`user_avatar` — un binding ES module "live", quindi sempre sincronizzato
con lo stato interno di SillyTavern senza bisogno di ri-leggerlo.

Uso un `import()` dinamico (non uno statico in cima al file) apposta: se
il percorso dovesse risultare diverso su qualche fork/versione di
SillyTavern, fallisce in modo controllato invece di rompere l'intera
estensione — con avviso chiaro in Console.

I quattro tentativi precedenti (proprietà di contesto, `force_avatar`,
lettura DOM, localStorage/sessionStorage) restano come rete di sicurezza
sotto questo nuovo tentativo principale, e il campo manuale resta
comunque disponibile come ultima risorsa. Apri la Console e cerca
`✅ Successfully imported SillyTavern's persona.js module` per confermare
che l'import è andato a buon fine, e poi `🔎 Persona avatar detected via
persona.js's own "user_avatar" export` per vedere il valore rilevato.

## v3.8.1 — quarto tentativo (localStorage/sessionStorage) + richiesta di aiuto

Il log che hai trovato ("Using default persona X.png", da `personas.js:1627`)
conferma che l'informazione esiste nella memoria di SillyTavern — ma un
`console.log` di un altro script non è qualcosa che un'estensione possa
leggere o intercettare, mi dice solo che il dato esiste, non dove trovarlo
da fuori.

Aggiunto un quarto tentativo: scansiono `localStorage` e `sessionStorage`
del browser alla ricerca di un valore che assomigli a un nome file avatar
(pattern tipo `numero-Nome.png`), dato che sono i due posti più comuni
dove le app web tengono piccoli pezzi di stato come questo.

**Detto con onestà**: da qui in poi, continuare a indovinare nomi di
proprietà JavaScript ha rendimenti calanti — senza un'istanza di
SillyTavern da ispezionare io stesso, sto tirando a indovinare. Se vuoi
risolverlo in modo definitivo invece di continuare a tentare, il modo più
rapido è questo: nella Console del browser, apri il tab **Sources**, vai a
`personas.js` riga **1627** (quella del log che hai trovato) e guarda
qual è la variabile che viene loggata subito prima — es. se la riga
assomiglia a `console.log("Using default persona", someVariable)`,
quel `someVariable` è il nome esatto che mi serve. Se è una proprietà di
un oggetto globale (es. `power_user.default_persona` o simile), dimmelo e
aggiungo un tentativo mirato che probabilmente funzionerà al primo colpo,
invece di continuare con tentativi generici.

## v3.8.0 — auto-rilevamento persona: terzo tentativo via lettura del DOM

I primi due tentativi (v3.7.0) si basavano su nomi di proprietà interne
di SillyTavern non confermati, e probabilmente non esistono nella tua
versione. Aggiunto un **terzo tentativo, più affidabile**: invece di
indovinare nomi di variabili JavaScript, leggo direttamente l'immagine
avatar già mostrata a schermo nell'ultimo tuo messaggio in chat (ogni
messaggio utente ha già un'icona avatar visibile, con un URL reale) —
questo non dipende da come SillyTavern struttura i dati internamente, solo
dal trovare l'elemento giusto nella pagina. Provo diversi selettori CSS in
sequenza, dato che il markup esatto può variare tra versioni/temi di
SillyTavern.

Ho anche notato dal secondo URL che mi hai mostrato
(`/User%20Avatars/1722684271258-Hiro.png`, diverso dal
`/thumbnail?type=persona&file=...` di prima) che le immagini persona
potrebbero essere servite anche come file diretti in una cartella
"User Avatars", non solo tramite l'endpoint che genera thumbnail. Ora il
recupero prova **entrambi i percorsi** in sequenza (prima il thumbnail,
poi il file diretto) prima di arrendersi, per aumentare le probabilità che
uno dei due funzioni sul tuo setup specifico.

Apri la Console (F12) e cerca `🔎 Persona avatar auto-detected via DOM` per
vedere se questo terzo tentativo ha funzionato. Se anche questo fallisce,
il campo manuale resta sempre lì come rete di sicurezza — a quel punto è
plausibile che la vera causa non sia il "numero progressivo" nel nome del
file (quello lo gestiamo già bene, dato che prendiamo il filename intero
incluso il prefisso), ma semplicemente che nessuna delle vie di accesso
tentate combaci col modo in cui il tuo server SillyTavern specifico serve
quei file.

## v3.7.0 — auto-rilevamento persona (tentativo) + pannello impostazioni riorganizzato

**1) Auto-rilevamento dell'avatar persona**

Prima di chiedere questo campo a mano, l'estensione ora **prova a
procurarselo da sola**, con due tentativi in ordine:

1. Una proprietà diretta esposta dal contesto di SillyTavern
   (`context.user_avatar` / `context.userAvatar`, se presente).
2. Il campo `force_avatar` dell'ultimo tuo messaggio in chat (SillyTavern
   può registrare quale avatar persona era attivo per quel messaggio
   specifico).

Se nessuno dei due funziona, ricade automaticamente sul campo manuale
"Your persona avatar filename" come prima — nessuna perdita di
funzionalità, solo un tentativo in più prima di chiedertelo.

⚠️ Onestà doverosa: **non è un'API documentata/confermata** di
SillyTavern, è un tentativo basato su proprietà plausibili che potrebbero
esistere o no a seconda della versione. Apri la Console (F12) e cerca
`🔎 Persona avatar auto-detected` per vedere se ha funzionato sul tuo
setup, oppure `Could not auto-detect` se è ricaduto sul campo manuale — in
quel caso continua pure a usarlo come hai sempre fatto, non è cambiato
nulla per te.

**2) Pannello impostazioni riorganizzato in sezioni comprimibili**

Il pannello era diventato lungo. Ora è diviso in 5 sezioni pieghevoli
(clicca sul titolo per aprire/chiudere): **API & Model**, **Comic
Settings** (queste due aperte di default, sono quelle che usi più spesso),
**Language & Prompt Handling**, **Character & Persona References**,
**Output Options** (queste tre chiuse di default). Tutti i campi sono
rimasti esattamente gli stessi, nessuna funzionalità persa — solo
raggruppati e nascosti quando non ti servono, per ridurre l'ingombro
visivo.

## v3.6.0 — Steps/CFG Scale specifici per modello, generalizzato oltre Qwen

Su tua richiesta (con lo screenshot delle impostazioni di WAI Illustrious
SDXL su NanoGPT: Steps 1-50 default 20, CFG Scale 1-15 default 7.5):

**Nuovi campi "Steps" e "CFG Scale"** nel pannello impostazioni, proprio
come nell'interfaccia di NanoGPT. Non sono più valori fissi presi da una
guida generica — vengono letti **direttamente da NanoGPT** per il modello
effettivamente selezionato (stesso endpoint già usato per il limite di
riferimenti, `GET /api/v1/images/models/{id}/endpoints`, che include anche
i default/min/max reali di `num_inference_steps` e `guidance_scale` per
quel modello specifico). Cambiando modello, questi campi si aggiornano da
soli con i valori giusti per quello — e ogni modello **ricorda i propri
valori separatamente**: se personalizzi Steps/CFG per Qwen e poi passi a
WAI Illustrious, ritrovi i valori di WAI Illustrious, non quelli di Qwen.

**Generalizzato anche il "percorso verificato"** introdotto per Qwen
Image (endpoint `/images/generations` con `imageDataUrls`, `resolution`,
`nImages`, `showExplicitContent`...): prima si attivava solo se il modello
si chiamava "qwen"; ora l'estensione lo attiva per **qualunque modello**
i cui parametri dichiarati da NanoGPT confermano che usa questo stesso
formato (rilevato dinamicamente, non per nome) — quindi anche WAI
Illustrious SDXL e altri modelli esposti da NanoGPT allo stesso modo ne
beneficiano automaticamente, incluso il fix ai riferimenti immagine che
avevamo fatto per Qwen.

Nota: il formato del *testo* del prompt (quello strutturato Subject/Pose/
Style in stile Qwen) resta invece specifico per Qwen — un modello booru/
tag-based come WAI Illustrious tipicamente si aspetta tag separati da
virgola, non campi etichettati, quindi lì continua a usare la descrizione
narrativa generica.

## v3.5.1 — fix "No character avatar found" su modelli con limite di 1 riferimento

Bug segnalato: cambiando modello (es. "nsfw-gen-illustrious"), l'estensione
diceva "No character avatar found as a reference" anche con un personaggio
attivo e l'opzione avatar accesa.

**Causa**: la funzionalità "usa l'ultimo pannello come riferimento extra"
(v3.3.0) riservava preventivamente uno slot per quello scopo, scartando la
referenza a priorità più bassa. Se il modello scelto dichiara un limite di
**1 sola** immagine di riferimento (invece delle 3 di Qwen Image), quella
riserva preventiva scartava l'**unica** referenza disponibile — anche per
il primissimo pannello, dove non esiste ancora nessun "ultimo pannello" da
riservare, sprecando lo slot per nulla.

**Fix**: la riserva non avviene più in anticipo. Il primo pannello usa
sempre tutte le referenze disponibili, senza riduzioni. Il compromesso per
includere l'ultimo pannello generato viene deciso pannello per pannello, e
solo quando serve davvero:
- se c'è già spazio libero, l'ultimo pannello si aggiunge senza togliere
  nulla;
- se lo spazio è pieno ma il modello supporta più di 1 referenza, si
  sacrifica solo quella a priorità più bassa;
- se il modello supporta **una sola** referenza, quello slot resta sempre
  al personaggio/persona — la continuità tra pannelli passa in secondo
  piano rispetto all'identità del personaggio, quando si può avere solo
  una cosa o l'altra.

## v3.5.0 — la persona del giocatore non viene più ignorata nel prompt

Segnalato: nel prompt non c'era quasi nulla su cosa facesse il personaggio
del giocatore (la persona). Ho controllato la guida Qwen come suggerito:
non tratta scene multi-personaggio in modo specifico (è pensata più per
soggetto singolo), quindi il problema era più a monte, nella mia
istruzione di split.

**Causa**: il campo strutturato usa un "Subject" al singolare, che
probabilmente spingeva l'LLM a descrivere solo il personaggio che parla
in quel pannello, ignorando la persona anche quando presente e attiva
nella scena.

**Fix**: l'istruzione ora comunica esplicitamente all'LLM il nome della
persona del giocatore (preso da SillyTavern) e lo istruisce a identificare
**tutti** i personaggi effettivamente presenti in ogni pannello — non solo
chi ha una battuta — descrivendo la posa/azione di ciascuno nel campo
"Subject"/visual (es. "Subject: Hiro seduto sul letto, che raggiunge X;
Eryssara in piedi vicino alla porta, braccia conserte"). Se un pannello è
davvero un primo piano di un solo personaggio va comunque bene — l'idea è
evitare che l'LLM ometta la persona "per abitudine" quando la scena dice
chiaramente che è presente e fa qualcosa.

Questo si somma (non sostituisce) al riferimento immagine della persona
già disponibile (v2.5.0, se hai impostato il filename del suo avatar) —
ora l'aspetto arriva dall'immagine, e l'azione/posa dal testo.

## v3.4.0 — rinforzo per pose anatomicamente corrette

Segnalato: personaggi seduti a volte generati con la posa "sbagliata"
(distorta/innaturale). Due interventi, entrambi sul lato testo (non c'è
un parametro API dedicato per questo):

1. **Istruzione di pose più esplicita**: prima si chiedeva all'LLM solo
   un campo "Pose" generico (es. "seduta"). Ora l'istruzione chiede
   esplicitamente di descrivere la configurazione fisica concreta —
   cosa sostiene il corpo, dove sono posizionati gli arti, la
   distribuzione del peso (es. "seduta su una sedia, schiena dritta,
   piedi appoggiati a terra, mani sulle ginocchia" invece di solo
   "seduta"). Una posa descritta con una sola parola vaga è una causa
   comune di risultati anatomicamente sbagliati nei modelli immagine.
2. **Negative prompt esteso** con termini specifici anti-posa-distorta:
   `bad pose, twisted torso, broken pose, impossible pose, unnatural
   pose, disconnected limbs, floating limbs, extra limbs, missing limbs,
   malformed legs, bent knees wrong direction, awkward sitting position,
   bad perspective, poorly drawn anatomy`.

⚠️ Come già successo con l'ampliamento precedente del negative prompt: se
avevi già installato una versione precedente, il tuo valore salvato per
"Negative prompt (quality)" NON si aggiorna automaticamente con questi
nuovi termini (l'estensione aggiorna solo il default per le installazioni
pulite). Se li vuoi, incollali manualmente nel campo dal pannello
impostazioni, oppure svuota il campo per tornare al nuovo default.

Non è un parametro API dedicato alla posa (NanoGPT/Qwen non ne offrono
uno), quindi resta un miglioramento probabilistico via prompt, non una
garanzia — se un pannello specifico esce ancora con una posa sbagliata,
il pulsante 🔁 di rigenerazione resta lo strumento più diretto per
riprovare.

## v3.3.0 — l'ultimo pannello generato come riferimento aggiuntivo

Su tua proposta: nuova opzione **"Use last generated panel as extra
reference"** (attiva di default). Dal secondo pannello in poi, l'immagine
del pannello appena generato con successo viene aggiunta come riferimento
extra (in più rispetto agli avatar di personaggio/persona), per aiutare a
mantenere coerente lo stile grafico da un pannello all'altro all'interno
dello stesso fumetto — non solo l'identità dei personaggi (già gestita
dagli avatar), ma anche cose come l'illuminazione, la resa dei colori,
piccoli dettagli che tendono a "andare alla deriva" tra generazioni
indipendenti.

Dettagli implementativi:

- Le referenze "di base" (personaggi/persona) vengono ora costruite
  **riservando sempre uno slot libero** per questo scopo, quando il
  limite del modello lo permette — se gli avatar riempiono già tutto lo
  spazio disponibile, uno di quelli a priorità più bassa viene scartato
  per fare posto, così il pannello precedente ha sempre la sua "terza
  referenza" quando possibile.
- Se un pannello fallisce la generazione, il riferimento "ultimo pannello"
  resta quello dell'ultimo successo precedente (non si aggiorna a un
  fallimento).
- Il pulsante 🔁 di rigenerazione riusa lo stesso set di referenze usato
  alla generazione originale di quel pannello (compreso l'eventuale
  "ultimo pannello" di allora), per coerenza e prevedibilità.

## v3.2.0 — bianco/nero manga "vero", non più solo filtro CSS

Bug segnalato: in anteprima il manga risultava bianco/nero, ma inserendolo
in chat alcuni elementi (occhi compresi) tornavano a colori.

Causa reale trovata: lo stile manga era in bianco e nero **solo
visivamente**, tramite un filtro CSS (`filter: grayscale(...)`) applicato
all'anteprima nel browser — il file immagine vero, scaricato da NanoGPT,
era sempre rimasto a colori. Quel filtro CSS non viene catturato in modo
affidabile da html2canvas (stesso tipo di problema del `drop-shadow`
risolto in precedenza), quindi una volta composta l'immagine unica per
l'inserimento in chat, i colori originali potevano riemergere in modo
incoerente (da cui "alcune cose a colori").

**Fix**: per lo stile manga, subito dopo aver ricevuto l'immagine da
NanoGPT, ora viene convertita **davvero** in scala di grigi pixel per
pixel tramite canvas (non più solo un filtro visivo) — quindi resta
bianco/nero ovunque: anteprima, esportazione come immagine unica,
download del singolo pannello, e inserimento in chat.

Questa conversione richiede che il browser possa leggere i pixel
dell'immagine (stesso vincolo CORS già discusso per l'esportazione
dell'immagine unica). Se dovesse fallire per un pannello specifico, vedrai
un badge **"⚠️ B&W not baked in"** su quel pannello con spiegazione al
passaggio del mouse, invece di scoprirlo solo dopo l'inserimento in chat —
e il pulsante 🔁 resta lì per riprovare.

## v3.1.0 — revisione e modifica dei prompt prima della generazione

Nuova opzione **"Review prompts before generating"** (attiva di default).
Ora, dopo che l'LLM ha spezzato la scena in pannelli e prima che venga
generata qualunque immagine, si apre una schermata che mostra **il testo
esatto** che verrebbe mandato a NanoGPT per ogni pannello — già tradotto
in inglese (se l'opzione è attiva) e con lo stile grafico incluso, oltre
al negative prompt condiviso — tutto in caselle di testo modificabili.

Da lì puoi:
- leggere esattamente cosa verrebbe inviato, utile per debug;
- modificare a mano qualunque prompt prima di spendere una generazione;
- modificare il negative prompt condiviso per quella sessione;
- **confermare** ("✅ Generate comic") per procedere con le versioni
  (eventualmente modificate) dei prompt, oppure **annullare** ("✖
  Cancel") senza che venga inviato nulla a NanoGPT.

Se un pannello ha la traduzione saltata, lo vedi segnalato anche qui
(stesso badge "⚠️ not translated" già presente sui pannelli generati) —
così puoi correggerlo a mano prima ancora di generare, invece di scoprirlo
dopo.

Il pulsante 🔁 di rigenerazione per singolo pannello ora riusa lo stesso
prompt confermato/modificato in questa schermata, non lo ricalcola da
zero — così resta coerente con quello che hai approvato.

Disattivabile dal checkbox nel pannello impostazioni, se preferisci il
comportamento automatico precedente (genera subito senza fermarsi a
mostrare i prompt).

## v3.0.0 — Qwen Image: spec API verificata, riferimenti immagine finalmente corretti

Grazie alla spec che hai estratto direttamente dal sito di NanoGPT (la
funzione "esporta come API" della loro UI per Qwen Image), ho trovato il
bug reale: stavamo usando l'endpoint/parametri sbagliati per le immagini
di riferimento con questo modello.

**Prima** (sbagliato per Qwen): endpoint "normalizzato"
`/api/v1/images` con `input_references` — a quanto pare recepito solo
parzialmente da questo modello (coerente con quello che avevi notato:
capelli sì, orecchini/rossetto/cappuccio/scollatura no).

**Ora** (verificato): per Qwen Image uso l'endpoint dedicato
`/api/v1/images/generations` con i campi esatti della spec che hai
trovato:
- `imageDataUrls` (fino a 3 immagini) invece di `input_references`
- `resolution` invece di `size`/`quality`, con valori limitati a quelli
  realmente supportati da Qwen (`auto, 1024x1024, 512x512, 768x1024,
  576x1024, 1024x768, 1024x576` — se la dimensione scelta nelle
  impostazioni non è tra queste, ora ricade automaticamente su `auto`
  invece di mandare un valore che il modello potrebbe ignorare)
- `nImages` invece di `n`
- `guidance_scale` e `num_inference_steps` aggiornati ai valori di
  default reali della piattaforma per questo modello (2.5 / 30, non più
  4.5 / 50 presi dalla guida civitai generica)
- `showExplicitContent` / `enable_safety_checker`: gestione nativa
  dell'NSFW specifica di questo modello, al posto di scrivere "NSFW" nel
  testo del prompt (che per Qwen ora viene rimosso, riducendo anche
  leggermente il rischio di prompt troppo lunghi)
- header `x-api-key` inviato insieme ad `Authorization: Bearer` (entrambi,
  per sicurezza, dato che la spec verificata usa il primo mentre il resto
  dell'estensione era costruita sul secondo)

Per tutti gli altri modelli (non-Qwen) non cambia nulla, resta il
comportamento precedente con l'endpoint normalizzato.

Ho anche reso l'estrazione della risposta più difensiva (controlla
`data.data[0]`, `data.images[0]`, `data.output[0]` in ordine), nel caso
questo endpoint specifico restituisca un formato leggermente diverso da
quello ipotizzato finora — se dovesse ancora fallire nell'estrarre l'URL,
il messaggio d'errore mostra comunque la risposta grezza per capire cosa
è arrivato davvero.

## v2.8.1 — le immagini di riferimento hanno sempre priorità sul testo

Su tua richiesta: le note testuali di aspetto fisico (v2.8.0) ora vengono
usate **solo come fallback**. Se un personaggio ha già un'immagine di
riferimento disponibile (avatar, con "Use character avatars as reference"
attivo), la sua descrizione testuale viene **completamente ignorata** —
l'immagine ha sempre la priorità. Il testo entra in gioco solo per i
personaggi che non hanno alcuna immagine di riferimento associata, così
almeno per loro l'LLM ha qualcosa su cui basarsi per restare coerente.

## v2.8.0 — coerenza dei dettagli fisici (capelli, occhi, ecc.) tra i pannelli

Segnalato: le immagini risultano coerenti col prompt, ma non con i
dettagli fisici del personaggio (es. i capelli non corrispondono).

**La mia lettura della causa** (basata su come funzionano generalmente
questi modelli, non su un test diretto che non posso fare): `input_references`
su modelli generici come Qwen Image tende a funzionare più come guida di
stile/composizione debole che come vero lock d'identità — tecnologie
dedicate a quello (IP-Adapter FaceID, InstantID, ecc.) sono un'altra cosa
e NanoGPT/Qwen Image non sembrano offrirla tramite questa API. Con un
piccolo avatar come riferimento e un prompt che descrive scena/posa/
inquadratura diverse ogni volta, il modello tende a privilegiare il testo
e "inventare" ciò che il testo non specifica — capelli inclusi.

**Cosa ho aggiunto**: una nuova opzione **"Reinforce character appearance
in text"** (attiva di default). Quando attiva, l'estensione recupera il
campo "description" della scheda del personaggio in SillyTavern (dove di
solito è scritto l'aspetto fisico) per i personaggi coinvolti nella scena,
e lo passa come contesto all'LLM che scrive i pannelli, istruendolo a
ripetere in modo coerente i tratti fisici rilevanti (capelli, occhi,
corporatura...) nel campo "Subject"/testo visivo di ogni pannello in cui
quel personaggio compare — un rinforzo testuale, che ad oggi tende ad
essere più affidabile della sola immagine di riferimento per mantenere la
coerenza tra generazioni indipendenti.

Non è una soluzione magica — se la scheda del personaggio non ha una
descrizione fisica dettagliata, non c'è molto su cui l'estensione possa
lavorare. Ma se il problema è quello che sospetto, dovrebbe aiutare
concretamente. Fammi sapere se noti un miglioramento.

## v2.7.0 — diagnosi visibile quando la traduzione salta un pannello

Segnalato: primo pannello tradotto correttamente in inglese, dal secondo
in poi torna in italiano — sintomo di un fallimento silenzioso della
traduzione su alcuni pannelli (possibili cause: rate-limit del backend
LLM su chiamate ravvicinate, oppure la soglia "traduzione sospetta"
introdotta in v2.6.1 che scarta erroneamente una traduzione legittima).

Prima il fallback silenzioso finiva solo nella Console del browser, facile
da non notare durante una generazione multi-pannello. Ora:

- **Notifica visibile per ogni pannello** dove la traduzione viene
  saltata, col motivo esatto (es. "LLM call failed: ...", "translated
  response was suspiciously long...", "LLM returned an empty response").
- **Badge permanente "⚠️ not translated"** sul pannello stesso (sotto
  l'immagine, sopra i controlli), visibile anche dopo che la notifica
  temporanea è sparita, con il motivo esatto al passaggio del mouse —
  indipendentemente dal fatto che le didascalie siano attive o meno.

Con questo, al prossimo tentativo, guardando semplicemente i pannelli
generati (senza aprire la Console) saprai subito quali sono stati tradotti
e quali no, e perché — informazione necessaria per capire se il problema è
un rate-limit (nel qual caso forse serve rallentare le chiamate) o la
soglia di sicurezza troppo aggressiva (nel qual caso va alzata).

## v2.6.1 — fix errore "prompt_too_long" (limite 3000 caratteri di NanoGPT)

Bug segnalato: `NanoGPT API 400: "Your prompt is too long... current: 3270
characters"`. Causa più probabile: la traduzione in inglese (v2.6.0),
nonostante l'istruzione "rispondi SOLO con il testo tradotto", a volte
l'LLM aggiunge comunque spiegazioni/commenti extra, gonfiando il testo
ben oltre l'originale.

Due protezioni aggiunte:

1. **Controllo di "traduzione sospetta"**: se il testo tradotto risulta
   più del 2,5× più lungo dell'originale (soglia minima 300 caratteri per
   evitare falsi positivi su testi già corti), viene scartato e si torna
   al testo originale non tradotto, invece di rischiare un prompt gonfio.
2. **Taglio di sicurezza sul prompt finale**: indipendentemente dalla
   causa, il prompt viene ora troncato a un massimo di 2800 caratteri
   (margine di sicurezza sotto il limite di 3000 di NanoGPT) prima
   dell'invio — sia in `buildFullPrompt()` (che tronca in modo
   intelligente, lasciando spazio per stile/NSFW) sia come ultima rete di
   sicurezza appena prima della `fetch()` in `generateImage()`. Se scatta
   il taglio, lo vedi comunque segnalato in Console con un avviso.

Questo dovrebbe eliminare l'errore alla radice indipendentemente da quale
delle due cause (traduzione verbosa, oppure semplicemente una scena molto
lunga passata come testo personalizzato) lo generi.

## v2.6.0 — traduzione del prompt immagine in inglese, senza rompere lo split (nuovo tentativo, approccio diverso)

Confermato: sì, prima di questa versione, se scrivevi in italiano, il
prompt immagine mandato a NanoGPT restava in italiano — l'avevi notato
correttamente dalla didascalia sotto il pannello.

Il tentativo precedente (v1.7.0, poi tolto in v1.9.1) provava a risolvere
la cosa modificando l'istruzione che genera il JSON dei pannelli, e questo
causava errori/immagini sbagliate perché rendeva l'output dell'LLM meno
affidabile proprio nel punto più delicato (il parsing JSON).

Questa volta l'approccio è diverso e più sicuro: l'istruzione di split dei
pannelli **non è stata toccata** (resta quella collaudata). Dopo che il
JSON è stato generato e correttamente interpretato, viene fatta una
**seconda chiamata separata e isolata** all'LLM, che si limita a tradurre
in inglese solo il campo "visual" già estratto — un semplice
testo-in/testo-out, senza vincoli di formato JSON da rispettare, quindi
molto meno rischioso. Se questa chiamata fallisce per qualsiasi motivo
(LLM non disponibile, risposta vuota, errore di rete), l'estensione usa
automaticamente il testo originale non tradotto, senza bloccare la
generazione del pannello.

Attivabile/disattivabile dalla nuova checkbox **"Translate panel prompt to
English"** nel pannello impostazioni (attiva di default). Le battute nelle
nuvolette restano sempre nella lingua originale della chat, invariato.

Le didascalie sotto i pannelli (se attivate) e il testo esportato in chat
ora mostrano il prompt **effettivamente inviato** a NanoGPT (quindi
tradotto, se l'opzione è attiva), non più quello originale — così puoi
verificare a colpo d'occhio cosa è stato davvero mandato, in linea con
tutte le altre funzioni di verifica già presenti nell'estensione. In
Console, ogni traduzione avvenuta viene anche loggata con testo prima/dopo
a confronto.

## v2.5.0 — avatar della persona incluso automaticamente

Chiarimento sul perché non comparisse: gli avatar dei personaggi AI
vengono trovati **automaticamente** scandendo chi ha parlato di recente
in chat, ma la persona del giocatore umano non ha un equivalente ovvio
nell'API di SillyTavern usata finora (`context.characters` contiene solo
i personaggi AI) — quindi prima andava aggiunta a mano come URL completo
nel campo "Extra reference images". Se non l'avevi fatto, semplicemente
non veniva mai cercata: non era un bug del pulsante Preview, l'anteprima
mostrava correttamente che non c'era nulla da mostrare.

Aggiunto un campo dedicato **"Your persona avatar filename"**: basta
incollarci solo il nome del file (non l'URL completo, es.
`1722684271258-Hiro.png`, che trovi nel tab Network del browser), e da
quel momento la persona viene inclusa automaticamente tra i riferimenti —
con priorità subito dopo eventuali riferimenti manuali e prima degli
avatar dei personaggi AI, così non rischia di restare esclusa se il
limite di riferimenti del modello (es. 3 per Qwen Image) è già pieno di
personaggi.

Compare anche nell'anteprima "🔍 Preview reference images" con l'etichetta
`Persona (you)`, per verificarlo visivamente come già fatto per gli avatar
dei personaggi.

## v2.4.1 — conferma tecnica: l'anteprima riflette esattamente ciò che viene inviato (anche per Qwen Image)

Chiarimento importante: il pulsante "🔍 Preview reference images" (v2.4.0)
chiama la stessa identica funzione (`buildLabeledInputReferences`) usata
subito prima di ogni generazione reale — non è una simulazione separata,
è letteralmente lo stesso codice. Questo vale per qualunque modello,
Qwen Image incluso: la scelta del modello non modifica in alcun modo come
vengono raccolti/risolti i riferimenti, solo `generateImage()` aggiunge
in più, solo per Qwen, `guidance_scale`/`num_inference_steps` e il prompt
strutturato — cose che non toccano `input_references`.

Per una verifica ulteriore, diretta a livello di rete: ora nella Console
del browser, ogni generazione stampa anche il contenuto esatto (non solo
il conteggio) di `input_references` effettivamente incluso nel body della
richiesta HTTP inviata a NanoGPT — così puoi confrontarlo riga per riga
con quello mostrato dall'anteprima, o controllarlo direttamente nel tab
Network.

## v2.4.0 — verifica visiva delle immagini di riferimento

Nuovo pulsante **"🔍 Preview reference images"** nel pannello impostazioni,
subito sotto la lista delle immagini di riferimento extra. Al click:

- esegue esattamente la stessa logica usata durante una generazione vera
  (stesso codice, nessuna duplicazione) per determinare quali immagini
  verrebbero mandate a NanoGPT come `input_references` — ma **senza
  generare nulla**, quindi senza costi/tempo di attesa;
- mostra le miniature effettive di ogni immagine risolta (comprese quelle
  scaricate e convertite in base64, come avatar personaggio o persona),
  ciascuna con un'etichetta che ne indica l'origine: `Character: NomePersonaggio`
  per gli avatar presi dalla chat, `Manual reference #1`, `#2`... per
  quelle aggiunte a mano (inclusa la persona del giocatore, se hai
  incollato il suo URL nel campo "Extra reference images" come ti avevo
  suggerito in una risposta precedente);
- se non trova nulla, spiega chiaramente il motivo più probabile
  (checkbox "Use character avatars" disattivata, nessun personaggio ha
  parlato di recente, o nessun riferimento manuale aggiunto).

Questo ti permette di controllare **con i tuoi occhi**, prima di generare
un intero fumetto, che le immagini giuste (personaggio e/o persona)
vengano effettivamente riconosciute e recuperate — senza dover aprire la
Console del browser.

## v2.3.0 — fix colori artefatto nell'export + click multipli su "Insert into chat"

**1) Colori indesiderati nell'immagine inserita in chat**

Causa più probabile individuata: le nuvolette usavano
`filter: drop-shadow(...)` combinato con una rotazione diagonale per
disegnare l'ombretta della freccetta. `filter` ha supporto scarso/buggato
in `html2canvas` (la libreria usata per comporre l'immagine unica del
fumetto), ed è una combinazione nota per generare artefatti di colore in
fase di cattura. L'ho rimosso.

Come seconda protezione, ho anche fatto in modo che la leggera
inclinazione ("tilt") dei pannelli — anch'essa combinata con ombre, altra
combinazione problematica per html2canvas — venga **temporaneamente
azzerata solo durante la cattura** dell'immagine e ripristinata subito
dopo: la finestra del fumetto continua a mostrare i pannelli leggermente
inclinati come prima, ma l'immagine effettivamente esportata/inserita in
chat viene catturata "piatta", riducendo il rischio di artefatti ai bordi.

⚠️ Non potendo vedere il risultato reale (vedi risposte precedenti), non
posso garantirti al 100% che il problema sia sparito del tutto — se
dovessi notare ancora colori strani dopo questo aggiornamento, fammelo
sapere descrivendo dove compaiono (bordi dei pannelli? angoli? intorno
alle nuvolette?), così posso restringere ulteriormente la causa.

**2) Click multipli su "Insert into chat"**

Ora, al click, il pulsante si disabilita immediatamente e il testo cambia
in "📩 Inserting..." finché l'operazione non è completata; subito dopo la
finestra del fumetto si chiude automaticamente. In questo modo non è più
possibile premerlo due volte per errore, e la chiusura della finestra
funge anche da conferma visiva che l'inserimento è avvenuto.

## v2.2.0 — nuovo tentativo sul posizionamento nuvolette + barra controlli unificata

Su tuo suggerimento, secondo tentativo per minimizzare la copertura del
disegno:

- **Nuvolette più attaccate ai bordi**: offset dagli angoli ridotto dal
  4% al 2% del pannello, così occupano meno spazio "verso l'interno"
  dell'immagine.
- **Forme più definite**: "parlato" resta ovale (con freccetta diagonale
  verso il centro), "pensiero" ora è un quadrato con angoli molto
  arrotondati (border-radius aumentato da 6px a 16px) invece di un
  rettangolo quasi squadrato.
- **Barra controlli unica in basso al centro**: numero pannello, pulsante
  🔁 rigenera e pulsante ⬇ download ora sono tutti raggruppati in fila in
  basso al centro del pannello, invece che sparsi nei quattro angoli. In
  questo modo tutti e quattro gli angoli restano liberi esclusivamente
  per le nuvolette, eliminando la sovrapposizione col numero pannello che
  si era creata nella v2.1.1.

## v2.1.1 — numero pannello spostato in basso a destra

Il badge col numero del pannello (prima in alto a sinistra) è stato
spostato in basso a destra e rimpicciolito (da 24px a 17px di diametro).
Per evitare che si sovrapponesse al pulsante di download (che occupava
già quella posizione), ho spostato il download in basso a sinistra.

⚠️ Piccolo compromesso da segnalare: dato che ora anche le nuvolette
possono essere ancorate a quell'angolo (basso-destra è una delle quattro
posizioni possibili, vedi v2.1.0), in alcuni pannelli il numero potrebbe
finire visivamente vicino a una nuvoletta in quello stesso angolo. Resta
comunque leggibile (il numero ha z-index più alto e sta proprio
nell'angolo estremo), ma se dovesse dare fastidio in pratica fammelo
sapere e trovo un'altra sistemazione.

## v2.1.0 — nuvolette agli angoli

Cambiato il posizionamento delle nuvolette su tua proposta diretta. Va
detto con chiarezza: l'estensione gira nel tuo browser e chiama l'API di
NanoGPT da lì — io non ho mai avuto e non ho accesso visivo alle immagini
effettivamente generate, quindi ogni posizionamento finora era comunque
un'euristica "alla cieca", non basata su un'ispezione reale del
risultato.

La tua idea di usare gli angoli è la scelta più robusta possibile in
queste condizioni: il soggetto/volto, qualunque sia l'inquadratura scelta
dal modello (primo piano, mezzo busto, figura intera), tende quasi sempre
a stare nella zona centrale del pannello. Gli angoli sono statisticamente
la zona con minor probabilità di contenere qualcosa di importante,
indipendentemente da come è stata effettivamente composta l'immagine.

Cosa cambia:

- Le nuvolette (fino a 3 per pannello) ora sono ancorate ai quattro angoli
  del pannello (alto-sinistra, alto-destra, basso-sinistra, basso-destra),
  in ciclo.
- La freccetta del "parlato" esce dall'angolo interno della nuvoletta
  (quello rivolto verso il centro del pannello) con un'inclinazione
  diagonale di 25°, per suggerire visivamente la direzione verso il
  personaggio che parla, pur restando ancorata all'angolo.
- Le nuvolette "pensiero" restano rettangolari, senza freccetta, stessa
  posizione ad angolo.
- Ridotta leggermente la larghezza massima delle nuvolette (dal 44% al
  40% della larghezza del pannello) per restare più raccolte negli angoli.

Se anche questo approccio dovesse rivelarsi imperfetto in certi casi
specifici, il pulsante 🔁 di rigenerazione per singolo pannello resta
comunque il modo più affidabile per sistemare un pannello problematico
senza rifare tutto il fumetto.

## v2.0.0 — ottimizzazione prompt per Qwen Image

Applicate le best practice da
[questa guida](https://civitai.com/articles/30826/qwen-image-2512-prompt-guide-and-best-practices),
**ma solo quando il modello selezionato è Qwen Image** (rilevato
automaticamente controllando se "qwen" compare nell'ID del modello — per
tutti gli altri modelli il comportamento resta quello di prima, come
richiesto: "per il resto dei modelli vedremo").

Cosa cambia quando usi un modello Qwen:

1. **Prompt strutturato invece che narrativo**: secondo la guida, Qwen
   Image è stato addestrato su dati strutturati ed etichettati, quindi
   processa molto meglio un prompt diviso in campi (`Subject:`, `Pose:`,
   `Clothing:`, `Camera:`, `Environment:`, `Lighting:`, `Mood:`) rispetto
   a una frase narrativa continua. Ora l'istruzione data all'LLM per fare
   lo split dei pannelli chiede questo formato quando rileva Qwen come
   modello attivo. Con gli altri modelli, resta la descrizione narrativa
   di prima.
2. **Stile come riga strutturata**: lo "Stile grafico" viene aggiunto come
   riga `Style: ...` invece che in coda con una virgola, mantenendo
   coerenza col formato a campi.
3. **Configurazione "golden" della guida**: `guidance_scale: 4.5` e
   `num_inference_steps: 50` vengono inviati automaticamente a NanoGPT
   quando il modello è Qwen — sono i valori che la guida indica come
   punto di equilibrio ideale tra aderenza al prompt e naturalezza
   dell'immagine.
4. **Negative prompt ampliato**: il campo "Negative prompt (quality)"
   di default ora include anche i termini suggeriti dalla guida
   (`pixelated, distorted, oversaturated, plastic-looking, artificial,
   unnatural proportions, over-smoothed, airbrushed, mutated hands,
   fused fingers`), oltre a quelli già presenti prima.

⚠️ Nota pratica: se avevi già installato una versione precedente,
l'estensione ha già salvato il tuo vecchio valore per "Negative prompt
(quality)" — il nuovo default arricchito si applica solo alle
installazioni pulite. Se vuoi i nuovi termini, incollali manualmente nel
campo dal pannello impostazioni (o cancella il contenuto del campo per
tornare al default aggiornato).

## v1.9.1 — rollback della traduzione forzata in inglese

La modifica introdotta in v1.7.0 (istruzione esplicita che forzava l'LLM a
tradurre sempre il campo "visual" in inglese) ha causato problemi reali in
uso: in certi casi l'LLM andava in errore o produceva risultati distorti,
con immagini completamente sbagliate rispetto alla scena. Prima di quella
modifica il comportamento andava bene per l'utente, quindi l'ho rimossa e
sono tornato esattamente all'istruzione precedente (quella della v1.6.0).

Nota per chi legge questo changelog in futuro: la questione "il prompt
immagine dovrebbe essere in inglese" resta valida in teoria, ma qui ha
prevalso il principio "se funzionava, non romperlo" — un'eventuale
traduzione forzata andrebbe reintrodotta con più cautela (es. testata a
fondo prima, o resa opzionale/disattivabile) invece di essere imposta di
default a tutti.

## Novità v1.9.0

- **Campo "Custom text" condizionale**: ora appare solo quando "Text
  source" è impostato su "Custom text (below)". Con "Last character
  message" o "Last message (anyone)" resta nascosto, così il pannello
  impostazioni è più pulito.
- **Negative prompt di qualità**: nuovo campo modificabile "Negative
  prompt (quality)", precompilato con:
  `lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, bad feet`
  Viene sempre incluso nel `negative_prompt` inviato a NanoGPT (insieme a
  "NSFW" quando la relativa checkbox è disattivata), esattamente come lo
  "Stile grafico" — puoi modificarlo liberamente dal pannello impostazioni.
  Vale la stessa nota già fatta per l'opzione NSFW: `negative_prompt` è un
  parametro "model-specific" secondo la doc NanoGPT, quindi il suo effetto
  dipende dal modello scelto.

## Novità v1.8.0 — interfaccia interamente in inglese

Confermato: fino alla v1.7.0 l'interfaccia dell'estensione (etichette,
pulsanti, messaggi di stato, notifiche) era in italiano — non era un
errore del browser, l'avevo scritta così io. Ora tutto il codice
utente-visibile (pannello impostazioni, pulsanti, toast di notifica,
messaggi di stato, testi di errore) è stato tradotto in inglese, oltre ai
commenti nel codice sorgente (utile visto che l'estensione finirà su
GitHub, dove ci si aspetta commenti in inglese). L'unico testo che resta
in italiano è, per design, quello che tu leggi nel fumetto stesso (le
battute nelle nuvolette), perché quello riflette la lingua della tua chat,
non l'interfaccia dell'estensione.

## Novità v1.7.0 — prompt immagine sempre in inglese

Bug corretto: il campo "visual" (quello mandato davvero a NanoGPT come
prompt immagine) ereditava la lingua della scena in chat — se scrivevi in
italiano, molto probabilmente anche il prompt immagine finiva in italiano,
cosa che peggiora la qualità dei risultati con la maggior parte dei
modelli immagine (addestrati prevalentemente su prompt in inglese).

Ora l'istruzione data all'LLM è esplicita: **il campo "visual" deve
sempre essere scritto in inglese**, tradotto se necessario, mentre le
battute delle nuvolette (`speaker`/`text`) restano nella lingua originale
della chat, perché quelle le leggi tu nel fumetto, non l'AI immagine.

⚠️ Unico caso non coperto al 100%: se lo split via LLM fallisce del tutto
(LLM non disponibile o risposta non in formato JSON valido), l'estensione
usa un fallback locale che spezza il testo originale in frasi senza
tradurlo. In quel caso specifico riceverai un avviso a schermo
("⚠️ ... uso un fallback locale che NON traduce in inglese") così lo sai
subito, invece di scoprirlo dal risultato.

## Novità v1.6.0 — opzione NSFW

Nuova checkbox **"Contenuto NSFW"** nel pannello impostazioni:

- **Attiva**: aggiunge `NSFW` alla fine del prompt POSITIVO di ogni
  pannello (insieme allo stile grafico scelto).
- **Disattiva** (default): invece di scriverlo nel prompt positivo, lo
  passa come `negative_prompt` nella richiesta a NanoGPT, per provare a
  escluderlo esplicitamente.

⚠️ Nota di correttezza: secondo la
[documentazione ufficiale](https://docs.nano-gpt.com/api-reference/image-generation),
`negative_prompt` **non è un parametro comune garantito** su `/api/v1/images`
(l'elenco ufficiale dei campi comuni è `model`, `prompt`, `n`, `resolution`,
`aspect_ratio`, `quality`, `output_format`, `seed`, `input_references`) —
è un parametro "model-specific", cioè supportato solo da alcuni modelli.
L'estensione lo invia comunque nella richiesta (i modelli che non lo
supportano dovrebbero semplicemente ignorarlo), ma non posso garantirti che
funzioni per ogni modello. Apri la Console del browser (F12): il log
`negative_prompt: ...` ti mostra esattamente cosa è stato inviato ad ogni
generazione, così puoi verificare tu stesso se il modello scelto sembra
tenerne conto o meno.

## Impostazioni persistenti tra riavvii

Tutte le impostazioni di questa estensione (API key, modello, stile,
riferimenti, checkbox NSFW, ecc.) vengono salvate tramite il meccanismo
standard di SillyTavern (`extension_settings` + `saveSettingsDebounced()`),
che scrive i dati **sul server**, nel file delle impostazioni del tuo
profilo utente — non solo nel browser. Restano quindi invariate tra un
riavvio di SillyTavern e l'altro, finché usi lo stesso profilo/utente.

## Novità v1.5.0

- **Pulsante 🔁 di rigenerazione per pannello**: ogni pannello (riuscito o
  in errore) ha ora un pulsante "🔁" in alto a destra che rigenera SOLO
  quel pannello, con lo stesso prompt e gli stessi riferimenti usati per
  il resto del fumetto — non serve più rigenerare tutta la tavola se solo
  uno viene male.
- **Manga di nuovo in bianco e nero** (avevo sbagliato ad ascoltare la
  richiesta precedente su questo punto, ora è tornato come nella versione
  originale).
- **Nuvolette meno invasive sui volti**: ora vengono disposte a coppie
  lungo il bordo superiore del pannello (una a sinistra, una a destra),
  più piccole, invece che sovrapposte al centro dove tipicamente si trova
  il volto del personaggio. La freccetta del "parlato" ora esce dal lato
  interno della nuvoletta (quello più vicino al centro del pannello),
  puntando verso il basso/centro invece che verso l'angolo vuoto esterno.

  ⚠️ Va detto onestamente: non c'è un vero riconoscimento del volto
  nell'immagine generata, quindi questa è un'euristica di posizionamento
  (convenzione tipica dei fumetti: nuvolette in alto, corpo/volto libero
  sotto), non una garanzia assoluta che non copra mai nulla di importante
  — dipende da come l'immagine viene effettivamente composta dal modello.
  Se un pannello specifico ha la nuvoletta messa male, ora puoi usare "🔁"
  per rigenerare quel pannello e riprovare.

## Novità v1.4.0 — parlato vs pensiero

- Durante lo split della scena, l'LLM ora classifica ogni battuta come
  **"speech"** (detta ad alta voce) o **"thought"** (pensiero interno,
  monologo, narrazione non detta), e le nuvolette vengono disegnate di
  conseguenza:
  - **Parlato**: nuvoletta ovale classica con freccetta rivolta verso chi
    parla.
  - **Pensiero**: nuvoletta rettangolare (bordo tratteggiato, testo in
    corsivo), senza freccetta.
- La distinzione vale in tutti e tre gli stili (generico/manga/disney),
  che continuano a personalizzare solo font e colori.

## Novità v1.3.0

- **Manga a colori**: rimosso il filtro bianco/nero e aggiornato il preset
  di stile — ora "Manga" genera pannelli colorati in stile anime/manga
  (linee pulite, colori vivaci), non più in scala di grigi.
- **Didascalie nascoste di default**: il testo con la descrizione visiva
  che compariva sotto ogni pannello ora è **nascosto di default**. Puoi
  riattivarlo dalla nuova opzione **"Mostra didascalie sotto i pannelli"**
  nel pannello impostazioni, se preferisci vederlo (utile per debug o per
  capire cosa ha generato l'AI in ogni pannello).

## Novità v1.2.0 — verificabilità dei riferimenti

Dopo un confronto diretto con l'URL reale usato da SillyTavern
(`http://127.0.0.1:8000/thumbnail?type=avatar&file=NomePersonaggio.png`) e
con l'interfaccia di NanoGPT per Qwen Image (che mostra "Upload Images for
Img2Img — up to 3"), ho corretto due cose importanti:

1. **Limite riferimenti dinamico, non più fisso a 4**: ora l'estensione
   interroga `GET /api/v1/images/models/{modelId}/endpoints` per leggere
   il vero limite del modello selezionato (`input_reference_constraints.max_items`)
   invece di assumere un numero fisso. Se la lettura fallisce, usa 3 come
   default (limite confermato per Qwen Image).
2. **URL locali convertiti automaticamente in base64**: se aggiungi come
   riferimento manuale un URL locale (es. l'avatar della tua persona,
   `http://127.0.0.1:8000/thumbnail?type=persona&file=...`), NanoGPT non
   potrebbe raggiungerlo da remoto — prima lo lasciavo passare così com'era
   (bug). Ora l'estensione lo rileva e lo scarica/converte in base64 nel
   browser prima di inviarlo, esattamente come già faceva per gli avatar
   dei personaggi.
3. **Log espliciti e verificabili**: apri la Console del browser (F12)
   durante la generazione e vedrai, riga per riga:
   - quali personaggi sono stati individuati in chat;
   - per ognuno, se l'avatar è stato trovato/scaricato o escluso (e perché);
   - il limite di riferimenti letto per il modello scelto;
   - il numero totale di riferimenti effettivamente inviati;
   - la richiesta POST esatta (endpoint + modello + conteggio riferimenti);
   - la risposta grezza ricevuta da NanoGPT.

   A schermo, sotto i pulsanti, vedrai anche un riepilogo tipo
   "✅ Uso 2 immagine/i di riferimento" oppure un avviso se non ne viene
   trovata nessuna.

## Novità v1.1.0

- **Pulsante nel menu bacchetta magica**: oltre al pulsante nel pannello
  impostazioni, ora c'è un pulsante **"Genera fumetto"** direttamente nel
  menu che si apre cliccando l'icona a bacchetta magica in basso a
  sinistra nella chat (quello con TTS, immagini, ecc.) — non serve più
  aprire il pannello Extensions per lanciare la generazione.
- **Vero layout a fumetto**: i pannelli ora sono organizzati in una
  "pagina" con cornice, leggermente ruotati come tavole vere, con
  **nuvolette di dialogo (speech balloon)** posizionate sopra le immagini,
  invece di uscire come immagini separate senza contesto.
- **Nuvolette generate dal testo**: durante lo split della scena, l'LLM
  ora restituisce per ogni pannello sia la descrizione visiva sia le
  eventuali battute (personaggio + testo), usate per disegnare le
  nuvolette — l'immagine resta puramente visiva (i modelli immagine
  renderizzano male il testo, quindi le battute non finiscono nel prompt
  dell'immagine).
- **Esportazione come immagine unica**: pulsante "💾 Esporta come immagine
  unica" che compone l'intera tavola (pannelli + nuvolette) in un solo
  PNG scaricabile, e viene usato automaticamente anche per l'inserimento
  in chat quando possibile (vedi nota CORS più sotto).
- **Immagini di riferimento personaggi**: se attivo, l'estensione prende
  automaticamente gli avatar dei personaggi che hanno parlato di recente
  in chat e li passa come `input_references` a NanoGPT per mantenere la
  coerenza visiva dei personaggi tra un pannello e l'altro. Puoi anche
  aggiungere manualmente URL di immagini di riferimento extra.
- **Selettore di stile fumetto**: Generico (comic occidentale) / Manga
  (bianco e nero, screentone, font marcato) / Disney (colori caldi, font
  arrotondato) — cambia sia il prompt di stile per le immagini sia
  l'aspetto grafico delle nuvolette/cornici.

### Nota sull'esportazione come immagine unica (limite CORS)

La composizione in un'unica immagine usa `html2canvas` per "fotografare"
la pagina del fumetto (pannelli + nuvolette). Perché funzioni, il browser
deve poter leggere i pixel delle immagini generate da NanoGPT, cosa che
richiede che il server di NanoGPT esponga header CORS permissivi su quegli
URL. Se NanoGPT non li espone, l'esportazione fallisce in modo controllato
(vedrai un avviso) e si torna automaticamente all'inserimento in chat come
pannelli separati con relative battute in testo — i pulsanti di download
sui singoli pannelli funzionano comunque sempre, perché scaricano
direttamente dall'URL dell'immagine senza passare da canvas.

## Configurazione

Nel pannello dell'estensione trovi:

- **NanoGPT API Key**: la tua chiave, presa dalla dashboard NanoGPT.
- **Endpoint generazione**: di default
  `https://nano-gpt.com/api/v1/images/generations` (come nel tuo esempio
  cURL). Modificabile: se NanoGPT cambia/aggiunge varianti di path, basta
  aggiornare questo campo senza toccare il codice — vedi anche la nota più
  sotto sull'endpoint "ufficiale" documentato.
- **Modello immagine**: di default impostato su **`qwen-image`** (Qwen
  Image). L'ID esatto su NanoGPT può però cambiare nel tempo (es. potrebbe
  essere `qwen-image`, `qwen-image-2.0`, `alibaba/qwen-image`...): per
  essere sicuri di usare l'ID corretto e aggiornato, usa il pulsante
  **"🔄 Carica modelli disponibili"** subito sotto.
- **Modelli disponibili**: interroga in tempo reale
  `GET https://nano-gpt.com/api/v1/image-models?detailed=true`
  (vedi [documentazione ufficiale](https://docs.nano-gpt.com/api-reference/endpoint/image-models))
  e popola una tendina con tutti i modelli immagine attualmente offerti da
  NanoGPT (nome, ID esatto, prezzo per immagine). I modelli con "Qwen" nel
  nome/ID vengono messi in cima per comodità. Selezionandone uno:
  - il campo "Modello immagine" viene aggiornato automaticamente con l'ID
    corretto;
  - il menu "Dimensione" viene ripopolato con le risoluzioni realmente
    supportate da quel modello (`supported_parameters.resolutions`),
    invece di usare una lista fissa che potrebbe non essere valida per
    tutti i modelli.
- **Dimensione**: lista di default 1024x1024 / 1024x1792 / 1792x1024 /
  512x512, ma viene sostituita con le risoluzioni ufficiali del modello
  scelto non appena carichi/selezioni un modello dalla tendina.
- **Numero pannelli**: da 1 a 9.
- **Stile fumetto**: Generico / Manga / Disney — imposta automaticamente
  un preset di stile grafico (modificabile) e cambia l'aspetto di
  nuvolette, cornici e font nella tavola generata.
- **Sorgente testo**: ultimo messaggio del personaggio / ultimo messaggio
  di chiunque / testo personalizzato scritto a mano.
- **Stile grafico (suffisso prompt)**: testo aggiunto a ogni prompt
  immagine, precompilato in base allo "Stile fumetto" scelto ma
  liberamente modificabile.
- **Usa avatar personaggi come riferimento**: se attivo, gli avatar dei
  personaggi che parlano nella scena vengono inviati a NanoGPT come
  `input_references` per mantenerne l'aspetto coerente tra i pannelli.
- **Immagini di riferimento extra**: puoi aggiungere manualmente URL
  pubblici di immagini (es. un personaggio custom, un ambiente specifico)
  da usare come riferimento aggiuntivo, fino a un massimo di 4 riferimenti
  totali per generazione (limite tipico dei modelli NanoGPT con supporto
  img-to-image).
- **Inserisci risultato in chat**: se attivo, il fumetto viene anche
  aggiunto come messaggio di sistema nella chat — come immagine unica se
  l'esportazione riesce, altrimenti come pannelli separati con relative
  battute in testo.

Premi **"🔧 Test connessione API"** per verificare subito che la chiave
funzioni (genera una piccola immagine di prova).

Premi **"🎬 Genera fumetto"** per avviare la generazione vera e propria:
si apre una finestra con i pannelli che si riempiono uno alla volta.

## Note tecniche

- La chiamata di generazione ricalca l'esempio cURL che hai fornito,
  tradotta in `fetch`, ma con endpoint e modello ora configurabili dalle
  impostazioni (non più hardcoded):

  ```js
  fetch(apiEndpoint, { // default: https://nano-gpt.com/api/v1/images/generations
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen-image", // ora modificabile / selezionabile dalla UI
      prompt: "...",
      size: "1024x1024",
      response_format: "url",
      n: 1,
    }),
  });
  ```

  ⚠️ Nota sulla documentazione ufficiale: la pagina
  [Image Generation (OpenAI-Compatible)](https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai)
  di NanoGPT indica come endpoint canonico
  `https://nano-gpt.com/v1/images/generations` (**senza** `/api`), mentre
  il tuo esempio cURL usava `https://nano-gpt.com/api/v1/images/generations`
  (**con** `/api`). Nella pratica NanoGPT sembra accettare entrambe le
  varianti, ma se un giorno una delle due smettesse di funzionare, ricordati
  che ora puoi semplicemente cambiare il campo "Endpoint generazione" nelle
  impostazioni senza toccare il codice.

- **Scoperta modelli e risoluzioni**: l'estensione usa anche l'endpoint
  documentato in
  [Image Models](https://docs.nano-gpt.com/api-reference/endpoint/image-models)
  (`GET https://nano-gpt.com/api/v1/image-models?detailed=true`) per
  recuperare in tempo reale l'elenco dei modelli disponibili, invece di
  tenere una tabella statica nel codice — che è esattamente quello che
  raccomanda la documentazione stessa ("Do not hardcode image model
  capability tables in your client"). Questo rende l'estensione corretta
  anche quando NanoGPT aggiunge/rimuove modelli o cambia le risoluzioni
  supportate da uno di essi.

- Il parsing della risposta di generazione assume un formato stile OpenAI
  (`{ data: [{ url: "..." }] }`), confermato anche dalla documentazione
  ufficiale. Se un modello specifico restituisse un formato diverso,
  guarda l'oggetto stampato in console durante il test e aggiusta la
  funzione `generateImage()` in `index.js` di conseguenza.
- Lo split della scena in pannelli usa `context.generateQuietPrompt()`,
  l'API interna di SillyTavern per generazioni "silenziose" (non mostrate
  in chat) con il backend LLM attualmente connesso. Se la tua versione di
  SillyTavern non espone questa funzione, l'estensione ricade
  automaticamente su uno split "ingenuo" per frasi.
- L'inserimento in chat è "best-effort": se la tua versione di
  SillyTavern ha un'API chat interna diversa, potrebbe fallire in modo
  silenzioso (vedrai un avviso, ma le immagini restano comunque visibili e
  scaricabili dalla finestra del fumetto).

## Possibili estensioni future

- Aggiungere un comando slash `/comic` per generarlo direttamente dalla
  chat box.
- Aggiungere un pulsante "Genera fumetto" accanto a ogni singolo
  messaggio (nel menu a bacchetta magica).
- Salvare le immagini generate localmente invece di linkare solo l'URL
  restituito da NanoGPT (utile se gli URL scadono).
