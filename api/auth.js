export default function handler(req, res) {
  const client_id = process.env.CLIENT_ID;
  const redirect_uri = process.env.REDIRECT_URI;

  const url =
    "https://auth.mercadolivre.com.br/authorization" +
    "?response_type=code" +
    "&client_id=" + client_id +
    "&redirect_uri=" + redirect_uri;

  res.writeHead(302, { Location: url });
  res.end();
}
