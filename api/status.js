export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { taskId } = req.query;
    if (!taskId) {
      return res.status(400).json({ error: 'Falta taskId' });
    }

    const apiKey = process.env.TRIPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'TRIPO_API_KEY no configurada en Vercel' });
    }

    const statusRes = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const statusData = await statusRes.json();

    if (!statusRes.ok || statusData.code !== 0) {
      return res.status(502).json({ error: 'Error consultando la tarea', detail: statusData });
    }

    const task = statusData.data;

    return res.status(200).json({
      status: task.status,
      progress: task.progress,
      modelUrl: task.output?.pbr_model || task.output?.model || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
}
