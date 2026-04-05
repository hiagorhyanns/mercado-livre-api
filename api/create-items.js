/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  create-items.js  —  API Mercado Livre                      ║
 * ║  Estrutura correta para categorias que exigem variations     ║
 * ║  (ex: Vestidos MLB1430)                                      ║
 * ║                                                              ║
 * ║  Regras obrigatórias da ML:                                  ║
 * ║  • family_name  → raiz do body (obrigatório com variations)  ║
 * ║  • price        → DENTRO de cada variation (não na raiz)     ║
 * ║  • available_quantity → DENTRO de cada variation             ║
 * ║  • COLOR + SIZE → dentro de attribute_combinations           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const TRADUCOES_PT = {
  "family_name":                      "Campo 'family_name' obrigatório na raiz do body",
  "price":                            "Preço ausente dentro de variations",
  "available_quantity":               "Quantidade ausente dentro de variations",
  "attribute_combinations":           "Cor/Tamanho ausentes em variations",
  "The field variations is invalid":  "Variations inválido — family_name obrigatório",
  "The body does not contains":       "Body não contém campo(s) obrigatório(s)",
  "item variation with errors":       "Variação do item com erros",
  "invalid_body":                     "Body da requisição inválido",
  "missing_field":                    "Campo obrigatório ausente",
  "invalid_field":                    "Campo com valor inválido",
  "not found":                        "Recurso não encontrado",
  "unauthorized":                     "Token inválido ou expirado — reconecte",
  "invalid pictures":                 "URL de imagem inválida",
  "The resource is not reachable":    "Imagem inacessível — verifique o link",
  "listing_type":                     "Tipo de anúncio inválido",
  "cannot post item in this category":"Não é possível publicar nesta categoria com este tipo de anúncio"
};

function traduzirCauses(causes) {
  if (!Array.isArray(causes)) return [];
  return causes.map(c => {
    const original = c.message || c.code || JSON.stringify(c);
    let traduzido  = original;
    for (const [en, pt] of Object.entries(TRADUCOES_PT)) {
      if (original.toLowerCase().includes(en.toLowerCase())) { traduzido = pt; break; }
    }
    return { ...c, message_pt: traduzido };
  });
}

