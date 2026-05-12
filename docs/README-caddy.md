# CEDA Regiobijeenkomst — HTTPS via Caddy

Deze map bevat een **Caddyfile** waarmee je de workshop-app over HTTPS draait,
in plaats van vanuit `file://` rechtstreeks in de browser. Caddy regelt
certificaten automatisch — lokaal én publiek.

## Waarom HTTPS?

- **Authenticiteit en integriteit.** Bezoekers weten zeker dat ze de echte app
  hebben en dat de inhoud onderweg niet is aangepast.
- **Strenge security-headers.** HSTS, CSP, frame-options, permissions-policy en
  cross-origin-isolation zijn ingesteld. Daarmee gaat de app van een
  *nul-out-of-the-box* security-grade naar een **A op
  [securityheaders.com](https://securityheaders.com)**.
- **Browserfeatures.** `localStorage`, `clipboard.writeText`, Service Workers
  en geavanceerde APIs werken alleen op `https://` en `localhost` —
  niet op `file://`. Met Caddy zit je altijd goed.
- **Compressie.** Caddy gzip't en zstd't responses, scheelt 50–70% transfer.

## Installatie

### macOS

    brew install caddy

### Linux (Debian/Ubuntu)

    sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
        sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
        sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt update && sudo apt install caddy

### Windows

Download van [caddyserver.com/download](https://caddyserver.com/download)
of via *winget*:

    winget install CaddyServer.Caddy

## Eerste run — lokaal (1-dubbelklik)

**Aanbevolen route — geen terminal-kennis nodig:**

1. Open de map *CEDA | Regiobijeenkomst - Tool* in Finder.
2. Dubbelklik op **`Start Workshop.command`**.
3. De launcher checkt of Caddy is geïnstalleerd (zo niet → installeert via Homebrew),
   start de server, en opent je browser op **https://localhost:8443**.
4. macOS vraagt eenmalig je wachtwoord voor het lokale certificaat in Keychain.

> Eerste keer: Gatekeeper kan vragen om bevestiging. Rechtsklik op het bestand → **Open**, of
> draai in Terminal eenmalig: `chmod +x "Start Workshop.command"`.

**Alternatief — via terminal:**

    ./start-caddy.sh
    # of
    caddy run

URL: **https://localhost:8443**

> Tip: stop Caddy met `Ctrl+C`. Achtergrond-modus: `caddy start` /
> stop met `caddy stop`.

## Naar productie — publiek domein

Wil je de workshop-app via een publieke URL aanbieden (bv.
`https://workshop.ceda.surf.nl`) zodat collega's vanuit huis kunnen meedoen?

1. **DNS:** zet een A-record dat het domein naar het IP-adres van je server
   wijst.
2. **Firewall:** open poort **80** en **443** naar de server.
3. **Caddyfile:** vervang in *Caddyfile* `localhost` door je domein.
   Of gebruik de *Productie-template* die onderaan het bestand al klaar staat.
4. **Start Caddy:** `caddy run` (interactief) of installeer als systemd-service:

       sudo cp Caddyfile /etc/caddy/Caddyfile
       sudo systemctl enable --now caddy

Caddy haalt automatisch een **Let's Encrypt** certificaat op zodra het
domein bereikbaar is — geen handmatige stappen, en het wordt automatisch
elke ~60 dagen vernieuwd.

## Wat er allemaal beveiligd wordt

| Header | Waarde | Wat het doet |
|---|---|---|
| `Strict-Transport-Security` | 1 jaar, subdomeinen | Browser onthoudt: alleen via HTTPS |
| `Content-Security-Policy` | strict allowlist | Alleen onze eigen scripts + bekende CDN's en MQTT-brokers laden |
| `X-Frame-Options` | `DENY` | App kan niet in een iframe — anti-clickjacking |
| `X-Content-Type-Options` | `nosniff` | Geen MIME-type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Lekt minimale info naar externe sites |
| `Permissions-Policy` | alles uit | Geen toegang tot camera, microfoon, locatie, etc. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolatie tegen window-injection |
| `-Server` | (verwijderd) | Versteekt dat dit Caddy is |

Daarnaast schakelt Caddy automatisch HTTP/2 (en H/3 over QUIC indien beschikbaar) in.

## Veelvoorkomende vragen

**Vraag:** Krijg ik een waarschuwing in de browser bij `https://localhost`?
**Antwoord:** Alleen de allereerste run, vóór de lokale CA is geïnstalleerd.
Daarna niet meer. Voor andere apparaten op je netwerk die ook bij
`https://<jouw-IP>` willen, moet je de Caddy-CA exporteren en op die
apparaten installeren — of gebruik een publiek domein.

**Vraag:** Kan ik een andere poort gebruiken dan 443?
**Antwoord:** Ja — in plaats van `localhost` schrijf je bijvoorbeeld
`localhost:8443`. Caddy genereert dan automatisch een lokaal cert
voor die poort.

**Vraag:** Wat als CSP iets blokkeert dat ik wel nodig heb?
**Antwoord:** Pas de `Content-Security-Policy` regel in *Caddyfile* aan.
De `connect-src` directive bevat de toegestane MQTT-brokers — voeg er
nieuwe toe als je een andere broker gebruikt.

**Vraag:** Werkt de live samenwerking nog steeds?
**Antwoord:** Ja. Sterker nog — sommige browsers willen WebSocket-verbindingen
liever vanuit een echte HTTPS-context dan vanuit `file://`, dus de MQTT-sync
wordt iets robuuster. De broker-URL's in `ceda-workshop.html` zijn al `wss://`,
wat compatibel is met HTTPS.
