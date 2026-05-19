const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const app = express();

const ADMIN_USER = "wsmarkettrading_admin";
const ADMIN_PASS = "Rafa415263@";

const SITE_URL = "https://wsmarkettrading-site-1.onrender.com";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

const preference = new Preference(client);
const payment = new Payment(client);

function protegerAdmin(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth) {
    res.setHeader("WWW-Authenticate", "Basic");
    return res.status(401).send("Acesso restrito");
  }

  const base64 = auth.split(" ")[1];
  const [usuario, senha] = Buffer.from(base64, "base64").toString().split(":");

  if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
    return next();
  }

  res.setHeader("WWW-Authenticate", "Basic");
  return res.status(401).send("Usuário ou senha inválidos");
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("/var/data/database.db");

// CRIAR TABELA
db.run(`
CREATE TABLE IF NOT EXISTS licencas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  contato TEXT,
  mt5_id TEXT,
  status TEXT
)
`);

// SALVAR LICENÇA MANUAL / ANTIGA
app.post("/adquirir", (req, res) => {

  const { nome, contato, mt5_id } = req.body;

  db.run(
    `
    INSERT INTO licencas (nome, contato, mt5_id, status)
    VALUES (?, ?, ?, ?)
    `,
    [nome, contato, mt5_id, "pendente"],
    function(err){

      if(err){
        return res.status(500).json({
          erro: err.message
        });
      }

      res.json({
        sucesso: true
      });

    }
  );

});

// GERAR PAGAMENTO MERCADO PAGO
app.post("/buy", async (req, res) => {

  const { nome, contato, mt5_id } = req.body;

  if (!nome || !contato || !mt5_id) {
    return res.status(400).json({
      erro: "Nome, contato e MT5 ID são obrigatórios."
    });
  }

  try {

    db.run(
      `
      INSERT INTO licencas (nome, contato, mt5_id, status)
      VALUES (?, ?, ?, ?)
      `,
      [nome, contato, mt5_id, "pendente"],
      async function(err){

        if(err){
          return res.status(500).json({
            erro: err.message
          });
        }

        const body = {
          items: [
            {
              title: "Licença WealthScope Market Trading",
              quantity: 1,
              currency_id: "BRL",
              unit_price: 1
            }
          ],

          external_reference: mt5_id,

          notification_url: `${SITE_URL}/webhook`,

          back_urls: {
            success: `${SITE_URL}/success`,
            failure: `${SITE_URL}/failure`,
            pending: `${SITE_URL}/pending`
          },

          auto_return: "approved"
        };

        const resposta = await preference.create({ body });

        res.json({
          sucesso: true,
          link: resposta.init_point
        });

      }
    );

  } catch(err) {

    console.log(err);

    res.status(500).json({
      erro: err.message
    });

  }

});

// WEBHOOK MERCADO PAGO
app.post("/webhook", async (req, res) => {

  try {

    const type = req.body.type || req.body.topic;
    const paymentId = req.body?.data?.id || req.query.id;

    if (type === "payment" && paymentId) {

      const pagamento = await payment.get({ id: paymentId });

      if (pagamento.status === "approved") {

        const mt5_id = pagamento.external_reference;

        db.run(
          `
          UPDATE licencas
          SET status = ?
          WHERE mt5_id = ?
          `,
          ["ativo", mt5_id],
          function(err) {
            if (err) {
              console.log("Erro ao ativar licença:", err.message);
            } else {
              console.log("Licença ativada automaticamente:", mt5_id);
            }
          }
        );

      }

    }

    res.sendStatus(200);

  } catch(err) {

    console.log("Erro no webhook:", err.message);
    res.sendStatus(200);

  }

});

// VERIFICAR LICENÇA
app.get("/check", (req, res) => {

  const mt5_id = req.query.id;

  db.get(
    `
    SELECT * FROM licencas
    WHERE mt5_id = ?
    ORDER BY id DESC
    LIMIT 1
    `,
    [mt5_id],
    (err, row) => {

      if(err){
        return res.status(500).json({
          erro: err.message
        });
      }

      if(!row){
        return res.json({
          ativo: false
        });
      }

      res.json({
        ativo: row.status === "ativo"
      });

    }
  );

});

// LISTAR LICENÇAS
app.get("/admin", protegerAdmin, (req, res) => {

  db.all(
    `
    SELECT * FROM licencas
    ORDER BY id DESC
    `,
    [],
    (err, rows) => {

      if (err) {
        return res.send("Erro no banco");
      }

      let html = `
      <html>
      <head>
        <title>Admin</title>
        <style>
          body{
            background:#041535;
            color:white;
            font-family:Arial;
            padding:40px;
          }

          table{
            width:100%;
            border-collapse:collapse;
          }

          th, td{
            border:1px solid white;
            padding:12px;
            text-align:left;
          }

          th{
            background:#08245c;
          }

          a{
            color:white;
            padding:8px 12px;
            text-decoration:none;
            margin-right:6px;
            display:inline-block;
          }

          .ativar{ background:green; }
          .bloquear{ background:#b8860b; }
          .excluir{ background:#b00020; }
        </style>
      </head>
      <body>

      <h1>Licenças</h1>

      <table>
        <tr>
          <th>ID</th>
          <th>Nome</th>
          <th>Contato</th>
          <th>MT5 ID</th>
          <th>Status</th>
          <th>Ações</th>
        </tr>
      `;

      rows.forEach(row => {
        html += `
        <tr>
          <td>${row.id}</td>
          <td>${row.nome}</td>
          <td>${row.contato}</td>
          <td>${row.mt5_id}</td>
          <td>${row.status}</td>
          <td>
            <a class="ativar" href="/admin/ativar/${row.id}">Ativar</a>
            <a class="bloquear" href="/admin/bloquear/${row.id}">Bloquear</a>
            <a class="excluir" href="/admin/excluir/${row.id}" onclick="return confirm('Tem certeza que deseja excluir?')">Excluir</a>
          </td>
        </tr>
        `;
      });

      html += `
      </table>
      </body>
      </html>
      `;

      res.send(html);
    }
  );

});

// ATIVAR LICENÇA
app.get("/admin/ativar/:id", protegerAdmin, (req, res) => {
  db.run(
    `UPDATE licencas SET status = ? WHERE id = ?`,
    ["ativo", req.params.id],
    () => {
      res.redirect("/admin");
    }
  );
});

// BLOQUEAR LICENÇA
app.get("/admin/bloquear/:id", protegerAdmin, (req, res) => {
  db.run(
    `UPDATE licencas SET status = ? WHERE id = ?`,
    ["bloqueado", req.params.id],
    () => {
      res.redirect("/admin");
    }
  );
});

// EXCLUIR LICENÇA
app.get("/admin/excluir/:id", protegerAdmin, (req, res) => {
  db.run(
    `DELETE FROM licencas WHERE id = ?`,
    [req.params.id],
    () => {
      res.redirect("/admin");
    }
  );
});

app.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});