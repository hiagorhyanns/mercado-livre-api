export default function handler(req, res) {
  const url = 'https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}';
  res.writeHead(302, { Location: url });
  res.end();
}
