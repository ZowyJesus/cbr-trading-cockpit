#!/usr/bin/env node
/* =====================================================================
   CBR VOICE · LOKALES EXPLAIN-BACKEND
   ---------------------------------------------------------------------
   index.html  →  http://localhost:8787 (dieser Server)  →  OpenAI

   · Liefert index.html aus (Mikrofon-Freigabe bleibt im Browser gespeichert)
   · POST /api/explain   – beantwortet NUR Erklärfragen (Explain Only)
   · GET  /api/health    – { ok, ai } für den Offline-Fallback im Browser

   Der API-Key wird ausschließlich hier gelesen (Umgebungsvariable oder
   .env neben dieser Datei) und nie an den Browser gesendet.
   Die CBR Execution läuft vollständig lokal im Browser – fällt dieser
   Server oder OpenAI aus, funktioniert der Decision Tree unverändert.

   Start:   OPENAI_API_KEY=sk-... node server.js
   Öffnen:  http://localhost:8787
   Keine Abhängigkeiten, Node.js ≥ 18.
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// .env (optional, KEY=VALUE pro Zeile) – wird nicht ins Git eingecheckt
try{
  const envFile = path.join(__dirname, '.env');
  if(fs.existsSync(envFile)){
    for(const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)){
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if(m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}catch(e){ /* .env optional */ }

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = '127.0.0.1';                                   // nur lokal erreichbar
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const TIMEOUT = parseInt(process.env.OPENAI_TIMEOUT_MS || '14000', 10);
const INDEX = path.join(__dirname, 'index.html');

const SYSTEM_PROMPT = `Du bist CBR Voice, der Sprachassistent des CBR Live Execution Systems.

Du erklärst ausschließlich die vorhandenen CBR-Regeln und den aktuellen Zustand des Decision Trees.

Die CBR Execution Engine ist die einzige Instanz, die Tradingentscheidungen trifft.

Du darfst niemals:
- neue Tradingregeln erfinden
- eine vorhandene Regel verändern
- einen Trade empfehlen
- einen Trade ablehnen
- eine Antwortoption selbst auswählen
- den Decision Tree umgehen
- Marktanalysen durchführen und daraus eine Execution ableiten

Wenn der Benutzer eine Frage zu einem aktuellen Gate stellt, erkläre das Gate anhand des bereitgestellten Contexts.

Wenn die Information nicht im CBR Context vorhanden ist, sage klar:
„Das ist im aktuellen CBR-System nicht definiert.“

Halte Antworten kurz und sprachgeeignet.

Nach einer Erklärung wird der bestehende Decision Tree fortgesetzt.

Zusätzliche Regeln:
- Antworte auf Deutsch, als gesprochener Fließtext ohne Aufzählungszeichen, Markdown oder Emojis.
- Nutze ausschließlich den mitgelieferten CBR CONTEXT (Decision Tree, Trade State, Decision Trace, Playbook-Auszüge, Glossar). Kein allgemeines Tradingwissen als CBR-Regel ausgeben.
- Begriffe unter "notDefinedInSystem" sind im System nicht ausgeschrieben definiert. Erkläre dafür nur, wie sie im Decision Tree verwendet werden.
- Fragt der Benutzer, welche Option er wählen soll oder wie sein Chart aussieht, antworte: Du kannst erklären, was im CBR-System die Kriterien ausmachen; die Auswahl trifft der Benutzer anhand seiner Chartbewertung. Nenne nie eine Option als Empfehlung.
- Stelle keine Rückfragen und wiederhole nicht die aktuelle Frage des Decision Trees – das übernimmt das Cockpit.`;

function send(res, code, body, headers){
  res.writeHead(code, Object.assign({'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}, headers||{}));
  res.end(typeof body==='string' ? body : JSON.stringify(body));
}
// CORS nur für lokale Herkunft (Server selbst oder index.html per Doppelklick = Origin "null")
function corsHeaders(req){
  const o = req.headers.origin;
  const ok = !o || o==='null' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  if(!ok) return null;
  return o ? {'Access-Control-Allow-Origin':o, 'Vary':'Origin', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Allow-Private-Network':'true'} : {};
}
// einfaches Rate-Limit gegen versehentliche Schleifen
const hits = [];
function rateLimited(){
  const now = Date.now();
  while(hits.length && now - hits[0] > 60000) hits.shift();
  if(hits.length >= 30) return true;
  hits.push(now); return false;
}
function readBody(req, limit){
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if(size > limit){ reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function explain(payload){
  const question = String(payload.question || '').slice(0, 500).trim();
  const detail = !!payload.detail;
  const context = payload.context && typeof payload.context==='object' ? payload.context : {};
  if(!question) throw Object.assign(new Error('question missing'), {status:400});
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT);
  try{
    const r = await fetch(BASE + '/chat/completions', {
      method:'POST', signal:ctrl.signal,
      headers:{'Content-Type':'application/json', 'Authorization':'Bearer ' + API_KEY},
      body:JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_completion_tokens: detail ? 600 : 260,
        messages: [
          {role:'system', content: SYSTEM_PROMPT},
          {role:'user', content:
            'CBR CONTEXT (JSON, einzige Wissensquelle):\n' + JSON.stringify(context).slice(0, 24000) +
            '\n\nANTWORTLÄNGE: ' + (detail ? 'ausführlicher, höchstens 8 Sätze.' : '1 bis 4 kurze Sätze.') +
            '\n\nFRAGE DES TRADERS: ' + question},
        ],
      }),
    });
    if(!r.ok){ const e = new Error('upstream ' + r.status); e.status = 502; throw e; }
    const j = await r.json();
    const answer = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
    return String(answer).trim();
  }finally{ clearTimeout(to); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const cors = corsHeaders(req);
  if(cors===null) return send(res, 403, {error:'forbidden origin'});
  if(req.method==='OPTIONS') return send(res, 204, '', cors);

  if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/index.html')){
    fs.readFile(INDEX, (err, data) => {
      if(err) return send(res, 500, {error:'index.html not found'});
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'});
      res.end(data);
    });
    return;
  }
  if(req.method==='GET' && url.pathname==='/api/health') return send(res, 200, {ok:true, ai:!!API_KEY}, cors);

  if(req.method==='POST' && url.pathname==='/api/explain'){
    if(!API_KEY) return send(res, 503, {error:'ai not configured'}, cors);
    if(rateLimited()) return send(res, 429, {error:'rate limited'}, cors);
    try{
      const raw = await readBody(req, 64 * 1024);
      const answer = await explain(JSON.parse(raw || '{}'));
      return send(res, 200, {answer}, cors);
    }catch(e){
      const status = e.status || (e.name==='AbortError' ? 504 : 500);
      console.warn('[cbr-voice] explain failed:', e.name==='AbortError' ? 'timeout' : e.message);   // nie den Key loggen
      return send(res, status, {error:'explain unavailable'}, cors);
    }
  }
  send(res, 404, {error:'not found'}, cors);
});

server.listen(PORT, HOST, () => {
  console.log(`CBR Live Execution  →  http://localhost:${PORT}`);
  console.log(API_KEY ? `KI-Erklärungen aktiv (Modell ${MODEL}).` : 'Kein OPENAI_API_KEY gesetzt – KI-Erklärungen aus, Voice-Execution funktioniert trotzdem.');
});
