export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 60,
};

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
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Falta imageBase64' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en Vercel' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
            {
              type: 'text',
              text: "Analiza esta imagen de un mueble o pieza de carpintería/mobiliario. Devuelve SOLO un JSON (sin texto adicional, sin markdown) con esta forma exacta: {\"tipo\":\"...\",\"estilo\":\"...\",\"material\":\"...\",\"color\":\"...\",\"dimensiones_estimadas\":\"...\"}. Si algo no es determinable, pon 'no determinado'.",
            },
          ],
        }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({ error: 'Error llamando a la API de Anthropic', detail: data });
    }

    const text = data.content.map((b) => b.text || '').join('').replace(/```json|```/g, '').trim();
    let attrs;
    try {
      attrs = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({ error: 'La respuesta no era JSON válido', raw: text });
    }

    return res.status(200).json(attrs);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
