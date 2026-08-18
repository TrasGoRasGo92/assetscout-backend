// api/create-token.js
// Genera una "clave personal" (token) que el usuario pega una sola vez en
// el plugin de 3ds Max/Blender/etc. para que ese plugin pueda identificarse
// como él sin tener que iniciar sesión con Google desde dentro del programa.
//
// Por seguridad, NUNCA guardamos la clave real en la base de datos — solo
// su huella digital (hash). Igual que hacen GitHub o Figma con sus tokens
// de acceso personal: si alguien accediera a la base de datos, no podría
// robar las claves de nadie.
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const authHeader = req.headers.authorization || '';
    const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!userToken) return res.status(401).json({ error: 'Debes iniciar sesión' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    // Verificar quién es el usuario (con su propia sesión, no con la clave secreta)
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userToken}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesión no válida' });
    const userData = await userRes.json();

    const { label } = req.body || {};

    // Generar una clave aleatoria larga y su huella digital (hash)
    const rawToken = `vrv_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Guardar solo el hash — usando la propia sesión del usuario, que ya
    // tiene permiso (por la política RLS) para insertar sus propios tokens
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/api_tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: userData.id,
        token_hash: tokenHash,
        label: label || 'Plugin',
      }),
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(502).json({ error: 'No se pudo guardar la clave', detail: errText });
    }

    // Esta es la ÚNICA vez que se devuelve la clave real — a partir de
    // ahora ni siquiera nuestro propio servidor puede volver a verla.
    return res.status(200).json({ token: rawToken });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
