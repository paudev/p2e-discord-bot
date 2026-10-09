export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, app: 'CryptoPH P2E Discovery', time: new Date().toISOString() });
}
