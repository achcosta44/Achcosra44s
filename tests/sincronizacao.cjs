// Teste ponta a ponta da sincronização: notebook (desktop) + celular (Pixel 7) contra o servidor sync/.
// Antes, em outro terminal: npm run sync:dev   (servidor local em http://localhost:8788)
// ATENÇÃO: cria um cofre no servidor. Com MAX_COFRES=2, limpe o banco local entre execuções:
//   cd sync && npx wrangler d1 execute consultorio-sync --local --command "DELETE FROM mudancas; DELETE FROM cofres;"
// Requer Playwright com Chromium: npm i -D playwright && npx playwright install chromium
// (em ambientes que já têm o Playwright instalado globalmente, basta rodar).
const path = require('path');
const fs = require('fs');
const os = require('os');
const RAIZ = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'consultorio-teste-'));
const { chromium, devices } = require('playwright');
const URL_APP = 'file://' + path.join(RAIZ, 'dist', 'consultorio.html');
const SRV = process.env.SYNC_URL || 'http://localhost:8788';
(async () => {
  const b = await chromium.launch();
  const erros = [];
  const novo = async (opts, nome) => {
    const ctx = await b.newContext({ ...opts, acceptDownloads: true });
    const p = await ctx.newPage(); p.msgs = [];
    p.on('pageerror', e => erros.push(nome + ': ' + e.message));
    p.on('dialog', d => { p.msgs.push(d.message()); d.accept(); });
    return { ctx, p };
  };
  const sync = (p) => p.evaluate(() => window.consultorioBackend.sync.agora());
  const info = (p) => p.evaluate(() => window.consultorioBackend.sync.info());
  const api = (p, m, c, corpo) => p.evaluate(([m, c, corpo]) => window.consultorioBackend.request(m, c, corpo), [m, c, corpo]);

  // ---------- Notebook: dados de teste + ativar
  const A = await novo({ viewport: { width: 1366, height: 860 } }, 'notebook');
  await A.p.goto(URL_APP + '#/excel'); await A.p.waitForSelector('#restaurar', { state: 'attached' });
  await A.p.setInputFiles('#restaurar', path.join(RAIZ, 'exemplos', 'dados-de-teste.json')); await A.p.waitForTimeout(1200);
  await A.p.goto(URL_APP + '#/excel'); await A.p.waitForSelector('#sync-criar');
  await A.p.click('#sync-criar'); await A.p.fill('#f-servidor', SRV); await A.p.fill('#f-senha', 'senha-forte-123'); await A.p.fill('#f-senha2', 'senha-forte-123');
  await A.p.click('#dialogo-salvar'); await A.p.waitForFunction(() => document.querySelector('#sync-agora'), null, { timeout: 30000 });
  const codigo = A.p.msgs.join('\n').match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];
  console.log('cofre criado:', codigo, '|', (await info(A.p)).situacao, 'pendentes', (await info(A.p)).pendentes);
  await A.p.screenshot({ path: path.join(TMP, 's-notebook-sync.png') });

  // ---------- Celular: senha errada, depois certa
  const B = await novo({ ...devices['Pixel 7'] }, 'celular');
  await B.p.goto(URL_APP + '#/excel'); await B.p.waitForSelector('#sync-conectar');
  await B.p.click('#sync-conectar'); await B.p.fill('#f-servidor', SRV); await B.p.fill('#f-codigo', codigo.toLowerCase().replace(/-/g, ' ')); await B.p.fill('#f-senha', 'senha-errada-000');
  await B.p.click('#dialogo-salvar'); await B.p.waitForFunction(() => !document.querySelector('#dialogo-erro').hidden, null, { timeout: 30000 });
  console.log('senha errada ->', await B.p.textContent('#dialogo-erro'));
  await B.p.fill('#f-senha', 'senha-forte-123'); await B.p.click('#dialogo-salvar');
  await B.p.waitForFunction(() => document.querySelector('#sync-agora'), null, { timeout: 60000 });
  const pacB = await api(B.p, 'GET', '/api/pacientes?inativos=1');
  console.log('celular recebeu pacientes:', pacB.length, '| sessões:', (await api(B.p, 'GET', '/api/agendamentos')).length);
  await B.p.goto(URL_APP + '#/agenda'); await B.p.waitForSelector('#chips'); await B.p.waitForTimeout(300);
  await B.p.screenshot({ path: path.join(TMP, 's-celular-agenda.png') });

  // ---------- Celular cria dados; notebook recebe
  const mariana = pacB.find(x => x.nome === 'Mariana Costa');
  await api(B.p, 'POST', `/api/pacientes/${mariana.id}/evolucoes`, { data_atendimento: '2026-11-02', texto: 'Registro feito no celular.' });
  const novoPac = await api(B.p, 'POST', '/api/pacientes', { nome: 'Paciente Criado no Celular', valor_sessao: '100' });
  await B.p.evaluate(async (pid) => { const fd = new FormData(); fd.append('arquivo', new File(['conteudo secreto do laudo'], 'laudo.txt', { type: 'text/plain' })); await window.consultorioBackend.request('POST', `/api/pacientes/${pid}/anexos`, fd); }, mariana.id);
  // notebook cria paciente ao mesmo tempo (ids não podem colidir)
  const pacA = await api(A.p, 'POST', '/api/pacientes', { nome: 'Paciente Criado no Notebook', valor_sessao: '80' });
  await sync(B.p); await sync(A.p); await sync(B.p);
  const nomesA = (await api(A.p, 'GET', '/api/pacientes')).map(x => x.nome);
  const nomesB = (await api(B.p, 'GET', '/api/pacientes')).map(x => x.nome);
  console.log('notebook vê paciente do celular:', nomesA.includes('Paciente Criado no Celular'), '| celular vê do notebook:', nomesB.includes('Paciente Criado no Notebook'), '| ids distintos:', novoPac.id !== pacA.id);
  const evA = await api(A.p, 'GET', `/api/pacientes/${mariana.id}/evolucoes`);
  console.log('notebook vê registro do celular:', evA.some(e => e.texto === 'Registro feito no celular.'));
  const anexosA = await api(A.p, 'GET', `/api/pacientes/${mariana.id}/anexos`);
  const conteudo = await A.p.evaluate(async (id) => (await window.consultorioBackend.baixarAnexo(id)).blob.text(), anexosA[0].id);
  console.log('notebook abre anexo do celular:', conteudo);

  // ---------- Notebook: tela atualiza sozinha ao receber
  await A.p.goto(URL_APP + '#/pacientes'); await A.p.waitForSelector('table');
  await api(B.p, 'POST', '/api/pacientes', { nome: 'Zeca Atualização Automática' }); await sync(B.p);
  await sync(A.p); await A.p.waitForTimeout(500);
  console.log('lista do notebook atualizou sozinha:', (await A.p.textContent('#lista')).includes('Zeca Atualização Automática'));

  // ---------- Conflito: os dois editam o mesmo paciente; vale o último
  await api(A.p, 'PUT', `/api/pacientes/${mariana.id}`, { telefone: '(31) 1111-1111' });
  await B.p.waitForTimeout(20);
  await api(B.p, 'PUT', `/api/pacientes/${mariana.id}`, { telefone: '(31) 2222-2222' });
  await sync(A.p); await sync(B.p); await sync(A.p);
  const telA = (await api(A.p, 'GET', `/api/pacientes/${mariana.id}`)).telefone, telB = (await api(B.p, 'GET', `/api/pacientes/${mariana.id}`)).telefone;
  console.log('conflito resolvido igual nos dois:', telA, telB, telA === telB && telB === '(31) 2222-2222');

  // ---------- Celular sem internet
  await B.ctx.route(new RegExp(SRV.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), r => r.abort());
  await api(B.p, 'POST', '/api/pagamentos', { paciente_id: mariana.id, data: '2026-11-02', valor: '100', forma: 'pix' });
  await sync(B.p);
  const iB = await info(B.p);
  await B.p.goto(URL_APP + '#/agenda'); await B.p.waitForSelector('#chips');
  console.log('offline:', iB.situacao, 'pendentes', iB.pendentes, '| indicador:', await B.p.textContent('#sync-indicador'));
  await B.p.screenshot({ path: path.join(TMP, 's-celular-offline.png') });
  await B.ctx.unroute(new RegExp(SRV.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await sync(B.p); await sync(A.p);
  const pagA = await api(A.p, 'GET', `/api/pagamentos?paciente_id=${mariana.id}&de=2026-11-02&ate=2026-11-02`);
  console.log('após voltar internet, notebook recebeu pagamento:', pagA.length >= 1, '| celular:', (await info(B.p)).situacao, 'pendentes', (await info(B.p)).pendentes);

  // ---------- Igualdade total entre aparelhos
  const resumo = async (p) => { const r = {}; for (const s of ['/api/pacientes?inativos=1', '/api/agendamentos', '/api/pagamentos']) r[s] = (await api(p, 'GET', s)).map(x => JSON.stringify(x)).sort().join('|').length; return r; };
  console.log('notebook == celular:', JSON.stringify(await resumo(A.p)) === JSON.stringify(await resumo(B.p)));
  await A.p.goto(URL_APP + '#/excel'); await A.p.waitForSelector('#sync-agora'); await A.p.screenshot({ path: path.join(TMP, 's-notebook-sync.png'), fullPage: true });
  console.log('erros:', erros.length ? erros : 'nenhum');
  if (erros.length) process.exitCode = 1;
  await b.close();
})().catch(e => { console.error('FALHA:', e.message); process.exit(1); });
