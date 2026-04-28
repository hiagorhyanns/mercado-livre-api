export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Metodo nao permitido" });

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch(e) {
        return res.status(400).json({ error: "Body invalido" });
      }
    }
    if (!body || typeof body !== "object")
      return res.status(400).json({ error: "Body vazio" });

    const { produtos, token } = body;
    if (!Array.isArray(produtos) || !produtos.length)
      return res.status(400).json({ error: "Nenhum produto" });
    if (!token)
      return res.status(400).json({ error: "Token ausente" });

    const tk = String(token).trim();
    const results = [];

    // Cache geral
    const domainCache  = {}; // catId → domain_id
    const specCache    = {}; // domain_id → { genderValues, sizeValues }
    const chartCache   = {}; // domain_id|genderValueId → { gridId, rows }

    // ── Helpers ──────────────────────────────────────────────────────────────

    async function getDomainId(catId) {
      if (domainCache[catId]) return domainCache[catId];
      const r = await fetch(`https://api.mercadolibre.com/categories/${catId}`, {
        headers: { "Authorization": `Bearer ${tk}` }
      });
      const d = await r.json();
      domainCache[catId] = d?.domain_id || null;
      console.log(`[domain] ${catId} → ${domainCache[catId]}`);
      return domainCache[catId];
    }

    async function getSpecs(domainFull) {
      if (specCache[domainFull]) return specCache[domainFull];

      // Remove prefixo site (MLB-DRESSES → DRESSES)
      const domainShort = domainFull.replace(/^[A-Z]+-/, "");

      const r = await fetch(
        `https://api.mercadolibre.com/domains/${domainFull}/technical_specs?section=grids`,
        { headers: { "Authorization": `Bearer ${tk}` } }
      );
      const d = await r.json();
      console.log(`[specs] ${domainFull} status=${r.status}`, JSON.stringify(d).substring(0, 800));

      // Extrair valores válidos de GENDER
      const genderAttr = (d.attributes || []).find(a => a.id === "GENDER");
      const genderValues = (genderAttr?.values || []).map(v => ({ id: v.id, name: v.name }));

      // Extrair valores válidos de SIZE (pode ser list ou text)
      const sizeAttr = (d.attributes || []).find(a => a.id === "SIZE")
        || ((d.rows?.attributes || []).find(a => a.id === "SIZE"));

      // Se for tipo list, pegar os value_id e value_name disponíveis
      let sizeValues = [];
      if (sizeAttr?.values?.length) {
        sizeValues = sizeAttr.values.map(v => ({ id: v.id, name: v.name || v.value_name }));
      } else {
        // Fallback: texto livre com tamanhos internacionais comuns
        sizeValues = [
          { id: null, name: "XS" }, { id: null, name: "S"  },
          { id: null, name: "M"  }, { id: null, name: "L"  },
          { id: null, name: "XL" }, { id: null, name: "XXL" },
          { id: null, name: "3XL"}, { id: null, name: "4XL" }
        ];
      }

      specCache[domainFull] = { domainShort, genderValues, sizeAttr, sizeValues, raw: d };
      return specCache[domainFull];
    }

    async function getOrCreateChart(domainFull, sexoValue) {
      const spec = await getSpecs(domainFull);
      const { domainShort, genderValues, sizeValues } = spec;

      // Encontrar gender value_id reconhecido pelo ML
      const sexoLower = String(sexoValue).toLowerCase();
      let genderMatch = genderValues.find(g =>
        g.name.toLowerCase().includes(sexoLower.substring(0, 5)) ||
        sexoLower.includes(g.name.toLowerCase().substring(0, 5))
      ) || genderValues[0];

      if (!genderMatch) {
        // Valores padrão ML BR
        genderMatch = sexoLower.includes("masc") || sexoLower.includes("hom")
          ? { id: "339666", name: "Homem"  }
          : { id: "339665", name: "Mulher" };
      }

      const cacheKey = `${domainShort}|${genderMatch.id || genderMatch.name}`;
      if (chartCache[cacheKey]) return chartCache[cacheKey];

      // ── 1. Buscar chart existente do vendedor ──────────────────────────────
      try {
        const sr = await fetch("https://api.mercadolibre.com/catalog/charts/search", {
          method: "POST",
          headers: { "Authorization": `Bearer ${tk}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            site_id:   "MLB",
            type:      "SPECIFIC",
            domain_id: domainShort,
            attributes: [genderMatch.id
              ? { id: "GENDER", value_id: genderMatch.id }
              : { id: "GENDER", value_name: genderMatch.name }
            ]
          })
        });
        const sd = await sr.json();
        console.log(`[chart][search] status=${sr.status}`, JSON.stringify(sd).substring(0, 400));
        const list = Array.isArray(sd) ? sd : (sd.results || sd.charts || []);
        if (list.length && list[0].id) {
          const existId = String(list[0].id);
          const rows = await getRows(existId);
          chartCache[cacheKey] = { gridId: existId, rows };
          console.log(`[chart] Reutilizando existente id=${existId}`);
          return chartCache[cacheKey];
        }
      } catch(e) {
        console.log(`[chart][search] erro:`, e.message);
      }

      // ── 2. Criar chart SPECIFIC com valores corretos do domínio ───────────
      try {
        const genderAttrBody = genderMatch.id
          ? { id: "GENDER", value_id: genderMatch.id,   value_name: genderMatch.name }
          : { id: "GENDER", value_name: genderMatch.name };

        // Montar rows com SIZE values válidos do domínio
        const rowsBody = sizeValues.map(sv => {
          const sizeAttrRow = sv.id
            ? { id: "SIZE", value_id: sv.id, value_name: sv.name }
            : { id: "SIZE", value_name: sv.name };
          return { attributes: [sizeAttrRow] };
        });

        const chartBody = {
          type:      "SPECIFIC",
          site_id:   "MLB",
          domain_id: domainShort,
          names:     { MLB: `Guia Tamanhos ${genderMatch.name}` },
          main_attribute: { attributes: [{ site_id: "MLB", id: "SIZE" }] },
          attributes: [genderAttrBody],
          rows: rowsBody
        };

        console.log("[chart][create] body:", JSON.stringify(chartBody).substring(0, 600));

        const cr = await fetch("https://api.mercadolibre.com/catalog/charts", {
          method:  "POST",
          headers: { "Authorization": `Bearer ${tk}`, "Content-Type": "application/json" },
          body:    JSON.stringify(chartBody)
        });
        const cd = await cr.json();
        console.log(`[chart][create] status=${cr.status}`, JSON.stringify(cd).substring(0, 600));

        if (cd.id) {
          const rows = await getRows(String(cd.id));
          chartCache[cacheKey] = { gridId: String(cd.id), rows };
          return chartCache[cacheKey];
        }

        // Se chegou aqui, logar o erro completo e retornar null
        console.log("[chart][create] FALHOU:", JSON.stringify(cd));
      } catch(e) {
        console.log(`[chart][create] erro:`, e.message);
      }

      return null;
    }

    async function getRows(chartId) {
      try {
        const r = await fetch(`https://api.mercadolibre.com/catalog/charts/${chartId}`, {
          headers: { "Authorization": `Bearer ${tk}` }
        });
        const d = await r.json();
        const rows = d.rows || [];
        return rows.map(row => {
          const sAttr = (row.local_attributes || row.attributes || []).find(a => a.id === "SIZE");
          return { size: sAttr?.value_name || "", rowId: String(row.id) };
        });
      } catch(e) {
        return [];
      }
    }

    function findRowId(rows, tamanho) {
      if (!rows?.length) return null;
      const t = String(tamanho).trim().toUpperCase();
      return (
        rows.find(r => r.size.toUpperCase() === t)?.rowId ||
        rows.find(r => r.size.toUpperCase().includes(t) || t.includes(r.size.toUpperCase()))?.rowId ||
        rows[0]?.rowId || null
      );
    }

    // ── Loop de produtos ──────────────────────────────────────────────────────
    const CAT_MASC = new Set(["MLB1003", "MLB1273", "MLB1004", "MLB1280"]);

    for (const p of produtos) {
      if (!p.title || !p.price || !p.pictures?.length || !p.cor || !p.tamanho || !p.sexo || !p.marca) {
        results.push({ erro: true, titulo: p.title || "Sem titulo", detalhe: { message: "Campos obrigatorios ausentes", cause: [] } });
        continue;
      }

      try {
        const pictures = p.pictures
          .filter(u => typeof u === "string" && u.startsWith("http"))
          .map(u => ({ source: u }));

        const catId  = p.category_id || "MLB108704";

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

        // Buscar/criar chart e adicionar SIZE_GRID_ID + SIZE_GRID_ROW_ID
        try {
          const domainFull = await getDomainId(catId);
          if (domainFull) {
            const chart = await getOrCreateChart(domainFull, p.sexo);
            if (chart?.gridId) {
              add("SIZE_GRID_ID", chart.gridId);
              const rowId = findRowId(chart.rows, p.tamanho);
              if (rowId) add("SIZE_GRID_ROW_ID", rowId);
              console.log(`[item] SIZE_GRID_ID=${chart.gridId} ROW_ID=${rowId}`);
            } else {
              console.log(`[item] AVISO: chart nao obtido, publicando sem SIZE_GRID_ID`);
            }
          }
        } catch(e) {
          console.log(`[item] erro ao obter chart:`, e.message);
        }

        const shipping = { mode: "me2", free_shipping: p.frete_gratis === true };
        const dimW = Number(p.largura_cm);
        const dimH = Number(p.altura_cm);
        const dimL = Number(p.profundidade_cm);
        if (dimW >= 20 && dimH >= 20 && dimL >= 20) {
          shipping.dimensions = {
            width:  { value: dimW, unit: "cm" },
            height: { value: dimH, unit: "cm" },
            length: { value: dimL, unit: "cm" }
          };
        }

        const mlBody = {
          family_name:        p.title,
          category_id:        catId,
          price:              Number(p.price),
          currency_id:        "BRL",
          available_quantity: Number(p.quantidade) > 0 ? Number(p.quantidade) : 10,
          buying_mode:        "buy_it_now",
          listing_type_id:    p.listing_type || "gold_special",
          condition:          p.condition    || "new",
          pictures,
          shipping,
          attributes,
          ...(p.garantia ? { warranty: p.garantia }               : {}),
          ...(p.sku      ? { seller_custom_field: String(p.sku) }  : {})
        };

        console.log("[item] BODY:", JSON.stringify(mlBody));

        const mlRes = await fetch("https://api.mercadolibre.com/items", {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${tk}`,
            "Content-Type":  "application/json",
            "Accept":        "application/json"
          },
          body: JSON.stringify(mlBody)
        });

        const mlText = await mlRes.text();
        console.log("[item] STATUS:", mlRes.status, "RESP:", mlText);

        let mlData = {};
        try { mlData = JSON.parse(mlText); } catch(e) {
          mlData = { message: "Resposta nao-JSON: " + mlText, cause: [] };
        }

        if (!mlRes.ok || mlData.error) {
          results.push({
            erro:    true,
            titulo:  p.title,
            detalhe: { http_status: mlRes.status, ...mlData, cause: mlData.cause || [] }
          });
          continue;
        }

        if (p.descricao?.trim()) {
          await fetch(`https://api.mercadolibre.com/items/${mlData.id}/description`, {
            method:  "POST",
            headers: { "Authorization": `Bearer ${tk}`, "Content-Type": "application/json" },
            body:    JSON.stringify({ plain_text: p.descricao })
          }).catch(() => {});
        }

        results.push({ sucesso: true, titulo: p.title, id: mlData.id, link: mlData.permalink });

      } catch (err) {
        results.push({ erro: true, titulo: p.title, detalhe: { message: err.toString(), cause: [] } });
      }
    }

    return res.json(results);

  } catch (err) {
    return res.status(500).json({ erro: true, detalhe: { message: err.toString() } });
  }
}
