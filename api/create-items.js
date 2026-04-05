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

    // Cache de atributos da categoria (evita requisições repetidas)
    const categoryAttrCache = {};

    for (const p of produtos) {

      if (!p.title || !p.category_id || !p.price || !p.pictures?.length || !p.marca || !p.cor || !p.sexo || !p.tamanho) {
        results.push({ erro: true, produto: p.title || "Sem título", detalhe: "Preencha todos os campos obrigatórios" });
        continue;
      }

      try {

        // ── 1. BUSCAR ATRIBUTOS OBRIGATÓRIOS DA CATEGORIA ──────────────────
        // Endpoint público — não precisa de token
        if (!categoryAttrCache[p.category_id]) {
          const attrRes = await fetch(
            `https://api.mercadolibre.com/categories/${p.category_id}/attributes`
          );
          categoryAttrCache[p.category_id] = attrRes.ok ? await attrRes.json() : [];
        }

        const categoryAttrs = categoryAttrCache[p.category_id];

        // Atributos que vão para variations (não duplicar nos attributes fixos)
        const VARIATION_ATTRS = new Set(["COLOR", "SIZE"]);

        // Atributos que já incluímos explicitamente
        const ALWAYS_INCLUDED = new Set(["BRAND", "GENDER", "MODEL", "COLOR", "SIZE"]);

        // ── 2. MONTAR attributes FIXOS ─────────────────────────────────────
        // Inclui: os nossos padrão + extras enviados pelo frontend + qualquer
        // obrigatório que ainda não está coberto (com 1º valor permitido como default)

        const fixedAttributes = [
          { id: "BRAND",  value_name: p.marca },
          { id: "GENDER", value_name: p.sexo  },
          ...(p.modelo ? [{ id: "MODEL", value_name: p.modelo }] : [])
        ];

        // Extras enviados explicitamente pelo frontend (campos dinâmicos)
        if (Array.isArray(p.extra_attributes)) {
          for (const ea of p.extra_attributes) {
            if (ea.id && !VARIATION_ATTRS.has(ea.id) && !ALWAYS_INCLUDED.has(ea.id)) {
              fixedAttributes.push(ea);
            }
          }
        }

        // Verificar se ficou algum obrigatório sem valor → usar 1º allowed_value como fallback
        const coveredIds = new Set(fixedAttributes.map(a => a.id));

        for (const attr of categoryAttrs) {
          if (
            attr.tags?.required === true &&
            !VARIATION_ATTRS.has(attr.id) &&
            !coveredIds.has(attr.id)
          ) {
            if (attr.allowed_values && attr.allowed_values.length > 0) {
              // Usa o primeiro valor permitido como fallback automático
              const first = attr.allowed_values[0];
              fixedAttributes.push({ id: attr.id, value_id: first.id, value_name: first.name });
              coveredIds.add(attr.id);
            }
            // Se não tem allowed_values e não foi enviado pelo usuário, não há como resolver
          }
        }

        // ── 3. PICTURES ────────────────────────────────────────────────────
        const pictures = p.pictures
          .filter(url => url && url.startsWith("http"))
          .map(url => ({ source: url }));

        // ── 4. BODY FINAL ──────────────────────────────────────────────────
        // attribute_combinations DENTRO de variations — esse era o bug principal
        const body = {
          title:            p.title,
          category_id:      p.category_id,
          currency_id:      "BRL",
          buying_mode:      "buy_it_now",
          listing_type_id:  "gold_special",
          condition:        "new",
          pictures,

          // ✅ CORRETO: preço e qty ficam dentro de cada variation
          variations: [
            {
              attribute_combinations: [
                { id: "COLOR", value_name: p.cor     },
                { id: "SIZE",  value_name: p.tamanho }
              ],
              price:              Number(p.price),
              available_quantity: 10
            }
          ],

          // Atributos fixos (não variam por SKU)
          attributes: fixedAttributes
        };

        // ── 5. CRIAR ITEM ──────────────────────────────────────────────────
        const response = await fetch("https://api.mercadolibre.com/items", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type":  "application/json"
          },
          body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok || data.error) {
          results.push({
            erro:    true,
            produto: p.title,
            status:  response.status,
            detalhe: data   // inclui data.cause com campos faltantes
          });
          continue;
        }

        // ── 6. DESCRIÇÃO SEPARADA ─────────────────────────────────────────
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
            const descErr = await descRes.json();
            console.warn(`Descrição não salva (${data.id}):`, descErr);
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
