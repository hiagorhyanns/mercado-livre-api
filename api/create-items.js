export default async function handler(req, res) {

  const { produtos, token } = req.body;

  const results = [];

  for (const p of produtos) {

    const response = await fetch("https://api.mercadolibre.com/items", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: p.title,
        category_id: p.category_id,
        price: p.price,
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
    results.push(data);
  }

  return res.json(results);
}
