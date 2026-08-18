// api/visual-search.js
// Búsqueda inversa por imagen (como Google Lens) usando Google Cloud Vision API.
// Recibe la foto y encuentra páginas web con imágenes visualmente similares.
// Filtra los resultados para priorizar portales de modelos 3D conocidos.
//
// Control de gasto: exige que el usuario haya iniciado sesión (Supabase) y
// comprueba/descuenta su límite diario de búsquedas visuales en la base de
// datos, en vez de un límite global compartido por todo el sitio.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 30,
};

const DAILY_LIMIT = 40; // más generoso que generate.js: la búsqueda visual es mucho más barata (~$0.0035 vs ~$0.20-0.30)

// Dominios conocidos de modelos/catálogos 3D — los resultados de estos dominios
// se marcan como prioritarios frente a resultados genéricos de cualquier web.
const KNOWN_3D_DOMAINS = [
  // Catálogos y marketplaces genéricos de modelos 3D
  'sketchfab.com', 'cgtrader.com', 'turbosquid.com', 'polyhaven.com',
  'free3d.com', '3dexport.com', 'cults3d.com', 'renderhub.com',
  'blendswap.com', 'artstation.com', 'thingiverse.com', 'fab.com',
  'archive3d.net', 'grabcad.com', 'clara.io', '3dsky.org',
  // Portales especializados en mobiliario/arquitectura con modelos 3D descargables
  'archiproducts.com', 'architonic.com', 'bimobject.com',
  '3dwarehouse.sketchup.com',
  // Fabricantes de mobiliario con modelos 3D/BIM propios en su web
  'ikea.com', 'andreuworld.com', 'kavehome.com', 'hay.com',
  'muuto.com', 'normann-copenhagen.com', 'vitra.com',
];

function isKnown3DDomain(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    return KNOWN_3D_DOMAINS.some((d) => host.includes(d));
  } catch {
    return false;
  }
}

async function checkUsage(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false, status: 401, error: 'Debes iniciar sesión para usar la búsqueda visual.' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: 'Supabase no configurado en el servidor (SUPABASE_URL / SUPABASE_ANON_KEY)' };
  }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_usage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ p_column: 'visual_searches', p_limit: DAILY_LIMIT }),
  });

  if (!rpcRes.ok) {
    const errData = await rpcRes.json().catch(() => ({}));
    const msg = errData.message || errData.error_description || '';
    if (msg.includes('DAILY_LIMIT_EXCEEDED')) {
      return { ok: false, status: 429, error: `Límite diario de búsquedas visuales alcanzado (${DAILY_LIMIT}/día). Vuelve a intentarlo mañana.` };
    }
    return { ok: false, status: 401, error: 'Sesión no válida. Vuelve a iniciar sesión.' };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

    // Control de gasto por usuario (requiere sesión iniciada) — se comprueba
    // ANTES de gastar créditos de Google Vision.
    const usage = await checkUsage(req);
    if (!usage.ok) {
      return res.status(usage.status).json({ error: usage.error });
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

    const allResults = pages.map((page) => ({
      title: page.pageTitle || page.url,
      url: page.url,
      thumb: page.partialMatchingImages?.[0]?.url || page.fullMatchingImages?.[0]?.url || null,
      is3DSource: isKnown3DDomain(page.url),
      // "Coincidencia fuerte" = Google encontró esta MISMA imagen (o casi
      // idéntica) en esa página. "Débil" = solo una imagen parecida en
      // general, que casi nunca es útil para encontrar el modelo 3D real.
      isStrongMatch: (page.fullMatchingImages || []).length > 0,
    }));

    const known3DResults = allResults.filter((r) => r.is3DSource);
    const strongResults = known3DResults.filter((r) => r.isStrongMatch);

    // Si hay coincidencias fuertes, mostramos solo esas (son las fiables de verdad).
    // Si NO hay ninguna, no mostramos las débiles como si fueran válidas —
    // mejor decir claramente que no se ha encontrado nada fiable, que es lo
    // más habitual con piezas únicas o artesanales que no están en internet.
    const results = strongResults.length > 0 ? strongResults : [];
    const hasOnlyWeakMatches = strongResults.length === 0 && known3DResults.length > 0;

    const bestGuess = webDetection.bestGuessLabels?.[0]?.label || null;

    return res.status(200).json({
      results: results.slice(0, 12),
      bestGuessLabel: bestGuess,
      totalFoundBeforeFilter: allResults.length,
      hasOnlyWeakMatches,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
