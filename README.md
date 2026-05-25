# Zac Artex Company — Site Pix com entrega automática por e-mail

Projeto completo com:

- site responsivo para PC e Android;
- formulário para o cliente digitar o e-mail;
- geração de QR Code Pix via Mercado Pago;
- consulta automática do status do pagamento;
- webhook do Mercado Pago;
- envio automático do link do Google Drive por e-mail após pagamento aprovado.

## 1. Instalar

```bash
npm install
```

## 2. Configurar variáveis

Copie `.env.example` para `.env`:

```bash
cp .env.example .env
```

No Windows, você pode copiar manualmente ou usar:

```powershell
copy .env.example .env
```

Depois edite o `.env`:

```env
PUBLIC_URL=https://seu-dominio.com
PRODUCT_PRICE=19.90
DRIVE_LINK=https://drive.google.com/seu-link-aqui
MP_ACCESS_TOKEN=TEST-SEU_ACCESS_TOKEN_AQUI
SMTP_USER=seuemail@gmail.com
SMTP_PASS=sua_senha_de_app
```

## 3. Rodar

```bash
npm start
```

Abra:

```text
http://localhost:3000
```

## 4. Webhook Mercado Pago

No painel do Mercado Pago, configure o webhook para:

```text
https://seu-dominio.com/api/webhook/mercadopago
```

Selecione o evento de pagamentos, geralmente chamado de `payment`.

> Observação: webhook não funciona com `localhost`. Para testar localmente, use um túnel como ngrok ou hospede em um servidor com domínio público.

## 5. Gmail/SMTP

Se for usar Gmail, ative a verificação em duas etapas e crie uma senha de app. Use essa senha em `SMTP_PASS`. Não use a senha normal da conta.

## 6. Produção

Antes de vender de verdade:

1. Troque `MP_ACCESS_TOKEN=TEST-...` por sua credencial de produção `APP_USR-...`.
2. Coloque o domínio real em `PUBLIC_URL`.
3. Configure `MP_WEBHOOK_SECRET` com a assinatura secreta do Mercado Pago.
4. Teste um pagamento real de baixo valor.
5. Garanta que o link do Drive está com permissão correta para quem receber.

## Estrutura

```text
zac-artex-pix-site/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── data/
│   └── orders.json
├── .env.example
├── package.json
├── README.md
└── server.js
```
