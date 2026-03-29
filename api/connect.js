return res.status(200).send(`
  <html>
    <head>
      <title>Conectado</title>
      <style>
        body {
          font-family: Arial;
          background: #ededed;
          display:flex;
          justify-content:center;
          align-items:center;
          height:100vh;
        }

        .card {
          background:white;
          padding:30px;
          border-radius:10px;
          box-shadow:0 4px 20px rgba(0,0,0,0.1);
          width:400px;
        }

        h2 {
          margin-bottom:20px;
        }

        .item {
          margin-bottom:10px;
          font-size:14px;
          word-break: break-all;
        }

        .label {
          font-weight:bold;
        }

        button {
          margin-top:20px;
          width:100%;
          padding:12px;
          border:none;
          border-radius:6px;
          background:#3483fa;
          color:white;
          font-weight:bold;
          cursor:pointer;
        }
      </style>
    </head>

    <body>
      <div class="card">
        <h2>Conta conectada</h2>

        <div class="item">
          <span class="label">User ID:</span> ${data.user_id}
        </div>

        <div class="item">
          <span class="label">Access Token:</span><br>
          ${data.access_token}
        </div>

        <div class="item">
          <span class="label">Refresh Token:</span><br>
          ${data.refresh_token}
        </div>

        <button onclick="navigator.clipboard.writeText('${data.access_token}')">
          Copiar Access Token
        </button>
      </div>
    </body>
  </html>
`);
