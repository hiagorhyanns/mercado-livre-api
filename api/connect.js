export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Sem code");
  }

  try {
    const response = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code: code,
        redirect_uri: process.env.REDIRECT_URI
      })
    });

    const data = await response.json();

    // DEBUG
    if (!data.access_token) {
      return res.status(200).send(`
        <h2>Erro ao conectar</h2>
        <pre>${JSON.stringify(data, null, 2)}</pre>
      `);
    }

    // GERAR TG (usa o próprio code)
    const tg = code;

    // REDIRECT PARA TELA FINAL
    const redirectUrl = `/success.html?user=${data.user_id}&token=${data.access_token}&tg=${tg}&expires=${data.expires_in}`;

    return res.redirect(redirectUrl);

  } catch (err) {
    return res.status(500).send(err.toString());
  }
}
