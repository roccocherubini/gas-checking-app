// =====================================================================
// App Distributori - fase 3: mappa con le gocce dei prezzi
// =====================================================================

// ---------- Impostazioni ----------
const FILE_DATI = 'data/distributori.json';
const CENTRO_ITALIA = [12.5, 42.3];  // MapLibre vuole [longitudine, latitudine]
const ZOOM_GOCCE = 12;               // da questo zoom in su compaiono le gocce con il prezzo
const SPAZIO_GOCCIA = { x: 40, y: 46 };  // in pixel: due gocce piu' vicine di cosi' si sovrapporrebbero
const MARGINE_VERDE = 0.015;         // fino all'1,5% sopra i piu' economici della zona -> verde (circa 3 cent)
const MARGINE_GIALLO = 0.05;         // fino al 5% sopra -> giallo (circa 10 cent); oltre -> rosso
const CARBURANTE = 'benzina';        // nella fase 4 diventa selezionabile dall'utente
const MODALITA = 'self';

const LINK_MIMIT = 'https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti';

// ---------- Stato ----------
let distributori = [];  // tutti i distributori letti dal file JSON
let gocce = [];         // le gocce attualmente sulla mappa

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

// Crea un elemento HTML con classe e testo (textContent evita problemi con caratteri speciali)
function crea(tag, classe, testo) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (testo) elemento.textContent = testo;
  return elemento;
}

function mostraAvviso(testo, durataMs) {
  const avviso = document.getElementById('avviso');
  avviso.textContent = testo;
  avviso.hidden = false;
  if (durataMs) setTimeout(() => { avviso.hidden = true; }, durataMs);
}

// Per le pompe bianche la "bandiera" non dice niente: meglio il nome dell'impianto
function titoloDistributore(d) {
  if (d.bandiera === 'Pompe Bianche') return d.nome || 'Pompa bianca';
  return d.bandiera || d.nome;
}

// ---------- Dati ----------

async function caricaDati() {
  const risposta = await fetch(FILE_DATI);
  if (!risposta.ok) throw new Error(`Risposta HTTP ${risposta.status}`);
  const dati = await risposta.json();
  distributori = dati.distributori;
  document.getElementById('intestazione').textContent =
    `Benzina self, prezzi del ${formattaData(dati.estrazione)}`;
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
        properties: {},
      })),
    },
  });

  mappa.addLayer({
    id: 'puntini',
    type: 'circle',
    source: 'distributori',
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

// ---------- Gocce (zoom vicino) ----------

function creaPopup(d, prezzo) {
  const contenuto = crea('div');
  contenuto.append(
    crea('p', 'popup-marca', titoloDistributore(d)),
    crea('p', 'popup-indirizzo', `${d.indirizzo}, ${d.comune}${d.autostrada ? ' (autostrada)' : ''}`),
  );
  const riga = crea('p', 'popup-prezzo', formattaPrezzo(prezzo) + ' ');
  riga.append(crea('small', '', '€/L benzina self'));
  contenuto.append(riga);

  return new maplibregl.Popup({ offset: 56, closeButton: false, maxWidth: '260px' })
    .setDOMContent(contenuto);
}

function aggiornaGocce() {
  // Togliamo le gocce vecchie
  gocce.forEach((marker) => marker.remove());
  gocce = [];

  const vicino = mappa.getZoom() >= ZOOM_GOCCE;
  document.getElementById('suggerimento').hidden = vicino;
  if (!vicino) return;

  // 1. Distributori nell'area visibile con il prezzo scelto, dal piu' economico al piu' caro
  const area = mappa.getBounds();
  const visibili = distributori
    .filter((d) => area.contains([d.lon, d.lat]))
    .map((d) => ({ d, prezzo: d.prezzi[CARBURANTE]?.[MODALITA] }))
    .filter((v) => v.prezzo != null)
    .sort((a, b) => a.prezzo - b.prezzo);

  if (visibili.length === 0) return;

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

  // 4. Disegniamo dalla piu' cara alla piu' economica, cosi' le economiche stanno sopra
  for (let k = scelte.length - 1; k >= 0; k--) {
    const { d, prezzo } = scelte[k];
    const fascia = prezzo <= riferimento * (1 + MARGINE_VERDE) ? 'verde'
      : prezzo <= riferimento * (1 + MARGINE_GIALLO) ? 'giallo'
      : 'rosso';
    const migliore = k === 0;

    const elemento = crea('div', `goccia ${fascia}${migliore ? ' migliore' : ''}`);
    elemento.append(crea('span', '', formattaPrezzo(prezzo)));

    // La punta della goccia sporge sotto il riquadro: la spostiamo in su perche' tocchi il punto esatto
    const lato = migliore ? 52 : 44;
    const marker = new maplibregl.Marker({ element: elemento, anchor: 'bottom', offset: [0, -Math.round(lato * 0.21)] })
      .setLngLat([d.lon, d.lat])
      .setPopup(creaPopup(d, prezzo))
      .addTo(mappa);
    marker.getElement().setAttribute('aria-label',
      `${titoloDistributore(d)}, ${d.indirizzo}: benzina self ${formattaPrezzo(prezzo)} euro al litro`);

    gocce.push(marker);
  }
}

// ---------- Avvio ----------

mappa.on('load', async () => {
  posizione.trigger();  // chiede la posizione e centra la mappa su di te

  try {
    await caricaDati();
  } catch (errore) {
    console.error(errore);
    document.getElementById('intestazione').hidden = true;
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
});
