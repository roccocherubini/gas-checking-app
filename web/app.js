// =====================================================================
// App Distributori - fase 4: carburanti, riquadro del piu' economico,
// scheda del distributore e "Portami li'"
// =====================================================================

// ---------- Impostazioni ----------
const FILE_DATI = 'data/distributori.json';
const CENTRO_ITALIA = [12.5, 42.3];      // MapLibre vuole [longitudine, latitudine]
const ZOOM_GOCCE = 12;                   // da questo zoom in su compaiono le gocce con il prezzo
const SPAZIO_GOCCIA = { x: 40, y: 46 };  // in pixel: due gocce piu' vicine di cosi' si sovrapporrebbero
const MARGINE_VERDE = 0.015;             // fino all'1,5% sopra i piu' economici della zona -> verde (circa 3 cent)
const MARGINE_GIALLO = 0.05;             // fino al 5% sopra -> giallo (circa 10 cent); oltre -> rosso

const LINK_MIMIT = 'https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti';

// Nome da mostrare per ogni carburante: maiuscolo (pulsanti, listino) e dentro una frase
const NOMI = { benzina: 'Benzina', gasolio: 'Gasolio', gpl: 'GPL', metano: 'Metano' };
const NOMI_IN_FRASE = { benzina: 'benzina', gasolio: 'gasolio', gpl: 'GPL', metano: 'metano' };

// ---------- Stato ----------
let distributori = [];     // tutti i distributori letti dal file JSON
let dataPrezzi = '';       // giorno a cui si riferiscono i prezzi, es. "3 ottobre"
let carburante = 'benzina';
let posizioneUtente = null; // [lon, lat], quando il browser ce la da'
let gocce = [];             // le gocce attualmente sulla mappa
let migliore = null;        // { d, prezzo, modo }: il piu' economico nella zona visibile
let selezionato = null;     // distributore aperto nella scheda

// ---------- Mappa ----------
const mappa = new maplibregl.Map({
  container: 'mappa',
  style: 'https://tiles.openfreemap.org/styles/positron',  // mappa chiara e gratuita, senza chiave
  center: CENTRO_ITALIA,
  zoom: 5.3,
  attributionControl: {
    compact: true,
    customAttribution: `Prezzi: <a href="${LINK_MIMIT}" target="_blank" rel="noopener">MIMIT</a>, licenza IODL 2.0`,
  },
});

// Pulsante "la mia posizione" con il pallino blu
const posizione = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  fitBoundsOptions: { maxZoom: 13 },
});
mappa.addControl(posizione, 'bottom-right');

posizione.on('geolocate', (evento) => {
  posizioneUtente = [evento.coords.longitude, evento.coords.latitude];
  mostraMigliore();  // ora possiamo scrivere "a 1,2 km da te"
});
posizione.on('error', () => {
  mostraAvviso('Posizione non disponibile. Sposta la mappa sulla tua zona.', 6000);
});

// ---------- Funzioni di supporto ----------

// 1.929 -> "1,929"
function formattaPrezzo(prezzo) {
  return prezzo.toFixed(3).replace('.', ',');
}

