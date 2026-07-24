const port = process.argv[2] ?? '9337';
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

let targets;
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    if (targets.length > 0) {
      break;
    }
  } catch {
    // O Electron pode ainda estar inicializando a porta de depuração.
  }
  await delay(250);
}

const target = targets?.find(
  (candidate) => candidate.type === 'page' && candidate.url.includes('presence.html'),
);
if (target === undefined) {
  throw new Error('Renderer do professor não encontrado no CDP');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const exceptions = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error === undefined) {
      handler?.resolve(message.result);
    } else {
      handler?.reject(new Error(message.error.message));
    }
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params.exceptionDetails.text);
  }
});

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await call('Runtime.enable');
const before = await evaluate(`(() => ({
  readyState: document.readyState,
  loginHidden: document.getElementById('login-view')?.hidden,
  onlineHidden: document.getElementById('online-view')?.hidden,
  apiAvailable: typeof window.professorConnectPresence?.connect === 'function'
}))()`);

await evaluate(`(() => {
  const input = document.getElementById('professor-name');
  const form = document.getElementById('login-form');
  input.value = 'Professor Teste';
  form.requestSubmit();
  return true;
})()`);
await delay(1_000);

const after = await evaluate(`(() => ({
  loginHidden: document.getElementById('login-view')?.hidden,
  onlineHidden: document.getElementById('online-view')?.hidden,
  professorName: document.getElementById('professor-display-name')?.textContent,
  loginError: document.getElementById('login-error')?.textContent,
  loginErrorHidden: document.getElementById('login-error')?.hidden
}))()`);

socket.close();
console.info(JSON.stringify({ before, after, exceptions }));

if (
  before.readyState !== 'complete' ||
  before.apiAvailable !== true ||
  before.loginHidden !== false ||
  after.loginHidden !== true ||
  after.onlineHidden !== false ||
  after.professorName !== 'Professor Teste' ||
  exceptions.length > 0
) {
  process.exitCode = 1;
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new Error(response.exceptionDetails.text);
  }
  return response.result.value;
}
