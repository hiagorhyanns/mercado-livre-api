export default async function handler(req, res) {
  const { client_id, client_secret, redirect_uri, code } = req.query;

  // LOGIN
  if (!code) {
    const url = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}`;
    res.writeHead(302, { Location: url });
    res.end();
    return;
  }

  // TOKEN
  const response = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id,
      client_secret,
      code,
      redirect_uri
    })
  });

  const data = await response.json();

  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
