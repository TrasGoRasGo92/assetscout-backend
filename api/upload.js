export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
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

    const apiKey = process.env.TRIPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'TRIPO_API_KEY no configurada en Vercel' });
    }

    const buffer = Buffer.from(imageBase64, 'base64');
    const ext = (mimeType || 'image/jpeg').includes('png') ? 'png' : 'jpg';

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType || 'image/jpeg' }), `upload.${ext}`);

    const uploadRes = await fetch('https://api.tripo3d.ai/v2/openapi/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const uploadData = await uploadRes.json();

    if (!uploadRes.ok || uploadData.code !== 0) {
      return res.status(502).json({ error: 'Error subiendo la imagen a Tripo3D', detail: uploadData });
    }

    return res.status(200).json({
      fileToken: uploadData.data.image_token,
      fileType: ext,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
