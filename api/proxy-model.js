export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Falta url' });
    }

    const modelRes = await fetch(url);
    if (!modelRes.ok) {
      return res.status(502).json({ error: 'No se pudo descargar el modelo' });
    }

    const buffer = await modelRes.arrayBuffer();
    res.setHeader('Content-Type', 'model/gltf-binary');
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
