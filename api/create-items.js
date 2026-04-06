export const config = {
  api: {
    bodyParser: true,  // garante parsing do body no Vercel
  },
};

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Método não permitido" });

  // Parsing manual do body (caso Vercel não parse automaticamente)
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: "Body inválido — não é JSON" });
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Body vazio ou inválido" });
  }

  const { produtos, token } = body;

  if (!Array.isArray(produtos) || !produtos.length)
    return res.status(400).json({ error: "Nenhum produto enviado" });
  if (!token)
    return res.status(400).json({ error: "Token ausente" });

  const results = [];

  for (const p of produtos) {

    const erros = [];
    if (!p.title)            erros.push("Título obrigatório");
    if (!p.category_id)      erros.push("Categoria obrigatória");
    if (!p.price)            erros.push("Preço obrigatório");
    if (!p.pictures?.length) erros.push("Imagem obrigatória");
    if (!p.cor)              erros.push("Cor obrigatória");
    if (!p.tamanho)          erros.push("Tamanho obrigatório");
    if (!p.sexo)             erros.push("Gênero obrigatório");
    if (!p.marca)            erros.push("Marca obrigatória");

    if (erros.length) {
      results.push({ erro: true, titulo: p.title || "Sem título", detalhe: { message: erros.join(" | "), cause: [] } });
      continue;
    }

    try {
      const pictures = p.pictures
        .filter(u => typeof u === "string" && u.startsWith("http"))
        .map(u => ({ source: u }));

      const attributes = [];
      const add = (id, val) => { if (val) attributes.push({ id, value_name: String(val) }); };
      add("BRAND",           p.marca);
      add("GENDER",          p.sexo);
      add("MODEL",           p.modelo);
      add("COLOR",           p.cor);
      add("SIZE",            p.tamanho);
      add("MAIN_MATERIAL",   p.material);
      add("LENGTH_TYPE",     p.comprimento);
      add("SLEEVE_TYPE",     p.manga);
      add("COLLAR_TYPE",     p.gola);
      add("DRESS_TYPE",      p.tipo_vestido);
      add("LAUNCH_SEASON",   p.temporada);
      add("AGE_GROUP",       p.faixa_etaria);
      add("IS_FOR_PREGNANT", p.gestante);
      add("OCCASION",        p.ocasioes);
      add("STYLE",           p.estilos);

      const shipping = { mode: "me2", free_shipping: p.frete_gratis === true };
      if (p.peso_kg && p.largura_cm && p.altura_cm && p.profundidade_cm) {
        shipping.dimensions = {
          width:  { value: Number(p.largura_cm),      unit: "cm" },
          height: { value: Number(p.altura_cm),       unit: "cm" },
          length: { value: Number(p.profundidade_cm), unit: "cm" }
        };
      }

      const mlBody = {
        title:           p.title,
        category_id:     p.category_id,
        currency_id:     "BRL",
        buying_mode:     "buy_it_now",
        listing_type_id: p.listing_type || "gold_special",
        condition:       p.condition    || "new",
        pictures,
        shipping,
        attributes,
        family_name:     p.title,
        variations: [{
          attribute_combinations: [
            { id: "COLOR", value_name: String(p.cor)     },
            { id: "SIZE",  value_name: String(p.tamanho) }
          ],
          price:              Number(p.price),
          available_quantity: Number(p.quantidade) > 0 ? Number(p.quantidade) : 10,
          ...(p.sku ? { seller_custom_field: String(p.sku) } : {})
        }],
        ...(p.garantia ? { warranty: p.garantia } : {})
      };

      console.log("BODY ML:", JSON.stringify(mlBody));

      const mlRes  = await fetch("https://api.mercadolibre.com/items", {
        method:  "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify(mlBody)
      });
      const mlData = await mlRes.json();
      console.log("ML RESP:", JSON.stringify(mlData));

      if (!mlRes.ok || mlData.error) {
        results.push({ erro: true, titulo: p.title, status: mlRes.status, detalhe: mlData });
        continue;
      }

      if (p.descricao?.trim()) {
        await fetch(`https://api.mercadolibre.com/items/${mlData.id}/description`, {
          method:  "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body:    JSON.stringify({ plain_text: p.descricao })
        }).catch(() => {});
      }

      results.push({ sucesso: true, titulo: p.title, id: mlData.id, link: mlData.permalink });

    } catch (err) {
      results.push({ erro: true, titulo: p.title, detalhe: { message: err.toString(), cause: [] } });
    }
  }

  return res.json(results);
}
