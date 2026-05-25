require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const PRODUCT_NAME = process.env.PRODUCT_NAME || 'Zac Artex Digital Access';
const PRODUCT_DESCRIPTION = process.env.PRODUCT_DESCRIPTION || 'Acesso digital exclusivo Zac Artex Company';
const PRODUCT_PRICE = Number(process.env.PRODUCT_PRICE || 19.90);
const PIX_EXPIRATION_MINUTES = Number(process.env.PIX_EXPIRATION_MINUTES || 60);
const DRIVE_LINK = process.env.DRIVE_LINK || 'https://drive.google.com/seu-link-aqui';
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';

const dataDir = path.join(__dirname, 'data');
const ordersPath = path.join(dataDir, 'orders.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(ordersPath)) fs.writeFileSync(ordersPath, JSON.stringify([], null, 2));

const mpClient = MP_ACCESS_TOKEN
  ? new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN })
  : null;
const paymentClient = mpClient ? new Payment(mpClient) : null;

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('tiny'));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' }
}));

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  } catch (error) {
    console.error('Erro ao ler orders.json:', error);
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
}

function upsertOrder(order) {
  const orders = readOrders();
  const index = orders.findIndex((item) => item.orderId === order.orderId);
  if (index >= 0) {
    orders[index] = { ...orders[index], ...order, updatedAt: new Date().toISOString() };
  } else {
    orders.push({ ...order, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  writeOrders(orders);
  return index >= 0 ? orders[index] : orders[orders.length - 1];
}

function findOrderByOrderId(orderId) {
  return readOrders().find((order) => order.orderId === orderId);
}

function findOrderByPaymentId(paymentId) {
  return readOrders().find((order) => String(order.paymentId) === String(paymentId));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function moneyBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function buildPaymentExpiration() {
  return new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000).toISOString();
}

function normalizeBoolean(value) {
  return String(value).toLowerCase() === 'true';
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP não configurado. Preencha SMTP_HOST, SMTP_USER e SMTP_PASS no .env.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: normalizeBoolean(process.env.SMTP_SECURE ?? 'true'),
    auth: { user, pass }
  });
}

async function sendDriveEmail(order) {
  if (!DRIVE_LINK || DRIVE_LINK.includes('seu-link-aqui')) {
    throw new Error('DRIVE_LINK não configurado no .env.');
  }

  const transporter = getTransporter();
  const fromName = process.env.FROM_NAME || 'Zac Artex Company';
  const smtpUser = process.env.SMTP_USER;

  await transporter.sendMail({
    from: `"${fromName}" <${smtpUser}>`,
    to: order.email,
    subject: 'Seu acesso Zac Artex Company foi liberado',
    text: `Olá! Seu pagamento foi confirmado. Acesse seu material por este link: ${DRIVE_LINK}`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:32px;color:#141927">
        <div style="max-width:620px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e7eaf3">
          <div style="background:#101522;color:#ffffff;padding:28px">
            <h1 style="margin:0;font-size:26px">Zac Artex Company</h1>
            <p style="margin:8px 0 0;color:#cfd6e6">Entrega digital confirmada</p>
          </div>
          <div style="padding:30px">
            <h2 style="margin-top:0;color:#101522">Pagamento aprovado ✅</h2>
            <p>Obrigado pela compra. Seu acesso ao material já está liberado.</p>
            <p style="margin:28px 0">
              <a href="${DRIVE_LINK}" target="_blank" style="display:inline-block;background:#101522;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:bold">Acessar link do Drive</a>
            </p>
            <p style="font-size:13px;color:#667085">Pedido: ${order.orderId}</p>
          </div>
        </div>
      </div>
    `
  });
}

function getWebhookPaymentId(req) {
  return (
    req.body?.data?.id ||
    req.query?.['data.id'] ||
    req.query?.id ||
    req.body?.id ||
    null
  );
}

function verifyMercadoPagoSignature(req) {
  if (!MP_WEBHOOK_SECRET) return true;

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const dataId = req.query?.['data.id'] || req.body?.data?.id || '';

  if (!xSignature || !xRequestId || !dataId) return false;

  const parts = String(xSignature).split(',');
  let ts = '';
  let hash = '';

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key?.trim() === 'ts') ts = value?.trim();
    if (key?.trim() === 'v1') hash = value?.trim();
  }

  if (!ts || !hash) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const sha = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sha), Buffer.from(hash));
  } catch {
    return false;
  }
}

async function processPaymentUpdate(paymentId) {
  if (!paymentClient) throw new Error('Mercado Pago não configurado.');

  const mpPayment = await paymentClient.get({ id: paymentId });
  const orderId = mpPayment.external_reference || mpPayment.metadata?.order_id;
  const customerEmail = mpPayment.metadata?.customer_email || mpPayment.payer?.email;

  let order = orderId ? findOrderByOrderId(orderId) : findOrderByPaymentId(paymentId);
  if (!order && orderId && customerEmail) {
    order = upsertOrder({
      orderId,
      paymentId: String(mpPayment.id),
      email: customerEmail,
      status: mpPayment.status,
      statusDetail: mpPayment.status_detail,
      emailSent: false
    });
  }

  if (!order) {
    console.warn(`Pagamento ${paymentId} recebido, mas pedido local não encontrado.`);
    return null;
  }

  order = upsertOrder({
    ...order,
    paymentId: String(mpPayment.id),
    status: mpPayment.status,
    statusDetail: mpPayment.status_detail,
    approvedAt: mpPayment.status === 'approved' ? new Date().toISOString() : order.approvedAt
  });

  if (mpPayment.status === 'approved' && !order.emailSent) {
    try {
      await sendDriveEmail(order);
      order = upsertOrder({
        ...order,
        emailSent: true,
        deliveredAt: new Date().toISOString(),
        lastEmailError: null
      });
    } catch (error) {
      console.error('Erro ao enviar e-mail:', error);
      order = upsertOrder({
        ...order,
        emailSent: false,
        lastEmailError: error.message
      });
    }
  }

  return order;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'Zac Artex Company Pix Site' });
});

app.post('/api/create-payment', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Digite um e-mail válido.' });
    }

    if (!paymentClient) {
      return res.status(500).json({ error: 'Mercado Pago não configurado. Preencha MP_ACCESS_TOKEN no .env.' });
    }

    if (!Number.isFinite(PRODUCT_PRICE) || PRODUCT_PRICE <= 0) {
      return res.status(500).json({ error: 'PRODUCT_PRICE inválido no .env.' });
    }

    const orderId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const body = {
      transaction_amount: Number(PRODUCT_PRICE.toFixed(2)),
      description: PRODUCT_DESCRIPTION,
      payment_method_id: 'pix',
      date_of_expiration: buildPaymentExpiration(),
      payer: { email },
      external_reference: orderId,
      metadata: {
        order_id: orderId,
        customer_email: email,
        product_name: PRODUCT_NAME
      }
    };

    if (PUBLIC_URL) {
      body.notification_url = `${PUBLIC_URL}/api/webhook/mercadopago`;
    }

    const mpPayment = await paymentClient.create({
      body,
      requestOptions: { idempotencyKey }
    });

    const transactionData = mpPayment.point_of_interaction?.transaction_data || {};

    const order = upsertOrder({
      orderId,
      paymentId: String(mpPayment.id),
      email,
      productName: PRODUCT_NAME,
      amount: PRODUCT_PRICE,
      status: mpPayment.status,
      statusDetail: mpPayment.status_detail,
      qrCode: transactionData.qr_code,
      qrCodeBase64: transactionData.qr_code_base64,
      ticketUrl: transactionData.ticket_url,
      emailSent: false
    });

    return res.json({
      orderId: order.orderId,
      paymentId: order.paymentId,
      status: order.status,
      amount: order.amount,
      formattedAmount: moneyBRL(order.amount),
      qrCode: order.qrCode,
      qrCodeBase64: order.qrCodeBase64,
      ticketUrl: order.ticketUrl,
      expiresInMinutes: PIX_EXPIRATION_MINUTES
    });
  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    return res.status(500).json({
      error: 'Não foi possível gerar o Pix agora.',
      detail: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

app.get('/api/order/:orderId', async (req, res) => {
  try {
    let order = findOrderByOrderId(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

    if (order.paymentId && order.status !== 'approved' && paymentClient) {
      order = await processPaymentUpdate(order.paymentId) || order;
    }

    return res.json({
      orderId: order.orderId,
      status: order.status,
      statusDetail: order.statusDetail,
      emailSent: Boolean(order.emailSent),
      deliveredAt: order.deliveredAt || null,
      lastEmailError: order.lastEmailError || null
    });
  } catch (error) {
    console.error('Erro ao consultar pedido:', error);
    return res.status(500).json({ error: 'Não foi possível consultar o pedido.' });
  }
});

app.post('/api/webhook/mercadopago', async (req, res) => {
  try {
    if (!verifyMercadoPagoSignature(req)) {
      return res.status(401).json({ error: 'Assinatura do webhook inválida.' });
    }

    const type = req.body?.type || req.query?.type || req.body?.topic || req.query?.topic;
    const paymentId = getWebhookPaymentId(req);

    res.status(200).json({ received: true });

    if ((type === 'payment' || !type) && paymentId) {
      await processPaymentUpdate(paymentId);
    }
  } catch (error) {
    console.error('Erro no webhook Mercado Pago:', error);
    if (!res.headersSent) res.status(200).json({ received: true });
  }
});

app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Zac Artex Company rodando em http://localhost:${PORT}`);
});
