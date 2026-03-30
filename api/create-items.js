export default async function handler(req, res) {

  try {

    const { produtos, token } = req.body;

    if (!produtos || !Array.isArray(produtos) || produtos.length === 0) {
      return res.status(400).json({ error: "Nenhum produto enviado" });
    }

    if (!token) {
      return res.status(400).json({ error: "Token não enviado" });
    }

    const results = [];

    for (const p of produtos) {

      // VALIDAÇÃO BÁSICA
      if (!p.title || !p.category_id || !p.price || !p.pictures?.length) {
        results.push({
          erro: true,
          detalhe: "Dados incompletos no produto"
        });
        continue;
      }

      try {

        const response = await fetch("https://api.mercadolibre.com/items", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: p.title,
            category_id: p.category_id,
            price: Number(p.price),
            currency_id: "BRL",
            available_quantity: 10,
            buying_mode: "buy_it_now",
            listing_type_id: "gold_special",
            condition: "new",

            pictures: p.pictures.map(url => ({ source: url })),

            attributes: [
              { id: "BRAND", value_name: "Genérica" },
              { id: "MODEL", value_name: "Padrão" },
              { id: "GENDER", value_name: "Feminino" },
              { id: "SIZE", value_name: "M" },
              { id: "COLOR", value_name: "Preto" }
            ]
          })
        });

        const data = await response.json();

        // CAPTURA ERRO REAL DA API
        if (!response.ok || data.error) {
          results.push({
            erro: true,
            produto: p.title,
            detalhe: data
          });
        } else {
          results.push({
            sucesso: true,
            produto: p.title,
            id: data.id
          });
        }

      } catch (err) {
        results.push({
          erro: true,
          produto: p.title,
          detalhe: err.toString()
        });
      }
    }

    return res.json(results);

  } catch (err) {
    return res.status(500).json({
      erro: true,
      detalhe: err.toString()
    });
  }
}