export default async function handler(req, res) {
  try {
    const { produtos, token } = req.body;

    if (!Array.isArray(produtos) || produtos.length === 0)
      return res.status(400).json({ error: "Nenhum produto enviado" });

    if (!token)
      return res.status(400).json({ error: "Token ausente" });

    const results = [];

    for (const p of produtos) {

      // ── Validação mínima ──────────────────────────────────────────────────
      const erros = [];
      if (!p.title)            erros.push("Título obrigatório");
      if (!p.category_id)      erros.push("Categoria obrigatória");
      if (!p.price)            erros.push("Preço obrigatório");
      if (!p.pictures?.length) erros.push("Ao menos 1 imagem obrigatória");
      if (!p.cor)              erros.push("Cor obrigatória");
      if (!p.tamanho)          erros.push("Tamanho obrigatório");
      if (!p.sexo)             erros.push("Gênero obrigatório");
      if (!p.marca)            erros.push("Marca obrigatória");

      if (erros.length > 0) {
        results.push({ erro: true, produto: p.title || "Sem título", detalhe: { message: erros.join(" | "), cause: [] } });
        continue;
      }

      try {
        // ── Pictures ─────────────────────────────────────────────────────────
        const pictures = p.pictures
          .filter(u => typeof u === "string" && u.startsWith("http"))
          .map(u => ({ source: u }));

        // ── Attributes fixos (não fazem parte das variations) ─────────────────
        const attributes = [];
        const addAttr = (id, value_name, value_id) => {
          if (!value_name) return;
          const obj = { id, value_name: String(value_name) };
          if (value_id) obj.value_id = value_id;
          attributes.push(obj);
        };

        addAttr("BRAND",  p.marca);
        addAttr("GENDER", p.sexo);
        if (p.modelo) addAttr("MODEL", p.modelo);

        // Extras dinâmicos vindos do frontend
        if (Array.isArray(p.extra_attributes)) {
          for (const ea of p.extra_attributes) {
            if (ea?.id && ea?.value_name) {
              const obj = { id: ea.id, value_name: String(ea.value_name) };
              if (ea.value_id) obj.value_id = ea.value_id;
              attributes.push(obj);
            }
          }
        }

        // ── Shipping ──────────────────────────────────────────────────────────
        const shipping = {
          mode:         "me2",
          free_shipping: p.frete_gratis === true || p.frete_gratis === "true"
        };

        if (p.peso_kg && p.largura_cm && p.altura_cm && p.profundidade_cm) {
          shipping.dimensions = {
            width:  { value: Number(p.largura_cm),      unit: "cm" },
            height: { value: Number(p.altura_cm),       unit: "cm" },
            length: { value: Number(p.profundidade_cm), unit: "cm" }
          };
        }

        // ── BODY ──────────────────────────────────────────────────────────────
        // ATENÇÃO: estrutura exata exigida pela ML para categorias com variations:
        //
        //  {
        //    "family_name": "...",       ← RAIZ — obrigatório
        //    "variations": [{
        //      "price": 99.90,           ← DENTRO da variation
        //      "available_quantity": 10, ← DENTRO da variation
        //      "attribute_combinations": [{ COLOR }, { SIZE }]
        //    }]
        //    // price e available_quantity NÃO ficam na raiz quando há variations
        //  }
        //
        const body = {
          title:            p.title,
          category_id:      p.category_id,
          currency_id:      "BRL",
          buying_mode:      "buy_it_now",
          listing_type_id:  p.listing_type || "gold_special",
          condition:        p.condition    || "new",
          warranty:         p.garantia     || "Sem garantia do fornecedor",
          pictures,
          shipping,
          attributes,

          // ✅ family_name na RAIZ — obrigatório quando há variations
          family_name: p.title.substring(0, 60),

          // ✅ price e available_quantity DENTRO de variations
          variations: [
            {
              attribute_combinations: [
                { id: "COLOR", value_name: String(p.cor)     },
                { id: "SIZE",  value_name: String(p.tamanho) }
              ],
              price:              Number(p.price),
              available_quantity: Number(p.quantidade) > 0 ? Number(p.quantidade) : 10,
              ...(p.sku ? { seller_custom_field: String(p.sku) } : {})
            }
          ]
        };

        // ── LOG para debug no servidor ────────────────────────────────────────
        console.log("\n════════════════════════════════════════");
        console.log("PRODUTO:", p.title);
        console.log("BODY ENVIADO À ML:");
        console.log(JSON.stringify(body, null, 2));

        // ── Enviar para ML ────────────────────────────────────────────────────
        const mlRes  = await fetch("https://api.mercadolibre.com/items", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type":  "application/json"
          },
          body: JSON.stringify(body)
        });

        const mlData = await mlRes.json();
        console.log("RESPOSTA ML:", JSON.stringify(mlData, null, 2));

        if (!mlRes.ok || mlData.error) {
          results.push({
            erro:    true,
            produto: p.title,
            status:  mlRes.status,
            detalhe: {
              ...mlData,
              cause_pt: traduzirCauses(mlData.cause || [])
            }
          });
          continue;
        }

        // ── Descrição (endpoint separado da ML) ───────────────────────────────
        if (p.description && String(p.description).trim()) {
          const descRes = await fetch(
            `https://api.mercadolibre.com/items/${mlData.id}/description`,
            {
              method:  "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type":  "application/json"
              },
              body: JSON.stringify({ plain_text: p.description })
            }
          );
          if (!descRes.ok) {
            const descErr = await descRes.json().catch(() => ({}));
            console.warn("Descrição não salva:", descErr);
          }
        }

        results.push({
          sucesso: true,
          produto: p.title,
          id:      mlData.id,
          link:    mlData.permalink
        });

      } catch (err) {
        results.push({
          erro:    true,
          produto: p.title,
          detalhe: { message: err.toString(), cause: [] }
        });
      }
    }

    return res.json(results);

  } catch (err) {
    return res.status(500).json({ erro: true, detalhe: { message: err.toString() } });
  }
}
