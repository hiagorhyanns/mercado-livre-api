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
    const chartCache = {};
    const debugLog = []; // visível na resposta do browser

    const TAMANHOS = ["PP","P","M","G","GG","XGG","34","36","38","40","42","44","46","48","Único"];

    async function obterOuCriarChart(domainId, genero) {
      const key = `${domainId}|${genero}`;
      if (chartCache[key]) return chartCache[key];

      // 1. Buscar chart existente
      try {
        const r = await fetch("https://api.mercadolibre.com/catalog/charts/search", {
          method: "POST",
          headers: { "Authorization": `Bearer ${tk}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            site_id:    "MLB",
            domain_id:  domainId,
            attributes: [{ id: "GENDER", values: [{ name: genero }] }]
          })
        });
        const d = await r.json();
        debugLog.push({ step: "chart_search", status: r.status, domain: domainId, genero, resp: d });
        const list = Array.isArray(d) ? d : (d.results || d.charts || []);
        if (list.length && list[0].id) {
          chartCache[key] = String(list[0].id);
          return chartCache[key];
        }
      } catch(e) {
        debugLog.push({ step: "chart_search_error", domain: domainId, genero, err: e.message });
      }

      // 2. Criar nova tabela
      try {
        const chartBody = {
          names:       { MLB: `Guia de Tamanhos ${genero}` },
          domain_id:   domainId,
          site_id:     "MLB",
          attributes:  [{ id: "GENDER", values: [{ name: genero }] }],
          main_attribute: { attributes: [{ site_id: "MLB", id: "SIZE" }] },
          rows: TAMANHOS.map(t => ({ attributes: [{ id: "SIZE", values: [{ name: t }] }] }))
        };
        const cr = await fetch("https://api.mercadolibre.com/catalog/charts", {
          method:  "POST",
          headers: { "Authorization": `Bearer ${tk}`, "Content-Type": "application/json" },
          body:    JSON.stringify(chartBody)
        });
        const cd = await cr.json();
        debugLog.push({ step: "chart_create", status: cr.status, domain: domainId, genero, resp: cd });
        if (cd.id) {
          chartCache[key] = String(cd.id);
          return chartCache[key];
        }
      } catch(e) {
        debugLog.push({ step: "chart_create_error", domain: domainId, genero, err: e.message });
      }

      return null;
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

        const catId  = p.category_id || "MLB108704";
        const ehMasc = CAT_MASC.has(catId) || (p.sexo || "").toLowerCase().includes("masculin");
        const genero = ehMasc ? "Masculino" : "Feminino";

        // Pegar domain_id da categoria
        let domainId = null;
        try {
          const catRes  = await fetch(`https://api.mercadolibre.com/categories/${catId}`, {
            headers: { "Authorization": `Bearer ${tk}` }
          });
          const catData = await catRes.json();
          domainId = catData?.domain_id;
          debugLog.push({ step: "category", catId, domainId });
        } catch(e) {
          debugLog.push({ step: "category_error", catId, err: e.message });
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

        if (domainId) {
          const gridId = await obterOuCriarChart(domainId, genero);
          debugLog.push({ step: "grid_result", domainId, genero, gridId });
          if (gridId) add("SIZE_GRID_ID", gridId);
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
        let mlData = {};
        try { mlData = JSON.parse(mlText); } catch(e) {
          mlData = { message: "Resposta nao-JSON: " + mlText, cause: [] };
        }

        if (!mlRes.ok || mlData.error) {
          results.push({
            erro:    true,
            titulo:  p.title,
            detalhe: { http_status: mlRes.status, ...mlData, cause: mlData.cause || [] },
            _debug:  debugLog   // ← visível no console do browser
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
        results.push({ erro: true, titulo: p.title, detalhe: { message: err.toString(), cause: [] }, _debug: debugLog });
      }
    }

    return res.json(results);

  } catch (err) {
    return res.status(500).json({ erro: true, detalhe: { message: err.toString() } });
  }
}
