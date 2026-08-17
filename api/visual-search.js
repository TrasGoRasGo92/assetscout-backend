// api/visual-search.js
// Búsqueda inversa por imagen (como Google Lens) usando Google Cloud Vision API.
// Recibe la foto y encuentra páginas web con imágenes visualmente similares.
// Filtra los resultados para priorizar portales de modelos 3D conocidos.
// Incluye límite diario global (protección de gasto), igual que en generate.js.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 30,
};

const DAILY_LIMIT = 40; // más generoso que generate.js: la búsqueda visual es mucho más barata (~$0.0035 vs ~$0.20-0.30)

function todayKey() {
  const d = new Date();
  return `assetscout-visual-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Dominios conocidos de modelos/catálogos 3D — los resultados de estos dominios
// se marcan como prioritarios frente a resultados genéricos de cualquier web.
const KNOWN_3D_DOMAINS = [
  'sketchfab.com', 'cgtrader.com', 'turbosquid.com', 'polyhaven.com',
  'free3d.com', '3dexport.com', 'cults3d.com', 'renderhub.com',
  'blendswap.com', 'artstation.com', 'thingiverse.com', 'fab.com',
  'archive3d.net', 'grabcad.com', 'clara.io', '3dsky.org',
];

function isKnown3DDomain(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    return KNOWN_3D_DOMAINS.some((d) => host.includes(d));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Falta imageBase64' });
    }

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'GOOGLE_VISION_API_KEY no configurada en Vercel. Búsqueda visual desactivada hasta añadirla.',
      });
    }

    // Comprobamos y aumentamos el contador diario ANTES de gastar créditos
    const key = todayKey();
    let count = 0;
    try {
      const counterRes = await fetch(`https://api.countapi.xyz/hit/assetscout-limits/${key}`);
      const counterData = await counterRes.json();
      count = counterData.value || 0;
    } catch (counterErr) {
      console.error('No se pudo consultar el contador, se permite la petición por seguridad', counterErr);
    }

    if (count > DAILY_LIMIT) {
      return res.status(429).json({
        error: `Límite diario de búsquedas visuales alcanzado (${DAILY_LIMIT}/día). Vuelve a intentarlo mañana.`,
      });
    }

    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: imageBase64 },
              features: [{ type: 'WEB_DETECTION', maxResults: 15 }],
            },
          ],
        }),
      }
    );

    const visionData = await visionRes.json();

    if (!visionRes.ok) {
      return res.status(502).json({ error: 'Error llamando a Google Vision', detail: visionData });
    }

    const webDetection = visionData.responses?.[0]?.webDetection || {};
    const pages = webDetection.pagesWithMatchingImages || [];

    const results = pages.map((page) => ({
      title: page.pageTitle || page.url,
      url: page.url,
      thumb: page.partialMatchingImages?.[0]?.url || page.fullMatchingImages?.[0]?.url || null,
      is3DSource: isKnown3DDomain(page.url),
    }));

    results.sort((a, b) => (b.is3DSource ? 1 : 0) - (a.is3DSource ? 1 : 0));

    const bestGuess = webDetection.bestGuessLabels?.[0]?.label || null;

    return res.status(200).json({
      results: results.slice(0, 12),
      bestGuessLabel: bestGuess,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
