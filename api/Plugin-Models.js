// api/plugin-models.js
// Lo llaman los plugins (3ds Max, Blender, Unreal...), NO la web. Reciben
// la "clave personal" del usuario (en vez de una sesión de Google) y
// devuelven su historial de modelos generados, más recientes primero —
// para pintar la galería dentro del programa 3D.
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const authHeader = req.headers.authorization || '';
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!rawToken) return res.status(401).json({ error: 'Falta la clave personal (Authorization: Bearer <clave>)' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: 'Supabase no configurado del todo en el servidor (falta SUPABASE_SERVICE_ROLE_KEY)' });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Buscar a quién pertenece esta clave (con la clave secreta, porque
    // aquí no hay sesión de usuario normal, solo el token del plugin)
    const tokenRes = await fetch(
      `${SUPABASE_URL}/rest/v1/api_tokens?token_hash=eq.${tokenHash}&select=user_id`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } }
    );
    const tokenRows = await tokenRes.json();
    if (!tokenRes.ok || !tokenRows.length) {
      return res.status(401).json({ error: 'Clave personal no válida' });
    }
    const userId = tokenRows[0].user_id;

    // Traer sus últimos modelos generados, más recientes primero
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const modelsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/generated_models?user_id=eq.${userId}&select=id,created_at,nombre,tipo,estilo,model_url,thumbnail_url&order=created_at.desc&limit=${limit}`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } }
    );
    const models = await modelsRes.json();

    return res.status(200).json({ models });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
