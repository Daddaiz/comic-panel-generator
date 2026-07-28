# Installazione diretta da SillyTavern (via URL)

*(Istruzioni valide per la versione attuale del progetto, 4.9.0 —
il processo di installazione via Git non cambia con gli aggiornamenti
successivi.)*

SillyTavern ha una funzione **"Install Extension"** nel pannello Extensions
che clona un repository Git direttamente nella tua cartella
`extensions/third-party/`. Per usarla ti serve solo un repository Git
pubblico (GitHub va benissimo, anche gratuito) che contenga questa
cartella con `manifest.json`, `index.js`, `style.css`.

Questo progetto è già pronto: la cartella `comic-panel-generator/` è
**già un repository git inizializzato** con un primo commit. Devi solo
"agganciarlo" a un repo remoto su GitHub e fare push.

## Passo 1 — Crea un repository su GitHub

1. Vai su https://github.com/new
2. Nome repo, ad esempio: `sillytavern-comic-panel-generator`
3. Lascialo **pubblico** (l'installer di SillyTavern deve poterlo clonare)
4. Non aggiungere README/licenza/gitignore automatici (li abbiamo già,
   evitiamo conflitti)
5. Crea il repository

## Passo 2 — Collega il repo locale e fai push

Apri un terminale dentro la cartella `comic-panel-generator/` (quella con
`manifest.json` dentro) e lancia:

```bash
git remote add origin https://github.com/TUO_USERNAME/sillytavern-comic-panel-generator.git
git push -u origin main
```

Sostituisci `TUO_USERNAME` con il tuo nome utente GitHub e il nome del
repo con quello che hai scelto al passo 1.

> Se ti chiede l'autenticazione: GitHub non accetta più la password
> diretta da riga di comando, serve un Personal Access Token (Settings →
> Developer settings → Personal access tokens) oppure autenticarti via
> `gh auth login` se hai la GitHub CLI installata.

## Passo 3 — Installa da SillyTavern

1. Apri SillyTavern, vai su **Extensions** (icona puzzle) in alto
2. Clicca **"Install Extension"** (di solito in cima al pannello, icona
   download/plus)
3. Incolla l'URL del repository, ad esempio:
   ```
   https://github.com/TUO_USERNAME/sillytavern-comic-panel-generator
   ```
4. Conferma l'installazione

SillyTavern clonerà il repo dentro
`public/scripts/extensions/third-party/comic-panel-generator/` da solo —
non serve più copiare file a mano. Da quel momento troverai anche il
pulsante **"Update"** accanto all'estensione per tirare giù eventuali
aggiornamenti futuri con un click (basta fare `git push` di nuovo sul tuo
repo e poi premere Update in SillyTavern).

## Note importanti

- **Installazione globale vs per-utente**: su alcune installazioni
  multi-utente di SillyTavern, installare/aggiornare estensioni globali è
  limitato agli account admin. Se il tuo profilo non è admin e non riesci
  a installare, controlla i permessi utente o installa comunque a mano
  copiando la cartella (metodo descritto in `README.md`).
- **`manifest.json` → campo `name`**: ho aggiunto il campo `"name":
  "comic-panel-generator"`, obbligatorio perché SillyTavern lo usa come
  identificatore interno dell'estensione (deve corrispondere al nome della
  cartella). Senza questo campo l'installazione via URL può fallire anche
  se i file sono corretti.
- **Aggiornare la versione**: quando modifichi qualcosa e vuoi ripubblicarla,
  aggiorna il campo `"version"` in `manifest.json`, fai commit e push — chi
  ha già installato l'estensione vedrà il pulsante "Update" in
  SillyTavern.
- In alternativa a GitHub va bene qualunque host Git raggiungibile
  pubblicamente (GitLab, Codeberg, ecc.): l'importante è che il server di
  SillyTavern riesca a fare `git clone` dell'URL che incolli.
- **Nessun rischio per la tua API key**: la chiave NanoGPT (o quelle degli
  eventuali provider custom che hai aggiunto) non è mai scritta nei file
  di questo repository — SillyTavern la salva separatamente, nel suo file
  di impostazioni sul tuo server, che non fa mai parte di questo progetto.
  Pubblicare questo repository su GitHub non espone in alcun modo la tua
  chiave.
- Se pubblichi il repo, magari da lì consideri anche una **licenza open
  source** (es. MIT — permissiva e comune per progetti come questo): su
  GitHub, quando crei il repo, puoi selezionarla direttamente, oppure
  aggiungerla dopo con "Add file → Create new file → LICENSE".
