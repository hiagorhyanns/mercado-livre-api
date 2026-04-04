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

      // ✔ VALIDAÇÃO COMPLETA
      if (
        !p.title ||
        !p.category_id ||
        !p.price ||
        !p.pictures?.length ||
        !p.marca ||
        !p.modelo ||
        !p.cor ||
        !p.sexo ||
        !p.tamanho
      ) {
        results.push({
          erro: true,
          produto: p.title || "Sem título",
          detalhe: "Preencha todos os campos obrigatórios"
        });
        continue;
      }

      try {

        const body = {

          title: p.title,
          category_id: p.category_id,
          price: Number(p.price),
          currency_id: "BRL",
          available_quantity: 10,
          buying_mode: "buy_it_now",
          listing_type_id: "gold_special",
          condition: "new",

          pictures: p.pictures
            .filter(url => url && url.startsWith("http"))
            .map(url => ({ source: url })),

          // 🔥 ESSENCIAL (resolve erro)
          attribute_combinations: [
            {
              attributes: [
                { id: "COLOR", value_name: p.cor },
                { id: "SIZE", value_name: p.tamanho }
              ]
            }
          ],

          attributes: [
            { id: "BRAND", value_name: p.marca },
            { id: "MODEL", value_name: p.modelo },
            { id: "COLOR", value_name: p.cor },
            { id: "GENDER", value_name: p.sexo },
            { id: "SIZE", value_name: p.tamanho }
          ]

        };

        const response = await fetch("https://api.mercadolibre.com/items", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });

        const data = await response.json();

        // DEBUG IMPORTANTE
        if (!response.ok || data.error) {

          results.push({
            erro: true,
            produto: p.title,
            status: response.status,
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
