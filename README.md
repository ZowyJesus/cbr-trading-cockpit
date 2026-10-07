# CBR Live Execution Cockpit

`index.html` ist das komplette Cockpit – per Doppelklick lauffähig, ohne Installation.

## CBR Voice (Sprachassistent)

- **Einschalten:** Button `VOICE` oder Taste `V`, dann „Hey CBR“.
- **Browser:** Chrome oder Edge (Spracherkennung braucht dort Internet). Ohne Spracherkennung liest CBR die Fragen nur vor.
- **Empfehlung:** Headset statt Lautsprecher, damit das Mikrofon die Stimme von CBR nicht mithört.

### Optional: KI-Erklärungen (OpenAI) über lokales Backend

```bash
cp .env.example .env        # OPENAI_API_KEY eintragen
node server.js              # Node.js ≥ 18, keine Abhängigkeiten
```

Dann **http://localhost:8787** öffnen (statt Doppelklick). Vorteile: KI-Erklärungen aktiv, Chrome merkt sich die Mikrofon-Freigabe.

Der API-Key liegt nur in `.env` auf deinem Rechner und wird nie an den Browser gesendet.
Ohne Backend oder Internet funktioniert die komplette Execution per Sprache weiter – nur freie KI-Erklärungen fallen aus.