// "2026-10-03" -> "3 ottobre"
function formattaData(testo) {
  return new Date(testo + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
}

// "TORINO" -> "Torino"
function nomeProprio(testo) {
  return (testo || '').toLowerCase().replace(/(^|[\s'-])\S/g, (lettera) => lettera.toUpperCase());
}

// Protegge il testo che arriva dai dati prima di metterlo nell'HTML (es. "&" o "<" nei nomi)
function esc(testo) {
  const sostituzioni = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(testo ?? '').replace(/[&<>"']/g, (c) => sostituzioni[c]);
}

function unita(carb) {
  return carb === 'metano' ? '€/kg' : '€/L';
}

// Per le pompe bianche la "bandiera" non dice niente: meglio il nome dell'impianto
function titoloDistributore(d) {
  if (d.bandiera === 'Pompe Bianche') return d.nome || 'Pompa bianca';
  return d.bandiera || d.nome;
}

// Il prezzo piu' basso che puoi pagare in quel distributore per un carburante:
// di solito il self; se c'e' solo il servito, il servito.
function prezzoMigliore(d, carb) {
  const p = d.prezzi[carb];
  if (!p) return null;
  if (p.self != null && (p.servito == null || p.self <= p.servito)) return { prezzo: p.self, modo: 'self' };
  if (p.servito != null) return { prezzo: p.servito, modo: 'servito' };
  return null;
}

// Distanza in km tra due punti [lon, lat] (formula dell'emisenoverso)
function distanzaKm([lon1, lat1], [lon2, lat2]) {
  const rad = (gradi) => (gradi * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// " a 1,2 km da te" (vuoto se non conosciamo la posizione)
function testoDistanza(d) {
  if (!posizioneUtente) return '';
  const km = distanzaKm(posizioneUtente, [d.lon, d.lat]);
  const testo = km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`;
  return `, a ${testo} da te`;
}

// Link di navigazione: aprono l'app sul telefono o il sito sul PC
function linkGoogleMaps(d) {
  return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lon}`;
}
function linkWaze(d) {
  return `https://waze.com/ul?ll=${d.lat},${d.lon}&navigate=yes`;
}

function mostraAvviso(testo, durataMs) {
  const avviso = document.getElementById('avviso');
  avviso.textContent = testo;
  avviso.hidden = false;
  if (durataMs) setTimeout(() => { avviso.hidden = true; }, durataMs);
}

// Sul telefono i controlli della mappa (posizione, crediti) devono stare sopra il pannello aperto
function aggiornaSpazioBasso() {
  const aperto = [...document.querySelectorAll('.pannello')].find((p) => !p.hidden);
  const altezza = aperto ? aperto.offsetHeight + 12 : 0;
  document.documentElement.style.setProperty('--spazio-basso', `${altezza}px`);
}

// ---------- Dati ----------

async function caricaDati() {
  const risposta = await fetch(FILE_DATI);
  if (!risposta.ok) throw new Error(`Risposta HTTP ${risposta.status}`);
  const dati = await risposta.json();
  distributori = dati.distributori;
  dataPrezzi = formattaData(dati.estrazione);
}

// ---------- Puntini ----------
// Tutti i distributori sono anche puntini: li disegna MapLibre in un colpo solo,
// quindi e' veloce anche con 21.000 punti. Con la mappa larga si vedono solo loro;
// da vicino restano sotto le gocce e segnano i distributori la cui goccia e' nascosta.

function aggiungiPuntini() {
  mappa.addSource('distributori', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: distributori.map((d) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
        // Quali carburanti ha: serve a mostrare solo i puntini del carburante scelto
        properties: Object.fromEntries(Object.keys(NOMI).map((c) => [c, prezzoMigliore(d, c) != null])),
      })),
    },
  });

  mappa.addLayer({
    id: 'puntini',
    type: 'circle',
    source: 'distributori',
    filter: ['==', ['get', carburante], true],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 11, 4],
      'circle-color': '#14201A',
      'circle-opacity': 0.45,
    },
  });

  // Un clic su un puntino avvicina la mappa in quel punto, cosi' compare la sua goccia
  mappa.on('click', 'puntini', (evento) => {
    mappa.easeTo({ center: evento.lngLat, zoom: Math.max(mappa.getZoom() + 1.5, ZOOM_GOCCE + 1) });
  });
  mappa.on('mouseenter', 'puntini', () => { mappa.getCanvas().style.cursor = 'pointer'; });
  mappa.on('mouseleave', 'puntini', () => { mappa.getCanvas().style.cursor = ''; });
}

// ---------- Gocce ----------

function aggiornaGocce() {
  // Togliamo le gocce vecchie
  gocce.forEach((marker) => marker.remove());
  gocce = [];
  migliore = null;

  if (mappa.getZoom() < ZOOM_GOCCE) {
    mostraMigliore();
    return;
  }

  // 1. Distributori nell'area visibile con il carburante scelto, dal piu' economico al piu' caro
  const area = mappa.getBounds();
  const visibili = distributori
    .filter((d) => area.contains([d.lon, d.lat]))
    .map((d) => ({ d, ...prezzoMigliore(d, carburante) }))
    .filter((v) => v.prezzo != null)
    .sort((a, b) => a.prezzo - b.prezzo);

  if (visibili.length === 0) {
    mostraMigliore();
    return;
  }

  // 2. Prezzo di riferimento: il 10% dei distributori della zona costa meno di cosi'.
  //    Non usiamo il minimo, altrimenti un solo distributore molto economico farebbe diventare tutto rosso.
  const riferimento = visibili[Math.floor((visibili.length - 1) * 0.1)].prezzo;

  // 3. Scegliamo quali gocce disegnare, partendo dalle piu' economiche:
  //    se una goccia finirebbe sopra una gia' scelta la saltiamo. Resta il puntino, e avvicinandoti compare.
  const scelte = [];
  for (const v of visibili) {
    const punto = mappa.project([v.d.lon, v.d.lat]);  // posizione in pixel sullo schermo
    const sovrapposta = scelte.some((s) =>
      Math.abs(s.punto.x - punto.x) < SPAZIO_GOCCIA.x && Math.abs(s.punto.y - punto.y) < SPAZIO_GOCCIA.y);
    if (!sovrapposta) scelte.push({ ...v, punto });
  }
  migliore = scelte[0];

  // 4. Disegniamo dalla piu' cara alla piu' economica, cosi' le economiche stanno sopra
  for (let k = scelte.length - 1; k >= 0; k--) {
    const { d, prezzo, modo } = scelte[k];
    const fascia = prezzo <= riferimento * (1 + MARGINE_VERDE) ? 'verde'
      : prezzo <= riferimento * (1 + MARGINE_GIALLO) ? 'giallo'
      : 'rosso';
    const piuEconomico = k === 0;

    const elemento = document.createElement('button');
    elemento.type = 'button';
    elemento.className = `goccia ${fascia}${piuEconomico ? ' migliore' : ''}`;
    elemento.innerHTML = `<span>${formattaPrezzo(prezzo)}</span>`;
    elemento.setAttribute('aria-label',
      `${titoloDistributore(d)}, ${d.indirizzo}: ${NOMI_IN_FRASE[carburante]} ${modo} ${formattaPrezzo(prezzo)} euro`);
    elemento.addEventListener('click', (evento) => {
      evento.stopPropagation();  // il clic e' per la goccia, non per la mappa sotto
      apriScheda(d);
    });

    // La punta della goccia sporge sotto il riquadro: la spostiamo in su perche' tocchi il punto esatto
    const lato = piuEconomico ? 52 : 44;
    const marker = new maplibregl.Marker({ element: elemento, anchor: 'bottom', offset: [0, -Math.round(lato * 0.21)] })
      .setLngLat([d.lon, d.lat])
      .addTo(mappa);
    gocce.push(marker);
  }

  mostraMigliore();
}

// ---------- Riquadro "Il piu' economico in questa zona" ----------

function mostraMigliore() {
  const riquadro = document.getElementById('migliore');
  const lontano = mappa.getZoom() < ZOOM_GOCCE;

  // Con la mappa larga mostriamo il suggerimento; con la scheda aperta non mostriamo niente dei due
  document.getElementById('suggerimento').hidden = !lontano || selezionato != null || distributori.length === 0;
  riquadro.hidden = lontano || selezionato != null || distributori.length === 0;

  if (!riquadro.hidden) {
    if (!migliore) {
      riquadro.innerHTML = `<p class="vuoto">Nessun distributore con ${NOMI_IN_FRASE[carburante]} in questa zona. Allarga la mappa per cercare più lontano.</p>`;
    } else {
      const { d, prezzo, modo } = migliore;
      riquadro.innerHTML = `
        <p class="etichetta">Il più economico in questa zona</p>
        <p class="prezzo-grande">${formattaPrezzo(prezzo)} <small>${unita(carburante)} ${NOMI_IN_FRASE[carburante]} ${modo}</small></p>
        <p class="luogo">${esc(titoloDistributore(d))}, ${esc(d.indirizzo)}${testoDistanza(d)}</p>
        <div class="azioni">
          <a class="bottone primario" href="${linkGoogleMaps(d)}" target="_blank" rel="noopener">Portami lì</a>
          <button type="button" class="bottone secondario" data-azione="listino">Listino</button>
        </div>
        <p class="fonte">Prezzi del ${dataPrezzi}, fonte MIMIT</p>`;
      riquadro.querySelector('[data-azione="listino"]').addEventListener('click', () => apriScheda(d));
    }
  }
  aggiornaSpazioBasso();
}

// ---------- Scheda del distributore ----------

function rigaListino(nome, prezzi, evidenziata) {
  const cella = (valore) => (valore != null
    ? `<td>${formattaPrezzo(valore)}</td>`
    : '<td class="manca"><span aria-hidden="true">—</span><span class="nascosto">non disponibile</span></td>');
  return `<tr${evidenziata ? ' class="scelto"' : ''}><th scope="row">${nome}</th>${cella(prezzi.self)}${cella(prezzi.servito)}</tr>`;
}

function apriScheda(d, spostaFocus = true) {
  selezionato = d;
  const scheda = document.getElementById('scheda');

  const principali = Object.keys(NOMI)
    .filter((c) => d.prezzi[c])
    .map((c) => rigaListino(c === 'metano' ? 'Metano (€/kg)' : NOMI[c], d.prezzi[c], c === carburante))
    .join('');
  const altri = Object.entries(d.altri)
    .map(([nome, prezzi]) => rigaListino(esc(nome), prezzi, false))
    .join('');

  scheda.innerHTML = `
    <div class="scheda-testa">
      <span class="iniziale" aria-hidden="true">${esc(titoloDistributore(d).charAt(0))}</span>
      <div>
        <h2 id="scheda-titolo">${esc(titoloDistributore(d))}</h2>
        <p class="luogo">${esc(d.indirizzo)}, ${esc(nomeProprio(d.comune))}${testoDistanza(d)}</p>
      </div>
      <button type="button" class="chiudi" aria-label="Chiudi scheda">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="listino-box">
      <table class="listino">
        <thead><tr><th scope="col">€/L</th><th scope="col">Self</th><th scope="col">Servito</th></tr></thead>
        <tbody>${principali}</tbody>
        ${altri ? `<tbody><tr><th scope="colgroup" colspan="3">Altri carburanti</th></tr>${altri}</tbody>` : ''}
      </table>
    </div>
    <p class="fonte">${d.autostrada ? 'Distributore in autostrada. ' : ''}Ultimo aggiornamento del gestore: ${formattaData(d.aggiornato)}. Fonte MIMIT</p>
    <div class="azioni">
      <a class="bottone primario" href="${linkGoogleMaps(d)}" target="_blank" rel="noopener">Portami lì</a>
      <a class="bottone secondario" href="${linkWaze(d)}" target="_blank" rel="noopener">Apri in Waze</a>
    </div>`;

  scheda.hidden = false;
  scheda.scrollTop = 0;
  scheda.querySelector('.chiudi').addEventListener('click', chiudiScheda);
  if (spostaFocus) scheda.querySelector('.chiudi').focus();
  mostraMigliore();  // nasconde il riquadro mentre la scheda e' aperta
}

function chiudiScheda() {
  if (!selezionato) return;
  selezionato = null;
  document.getElementById('scheda').hidden = true;
  mostraMigliore();
}

// ---------- Scelta del carburante ----------

document.querySelectorAll('#carburanti button').forEach((pulsante) => {
  pulsante.addEventListener('click', () => {
    carburante = pulsante.dataset.carburante;
    document.querySelectorAll('#carburanti button').forEach((altro) => {
      altro.setAttribute('aria-pressed', String(altro === pulsante));
    });
    if (mappa.getLayer('puntini')) mappa.setFilter('puntini', ['==', ['get', carburante], true]);
    aggiornaGocce();
    if (selezionato) apriScheda(selezionato, false);  // aggiorna la riga evidenziata
  });
});

// Esc chiude la scheda; un clic sulla mappa anche
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') chiudiScheda();
});

// ---------- Avvio ----------

mappa.on('load', async () => {
  posizione.trigger();  // chiede la posizione e centra la mappa su di te

  try {
    await caricaDati();
  } catch (errore) {
    console.error(errore);
    if (location.protocol === 'file:') {
      mostraAvviso("Dati non disponibili: apri l'app da http://localhost:8000, non con un doppio clic sul file.");
    } else {
      mostraAvviso('Dati non disponibili: lancia scripts/prepara_dati.py e ricarica la pagina.');
    }
    return;
  }

  aggiungiPuntini();
  aggiornaGocce();
  mappa.on('moveend', aggiornaGocce);  // ogni volta che sposti o zoomi la mappa
  mappa.on('click', chiudiScheda);
});
