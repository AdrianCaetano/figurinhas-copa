const checkoutForm = document.querySelector('#checkoutForm');
const generateBtn = document.querySelector('#generateBtn');
const formStep = document.querySelector('#formStep');
const pixStep = document.querySelector('#pixStep');
const qrImage = document.querySelector('#qrImage');
const copyPaste = document.querySelector('#copyPaste');
const amount = document.querySelector('#amount');
const copyBtn = document.querySelector('#copyBtn');
const ticketLink = document.querySelector('#ticketLink');
const paymentStatus = document.querySelector('#paymentStatus');
const progressText = document.querySelector('#progressText');
const toast = document.querySelector('#toast');

let orderId = null;
let pollTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

function setLoading(isLoading) {
  generateBtn.disabled = isLoading;
  generateBtn.textContent = isLoading ? 'Gerando Pix...' : 'Gerar QR Code Pix';
}

function setPixStatus(status, emailSent) {
  paymentStatus.classList.remove('pending', 'approved', 'error');

  if (status === 'approved') {
    paymentStatus.classList.add('approved');
    paymentStatus.textContent = emailSent ? 'Pagamento aprovado e e-mail enviado' : 'Pagamento aprovado';
    progressText.textContent = emailSent
      ? 'Pronto! O link do Drive foi enviado para o e-mail informado.'
      : 'Pagamento confirmado. O envio do e-mail está sendo processado.';
    return;
  }

  if (['cancelled', 'rejected', 'refunded', 'charged_back'].includes(status)) {
    paymentStatus.classList.add('error');
    paymentStatus.textContent = 'Pagamento não aprovado';
    progressText.textContent = 'Esse pagamento não foi aprovado. Gere um novo Pix para tentar novamente.';
    return;
  }

  paymentStatus.classList.add('pending');
  paymentStatus.textContent = 'Aguardando pagamento';
  progressText.textContent = 'Estou verificando a confirmação do pagamento automaticamente.';
}

async function createPayment(email) {
  const response = await fetch('/api/create-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível gerar o Pix.');
  }

  return data;
}

async function checkOrderStatus() {
  if (!orderId) return;

  try {
    const response = await fetch(`/api/order/${orderId}`);
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Erro ao consultar pagamento.');

    setPixStatus(data.status, data.emailSent);

    if (data.status === 'approved' && data.emailSent) {
      clearInterval(pollTimer);
      pollTimer = null;
      showToast('Pagamento aprovado! Link enviado por e-mail.');
    }
  } catch (error) {
    console.error(error);
  }
}

checkoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = new FormData(checkoutForm).get('email');

  try {
    setLoading(true);
    const data = await createPayment(email);

    orderId = data.orderId;
    qrImage.src = `data:image/png;base64,${data.qrCodeBase64}`;
    copyPaste.value = data.qrCode || '';
    amount.textContent = data.formattedAmount || 'R$ 0,00';

    if (data.ticketUrl) {
      ticketLink.href = data.ticketUrl;
      ticketLink.style.display = 'inline-flex';
    } else {
      ticketLink.style.display = 'none';
    }

    formStep.classList.remove('active');
    pixStep.classList.add('active');
    setPixStatus(data.status, false);
    showToast('Pix gerado com sucesso.');

    clearInterval(pollTimer);
    pollTimer = setInterval(checkOrderStatus, 5000);
    setTimeout(checkOrderStatus, 1500);
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading(false);
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(copyPaste.value);
    showToast('Código Pix copiado.');
  } catch {
    copyPaste.select();
    document.execCommand('copy');
    showToast('Código Pix copiado.');
  }
});
