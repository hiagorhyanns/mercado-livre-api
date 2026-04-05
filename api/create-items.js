export default async function handler(req, res) {
  try {
    const { produtos, token } = req.body;

    if (!produtos || !Array.isArray(produtos) || produtos.length === 0)
      return res.status(400).json({ error: "Nenhum produto enviado" });

    if (!token)
      return res.status(400).json({ error: "Token não enviado" });

    const results = [];

    for (const p of produtos) {

      if (!p.title || !p.category_id || !p.price || !p.pictures?.length) {
        results.push({ erro: true, produto: p.title || "Sem título", detalhe: "Campos obrigatórios faltando" });
        continue;
      }

      try {

        // ── PICTURES ────────────────────────────────────────────────────────
        const pictures = p.pictures
          .filter(url => url && url.startsWith("http"))
          .map(url => ({ source: url }));

        // ── ATTRIBUTES ──────────────────────────────────────────────────────
        // Quando NÃO se usa variations, COLOR e SIZE vão em attributes normalmente
        const attributes = [];

        const add = (id, value_name, value_id) => {
          if (!value_name) return;
          const obj = { id, value_name: String(value_name) };
          if (value_id) obj.value_id = value_id;
          attributes.push(obj);
        };

        // Fixos principais
        add("BRAND",  p.marca);
        add("GENDER", p.sexo);
        add("MODEL",  p.modelo);
        add("COLOR",  p.cor);
        add("SIZE",   p.tamanho);

        // Extras dinâmicos enviados pelo frontend
        if (Array.isArray(p.extra_attributes)) {
          for (const ea of p.extra_attributes) {
            if (ea.id && ea.value_name) {
              const obj = { id: ea.id, value_name: String(ea.value_name) };
              if (ea.value_id) obj.value_id = ea.value_id;
              attributes.push(obj);
            }
          }
        }

        // ── SHIPPING ────────────────────────────────────────────────────────
        const shipping = { mode: "me2", free_shipping: false };

        if (p.peso_kg && p.largura_cm && p.altura_cm && p.profundidade_cm) {
          shipping.dimensions = {
            width:  { value: Number(p.largura_cm),      unit: "cm" },
            height: { value: Number(p.altura_cm),       unit: "cm" },
            length: { value: Number(p.profundidade_cm), unit: "cm" }
          };
        }

        // ── WARRANTY ────────────────────────────────────────────────────────
        // ML aceita warranty como atributo de texto livre ou campo da raiz
        const warrantyText = p.garantia ? p.garantia : "Sem garantia";

        // ── BODY FINAL ──────────────────────────────────────────────────────
        // SEM variations → price e available_quantity ficam na raiz
        const body = {
          title:              p.title,
          category_id:        p.category_id,
          price:              Number(p.price),
          currency_id:        "BRL",
          available_quantity: Number(p.quantidade || 10),
          buying_mode:        "buy_it_now",
          // Clássico = gold_special | Premium = gold_pro
          listing_type_id:    p.listing_type || "gold_special",
          condition:          "new",
          warranty:           warrantyText,
          pictures,
          shipping,
          attributes,
          ...(p.sku ? { seller_custom_field: p.sku } : {})
        };

        // ── CRIAR ITEM ──────────────────────────────────────────────────────
        const response = await fetch("https://api.mercadolibre.com/items", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type":  "application/json"
          },
          body: JSON.stringify(body)
        });

        const data = await response.json();

        // Debug completo no console do servidor
        console.log("ML body enviado:", JSON.stringify(body, null, 2));
        console.log("ML resposta:", JSON.stringify(data, null, 2));

        if (!response.ok || data.error) {
          results.push({
            erro:    true,
            produto: p.title,
            status:  response.status,
            detalhe: data
          });
          continue;
        }

        // ── DESCRIÇÃO SEPARADA ───────────────────────────────────────────────
        if (p.description && p.description.trim()) {
          const descRes = await fetch(
            `https://api.mercadolibre.com/items/${data.id}/description`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type":  "application/json"
              },
              body: JSON.stringify({ plain_text: p.description })
            }
          );
          if (!descRes.ok) {
            console.warn("Descrição não salva:", await descRes.json());
          }
        }

        results.push({
          sucesso: true,
          produto: p.title,
          id:      data.id,
          link:    data.permalink
        });

      } catch (err) {
        results.push({ erro: true, produto: p.title, detalhe: err.toString() });
      }
    }

    return res.json(results);

  } catch (err) {
    return res.status(500).json({ erro: true, detalhe: err.toString() });
  }
}
