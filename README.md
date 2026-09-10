# CMR-bonnen automatisering

Leest CMR-vrachtbrieven die als foto binnenkomen in een WhatsApp-groepsapp,
haalt de velden eruit met Claude vision, en archiveert het bestand automatisch
in `{leverancier}/{klant}/` op de bedrijfs-NAS.

Zie [`.claude/plans/twinkly-petting-rainbow.md`](../.claude/plans/twinkly-petting-rainbow.md)
voor het volledige ontwerpplan en de achterliggende afwegingen.

## Architectuur in het kort

```
WhatsApp-groep --> Listener --> Claude-extractie --> Canonicalizer --> NAS-writer --> Audit (SQLite)
```

- **Onofficiële WhatsApp-koppeling** (Baileys) — een los zakelijk nummer wordt lid van de groep.
- **Claude vision** leest de CMR-velden (afzender, geadresseerde, ordernummer, ...) uit elke foto.
- **SQLite** (`data/db.sqlite`) is zowel het idempotentie-slot (geen dubbele verwerking) als het auditspoor.
- Onduidelijke/onleesbare bonnen gaan naar `_TE_CONTROLEREN` i.p.v. verkeerd of stil weggelaten te worden.

## Lokaal ontwikkelen/testen (fase 1: zonder WhatsApp en zonder NAS)

```bash
npm install
cp .env.example .env
# vul ANTHROPIC_API_KEY in .env in
```

### Stap 2 uit het bouwplan: extractie testen op een losse foto

```bash
npm run cli:extract -- pad/naar/een-cmr-foto.jpg
```

Print de volledige gestructureerde extractie plus de routeringsbeslissing
(filen / review / niet-CMR). Leg de foto van de daadwerkelijke Wilko Fruit
B.V. / Jacobs-bon (of vergelijkbare voorbeelden, ook bewust slechte/schuine
foto's) in `test/fixtures/` om als referentiemateriaal te gebruiken.

### Stap 3-4: unit tests (sanitatie, alias-resolver, padopbouw)

```bash
npm test
```

Draait volledig offline (geen API-key, geen WhatsApp, geen NAS nodig) en dekt
onder andere het `/`-geval uit de echte Jacobs / Cooperatie Hoogstraten-bon.

### Handmatig end-to-end testen zonder WhatsApp/NAS

Zet in `.env`:
```
NAS_ROOT=./data/nas-local-test
```
en roep `processCmrImage()` (zie `src/pipeline.ts`) aan vanuit een los
scriptje met een voorbeeldfoto — bevestigt mapstructuur, bestandsnamen en
SQLite-rijen voordat er iets met live infrastructuur gebeurt.

## Bekende leveranciers/klanten alvast seeden

Voorkomt dat vaste relaties bij de allereerste bon als "nieuwe partij"
gemarkeerd worden. Pas de lijst in `scripts/seed-aliases.ts` aan en draai:

```bash
npm run seed:aliases
```

## WhatsApp koppelen (stap 1)

```bash
npm run pair:whatsapp
```

Scan de getoonde QR-code met het **zakelijke** WhatsApp-nummer dat lid is (of
wordt) van de groep. Sluit af (Ctrl+C) zodra `"[whatsapp] Verbonden."`
verschijnt — de sessie staat dan in `BAILEYS_AUTH_DIR` en hoeft niet opnieuw
gescand te worden bij een gewone herstart.

Onbekende groep-JID? Zet `WHATSAPP_LOG_ALL_GROUPS=true` in `.env`, start de
service, stuur een testbericht in de groep, lees de JID uit de logs, zet die
in `WHATSAPP_GROUP_JID`, en zet de logvlag weer op `false`.

## Productie: VPS + Tailscale + NAS-mount (stap 6)

**Wat jij (buiten de code om) regelt:**

1. VPS aanschaffen (lichte load volstaat, bv. Hetzner/DigitalOcean kleinste instance), Ubuntu LTS.
2. Tailscale op de VPS: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
3. Tailscale op de NAS zelf (Synology/QNAP hebben vaak een package), **of** op een andere
   altijd-aan machine in het bedrijfsnetwerk die bij de NAS kan (subnet-routing via Tailscale).
4. Een map op de NAS delen (bv. `\\NAS\CMR_Bonnen`) met een **los service-account**
   (alleen schrijfrechten op die ene share, least privilege).
5. Het nieuwe Tailscale-device/subnet-route goedkeuren in het Tailscale-adminpaneel.
6. NAS-inloggegevens als secrets op de VPS zetten (nooit in de repo/.env committen).

**Wat op de VPS gebeurt (eenmalige setup):**

```bash
sudo apt install cifs-utils
sudo mkdir -p /mnt/cmr-nas
sudo nano /etc/cmr-nas-creds   # username=... \n password=...
sudo chmod 600 /etc/cmr-nas-creds
```
In `/etc/fstab` (pas de Tailscale-hostnaam/IP en share-naam aan):
```
//100.x.x.x/CMR_Bonnen /mnt/cmr-nas cifs credentials=/etc/cmr-nas-creds,iocharset=utf8,_netdev 0 0
```
```bash
sudo mount -a
echo test | sudo tee /mnt/cmr-nas/healthcheck.txt   # bevestig dat schrijven werkt
```

Zet daarna in `.env` op de VPS: `NAS_ROOT=/mnt/cmr-nas`.

**Service starten onder pm2:**

```bash
npm run build
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # volg de instructie om pm2 na een reboot automatisch te starten
```

## Statussen in `processed_messages`

| status | betekenis |
|---|---|
| `received` | foto binnengekomen, extractie nog niet gedaan |
| `extracted` | Claude-extractie klaar, routering nog niet afgehandeld |
| `filed` | succesvol weggeschreven naar de NAS |
| `needs_review` | naar `_TE_CONTROLEREN` — onleesbaar/geen CMR-velden |
| `skipped_not_cmr` | herkend als geen CMR-document, genegeerd |
| `pending_nas` | NAS was onbereikbaar, lokaal gespoold; wordt periodiek opnieuw geprobeerd |
| `error` | onverwachte fout (zie `error_message`) |

## Bekende beperkingen

- Onofficiële WhatsApp-koppeling (Baileys) — tegen de ToS van WhatsApp, klein
  risico op blokkade van het nummer. Bewuste, met de gebruiker afgestemde keuze.
- Bij een crash/herstart middenin de verwerking (status `received`/`extracted`)
  wordt de ruwe foto niet automatisch hervat — die is op dat moment nog niet
  lokaal bewaard. WhatsApp levert recente berichten vaak opnieuw af na een
  herverbinding; anders staat het bericht-ID in de opstart-log om handmatig na
  te kijken. Alleen `pending_nas` (NAS tijdelijk onbereikbaar) heeft volledig
  automatisch herstel, omdat daar de bytes al lokaal gespoold zijn.
