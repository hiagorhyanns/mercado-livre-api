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

      // VALIDAÇÃO
      if (
        !p.title ||
        !p.category_id ||
        !p.price ||
        !p.pictures?.length ||
        !p.marca ||
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

        const pictures = p.pictures
          .filter(url => url && url.startsWith("http"))
          .map(url => ({ source: url }));

        // ✅ ESTRUTURA CORRETA: attribute_combinations DENTRO de variations
        // Não no nível raiz do item — esse era o bug principal.
        const body = {

          title: p.title,
          category_id: p.category_id,
          currency_id: "BRL",
          buying_mode: "buy_it_now",
          listing_type_id: "gold_special",
          condition: "new",
          pictures,

          // ✅ VARIATIONS: preço e quantidade ficam aqui, não no nível raiz
          variations: [
            {
              attribute_combinations: [
                { id: "COLOR", value_name: p.cor },
                { id: "SIZE",  value_name: p.tamanho }
              ],
              price: Number(p.price),
              available_quantity: 10
            }
          ],

          // Atributos fixos (não variam por SKU)
          attributes: [
            { id: "BRAND",  value_name: p.marca  },
            { id: "GENDER", value_name: p.sexo   },
            ...(p.modelo ? [{ id: "MODEL", value_name: p.modelo }] : [])
          ]

        };

        // 1️⃣ CRIAR O ITEM
        const response = await fetch("https://api.mercadolibre.com/items", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok || data.error) {
          results.push({
            erro: true,
            produto: p.title,
            status: response.status,
            detalhe: data
          });
          continue;
        }

        // 2️⃣ POSTAR DESCRIÇÃO SEPARADA (endpoint próprio da ML)
        if (p.description && p.description.trim()) {
          const descRes = await fetch(
            `https://api.mercadolibre.com/items/${data.id}/description`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ plain_text: p.description })
            }
          );

          if (!descRes.ok) {
            const descErr = await descRes.json();
            console.warn(`Descrição não salva para ${data.id}:`, descErr);
          }
        }

        results.push({
          sucesso: true,
          produto: p.title,
          id: data.id,
          link: data.permalink
        });

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
