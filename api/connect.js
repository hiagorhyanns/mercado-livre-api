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

    // DEBUG (IMPORTANTE)
    if (!data.access_token) {
      return res.status(200).send(`
        <h2>Erro:</h2>
        <pre>${JSON.stringify(data, null, 2)}</pre>
      `);
    }

    // SUCESSO
    return res.status(200).send(`
      <html>
        <body style="font-family:Arial; background:#ededed; display:flex; justify-content:center; align-items:center; height:100vh;">
          <div style="background:white; padding:30px; border-radius:10px;">
            <h2>Conectado</h2>
            <p><b>User:</b> ${data.user_id}</p>
            <p><b>Token:</b></p>
            <textarea style="width:300px; height:100px;">${data.access_token}</textarea>
          </div>
        </body>
      </html>
    `);

  } catch (err) {
    return res.status(500).send(err.toString());
  }
}
