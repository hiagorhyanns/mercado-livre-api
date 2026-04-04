export default async function handler(req, res) {

  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Sem code de autorização.");
  }

  try {

    const response = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type:    "authorization_code",
        client_id:     process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code:          code,
        redirect_uri:  process.env.REDIRECT_URI
      })
    });

    const data = await response.json();

    if (!data.access_token) {
      return res.status(200).send(`
        <!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px">
        <h2 style="color:red">Erro ao conectar com Mercado Livre</h2>
        <pre style="background:#f5f5f5;padding:15px;border-radius:8px">${JSON.stringify(data, null, 2)}</pre>
        <a href="/">← Tentar novamente</a>
        </body></html>
      `);
    }

    // Redirecionar para tela de sucesso
    const redirectUrl = `/success.html?user=${data.user_id}&token=${encodeURIComponent(data.access_token)}&tg=${encodeURIComponent(code)}&expires=${data.expires_in}`;

    return res.redirect(redirectUrl);

  } catch (err) {

    return res.status(500).send(`
      <!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px">
      <h2 style="color:red">Erro interno</h2>
      <pre>${err.toString()}</pre>
      <a href="/">← Tentar novamente</a>
      </body></html>
    `);

  }
}
