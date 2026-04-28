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

    // Cache de { gridId, rows: [{size, rowId}] } por chave "domainId|generoId"
    const chartCache = {};

    // Gêneros reconhecidos pelo ML Brasil
    // GET /catalog_domains/MLB-DRESSES/attributes/GENDER para ver os valores
    const GENDER_MAP = {
      feminino: { value_id: "339665", value_name: "Mulher"  },
      masculino: { value_id: "339666", value_name: "Homem"   },
    };

    // Tamanhos padrão — serão filtrados pela ficha técnica do domínio
    const TAMANHOS_BASE = [
      "3XS","2XS","XS","PP","P","M","G","GG","XG","XGG","2XG","3XG",
      "34","36","38","40","42","44","46","48","50","52","54",
      "Único","U"
    ];

    async function criarOuBuscarChart(domainIdFull, generoKey) {
      // domainIdFull ex: "MLB-DRESSES"
      // Para as chamadas de chart: sem prefixo do site → "DRESSES"
      const domainSemSite = domainIdFull.replace(/^[A-Z]+-/, "");
      const cacheKey = `${domainSemSite}|${generoKey}`;

      if (chartCache[cacheKey]) return chartCache[cacheKey];

      const genderInfo = GENDER_MAP[generoKey] || GENDER_MAP.feminino;

      // ── 1. Buscar chart existente do vendedor ─────────────────────────────
      try {
        const sr = await fetch("https://api.mercadolibre.com/catalog/charts/search", {
          method: "POST",
          headers: { "Authorization": `Bearer ${tk}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            site_id:   "MLB",
            type:      "SPECIFIC",
            domain_id: domainSemSite,
            attributes: [{ id: "GENDER", value_id: genderInfo.value_id }]
          })
        });
        const sd = await sr.json();
        console.log(`[chart][search] domain=${domainSemSite} status=${sr.status}`, JSON.stringify(sd).substring(0, 400));
        const list = Array.isArray(sd) ? sd : (sd.results || sd.charts || []);
        if (list.length && list[0].id) {
          // Buscar rows desse chart existente
          const existingId = String(list[0].id);
          const rows = await buscarRows(existingId);
          chartCache[cacheKey] = { gridId: existingId, rows };
          return chartCache[cacheKey];
        }
      } catch(e) {
        console.log(`[chart][search] erro:`, e.message);
      }

      // ── 2. Buscar ficha técnica do domínio para saber o formato ───────────
      let specRows = null;
      try {
        const specRes = await fetch(
          `https://api.mercadolibre.com/domains/${domainIdFull}/technical_specs?section=grids`,
          { headers: { "Authorization": `Bearer ${tk}` } }
        );
        const specData = await specRes.json();
        console.log(`[spec] domain=${domainIdFull} status=${specRes.status}`, JSON.stringify(specData).substring(0, 600));
        // Extrair atributos de row que o domínio aceita
        specRows = specData;
      } catch(e) {
        console.log(`[spec] erro:`, e.message);
      }

      // ── 3. Criar chart SPECIFIC ───────────────────────────────────────────
      try {
        // Montar rows com tamanhos padrão — formato mínimo aceito
        const rowsBody = TAMANHOS_BASE.map(t => ({
          attributes: [
            { id: "SIZE",       value_name: t },
            { id: "GENDER",     value_id: genderInfo.value_id, value_name: genderInfo.value_name }
          ]
        }));

        const chartBody = {
          type:      "SPECIFIC",
          site_id:   "MLB",
          domain_id: domainSemSite,
          names:     { MLB: `Guia de Tamanhos ${genderInfo.value_name}` },
          main_attribute: {
            attributes: [{ site_id: "MLB", id: "SIZE" }]
          },
          attributes: [
            { id: "GENDER", value_id: genderInfo.value_id, value_name: genderInfo.value_name }
          ],
          rows: rowsBody
        };

        const cr = await fetch("https://api.mercadolibre.com/catalog/charts", {
          method:  "POST",
          headers: { "Authorization": `Bearer ${tk}`, "Content-Type": "application/json" },
          body:    JSON.stringify(chartBody)
        });
        const cd = await cr.json();
        console.log(`[chart][create] domain=${domainSemSite} status=${cr.status}`, JSON.stringify(cd).substring(0, 600));

        if (cd.id) {
          const rows = await buscarRows(String(cd.id));
          chartCache[cacheKey] = { gridId: String(cd.id), rows };
          return chartCache[cacheKey];
        }
      } catch(e) {
        console.log(`[chart][create] erro:`, e.message);
      }

      return null;
    }

    // Busca as rows de um chart e retorna [{size, rowId}]
    async function buscarRows(chartId) {
      try {
        const rr = await fetch(`https://api.mercadolibre.com/catalog/charts/${chartId}`, {
          headers: { "Authorization": `Bearer ${tk}` }
        });
        const rd = await rr.json();
        console.log(`[chart][rows] id=${chartId} status=${rr.status}`, JSON.stringify(rd).substring(0, 400));
        const rows = rd.rows || [];
        return rows.map(row => {
          const sizeAttr = (row.local_attributes || row.attributes || [])
            .find(a => a.id === "SIZE");
          return {
            size:  sizeAttr?.value_name || "",
            rowId: String(row.id)
          };
        });
      } catch(e) {
        console.log(`[chart][rows] erro:`, e.message);
        return [];
      }
    }

    // Encontra o rowId mais próximo do tamanho do produto
    function encontrarRowId(rows, tamanho) {
      if (!rows || !rows.length) return null;
      const t = String(tamanho).trim().toUpperCase();
      // Busca exata
      let match = rows.find(r => r.size.toUpperCase() === t);
      if (match) return match.rowId;
      // Busca parcial
      match = rows.find(r => r.size.toUpperCase().includes(t) || t.includes(r.size.toUpperCase()));
      if (match) return match.rowId;
      // Fallback: primeira row
      return rows[0]?.rowId || null;
    }

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

        const catId   = p.category_id || "MLB108704";
        const ehMasc  = CAT_MASC.has(catId) || (p.sexo || "").toLowerCase().includes("masculin");
        const genKey  = ehMasc ? "masculino" : "feminino";

        // Buscar domain_id da categoria
        let domainIdFull = null;
        try {
          const catRes  = await fetch(`https://api.mercadolibre.com/categories/${catId}`, {
            headers: { "Authorization": `Bearer ${tk}` }
          });
          const catData = await catRes.json();
          domainIdFull  = catData?.domain_id; // ex: "MLB-DRESSES"
          console.log(`[cat] ${catId} → ${domainIdFull}`);
        } catch(e) {
          console.log(`[cat] erro:`, e.message);
        }

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
        if (domainIdFull) {
          const chart = await criarOuBuscarChart(domainIdFull, genKey);
          if (chart?.gridId) {
            add("SIZE_GRID_ID", chart.gridId);
            const rowId = encontrarRowId(chart.rows, p.tamanho);
            if (rowId) add("SIZE_GRID_ROW_ID", rowId);
            console.log(`[item] SIZE_GRID_ID=${chart.gridId} SIZE_GRID_ROW_ID=${rowId}`);
          }
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
