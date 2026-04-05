// ── TRADUÇÃO DE ERROS ML → PORTUGUÊS ────────────────────────────────────────
const TRADUCOES = {
  "family_name": "O campo 'family_name' é obrigatório na raiz do body quando se usa variations",
  "price": "Preço ausente dentro de variations",
  "available_quantity": "Quantidade em estoque ausente dentro de variations",
  "attribute_combinations": "Combinações de atributos (cor/tamanho) ausentes em variations",
  "title": "Título do anúncio é obrigatório",
  "category_id": "Categoria é obrigatória",
  "pictures": "Pelo menos uma imagem é obrigatória",
  "listing_type_id": "Tipo de anúncio inválido",
  "condition": "Condição do produto inválida",
  "COLOR": "Atributo COR obrigatório e não informado",
  "SIZE": "Atributo TAMANHO obrigatório e não informado",
  "BRAND": "Atributo MARCA obrigatório e não informado",
  "GENDER": "Atributo GÊNERO obrigatório e não informado",
  "The body does not contains some or none of the following properties": "O body não contém um ou mais campos obrigatórios",
  "The field variations is invalid with family name": "O campo 'variations' está inválido — 'family_name' é obrigatório",
  "item variation with errors": "Variação do item com erros",
  "invalid_body": "Body da requisição inválido",
  "missing_field": "Campo obrigatório ausente",
  "required_field": "Campo obrigatório ausente",
  "invalid_field": "Campo com valor inválido"
};

function traduzirErro(texto) {
  if (!texto) return texto;
  for (const [en, pt] of Object.entries(TRADUCOES)) {
    if (texto.includes(en)) return pt;
  }
  return texto;
}

function traduzirCause(cause) {
  if (!Array.isArray(cause)) return [];
  return cause.map(c => ({
    ...c,
    message_pt: traduzirErro(c.message || c.code || JSON.stringify(c))
  }));
}

// ────────────────────────────────────────────────────────────────────────────

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

        // ── PICTURES ──────────────────────────────────────────────────────
        const pictures = p.pictures
          .filter(url => url && url.startsWith("http"))
          .map(url => ({ source: url }));

        // ── ATTRIBUTES FIXOS (não variam por SKU) ─────────────────────────
        const attributes = [];
        const add = (id, val, vid) => {
          if (!val) return;
          const obj = { id, value_name: String(val) };
          if (vid) obj.value_id = vid;
          attributes.push(obj);
        };

        add("BRAND",  p.marca);
        add("GENDER", p.sexo);
        add("MODEL",  p.modelo);

        // Extras dinâmicos do frontend
        if (Array.isArray(p.extra_attributes)) {
          for (const ea of p.extra_attributes) {
            if (ea.id && ea.value_name) {
              const obj = { id: ea.id, value_name: String(ea.value_name) };
              if (ea.value_id) obj.value_id = ea.value_id;
              attributes.push(obj);
            }
          }
        }

        // ── SHIPPING ──────────────────────────────────────────────────────
        const shipping = {
          mode: "me2",
          free_shipping: p.frete_gratis === true || p.frete_gratis === "true"
        };

        if (p.peso_kg && p.largura_cm && p.altura_cm && p.profundidade_cm) {
          shipping.dimensions = {
            width:  { value: Number(p.largura_cm),      unit: "cm" },
            height: { value: Number(p.altura_cm),       unit: "cm" },
            length: { value: Number(p.profundidade_cm), unit: "cm" }
          };
        }

        // ── BODY FINAL ────────────────────────────────────────────────────
        // Categorias como Vestidos EXIGEM variations.
        // Quando variations é usado:
        //   • family_name  → OBRIGATÓRIO na RAIZ do body
        //   • price        → DENTRO de cada variation
        //   • available_quantity → DENTRO de cada variation
        //   • COLOR e SIZE → dentro de attribute_combinations de cada variation

        const body = {
          title:             p.title,
          category_id:       p.category_id,
          currency_id:       "BRL",
          buying_mode:       "buy_it_now",
          listing_type_id:   p.listing_type || "gold_special",
          condition:         p.condition    || "new",
          warranty:          p.garantia     || "Sem garantia",
          pictures,
          shipping,
          attributes,

          // ✅ family_name OBRIGATÓRIO na raiz quando há variations
          family_name: p.title.substring(0, 60),

          // ✅ variations com price e qty DENTRO
          variations: [
            {
              attribute_combinations: [
                { id: "COLOR", value_name: p.cor     },
                { id: "SIZE",  value_name: p.tamanho }
              ],
              price:              Number(p.price),
              available_quantity: Number(p.quantidade || 10),
              ...(p.sku ? { seller_custom_field: p.sku } : {})
            }
          ]
        };

        // ── LOG COMPLETO PARA DEBUG ────────────────────────────────────────
        console.log("── BODY ENVIADO ──");
        console.log(JSON.stringify(body, null, 2));

        // ── CRIAR ITEM ────────────────────────────────────────────────────
        const response = await fetch("https://api.mercadolibre.com/items", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type":  "application/json"
          },
          body: JSON.stringify(body)
        });

        const data = await response.json();
        console.log("── RESPOSTA ML ──");
        console.log(JSON.stringify(data, null, 2));

        if (!response.ok || data.error) {
          results.push({
            erro:    true,
            produto: p.title,
            status:  response.status,
            detalhe: {
              ...data,
              // Traduzir cause para o frontend mostrar em português
              cause_pt: traduzirCause(data.cause)
            }
          });
          continue;
        }

        // ── DESCRIÇÃO (endpoint separado) ─────────────────────────────────
        if (p.description && p.description.trim()) {
          await fetch(`https://api.mercadolibre.com/items/${data.id}/description`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ plain_text: p.description })
          }).catch(e => console.warn("Descrição não salva:", e));
        }

        results.push({
          sucesso: true,
          produto: p.title,
          id:      data.id,
          link:    data.permalink
        });

      } catch (err) {
        results.push({ erro: true, produto: p.title, detalhe: { message: err.toString() } });
      }
    }

    return res.json(results);

  } catch (err) {
    return res.status(500).json({ erro: true, detalhe: { message: err.toString() } });
  }
}
