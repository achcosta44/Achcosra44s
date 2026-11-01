// Teste ponta a ponta do app em arquivo único (dist/consultorio.html), sem internet, em celular simulado:
// cadastro, prontuário, anexo, agenda (conflito), pagamento, persistência, Excel, cópia de segurança e restauração.
// Requer Playwright com Chromium: npm i -D playwright && npx playwright install chromium
// (em ambientes que já têm o Playwright instalado globalmente, basta rodar).
const path = require('path');
const fs = require('fs');
const os = require('os');
const RAIZ = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'consultorio-teste-'));
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  let pedidosRede = 0;
  await ctx.route(/^https?:/, r => { pedidosRede++; r.abort(); });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && erros.push('console: ' + m.text()));
  p.on('dialog', d => d.accept());
  const url = 'file://' + path.join(RAIZ, 'dist', 'consultorio.html');
  const salvar = async () => { await p.click('#dialogo-salvar'); await p.waitForTimeout(400); };
  await p.goto(url + '#/pacientes'); await p.waitForSelector('#novo');
  await p.click('#novo'); await p.fill('#f-nome', 'Ana Celular'); await p.fill('#f-cpf', '111.222.333-44'); await p.fill('#f-valor_sessao', '180,00'); await salvar();
  await p.waitForSelector('#abas'); const pid = p.url().split('/').pop(); console.log('paciente', pid);
  await p.click('[data-aba=prontuario]'); await p.waitForSelector('#nova');
  await p.click('#nova'); await p.fill('#f-texto', 'Evolução feita no celular.'); await salvar();
  await p.waitForSelector('.evolucao');
  await p.click('#anexar'); await p.setInputFiles('#f-arquivo', { name: 'exame.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 teste') }); await salvar();
  await p.waitForSelector('[data-anexo]');
  const [dlA] = await Promise.all([p.waitForEvent('download'), p.click('[data-anexo]')]);
  console.log('anexo baixado:', dlA.suggestedFilename());
  await p.screenshot({ path: path.join(TMP, 'cel-prontuario.png'), fullPage: true });
  await p.goto(url + '#/agenda'); await p.waitForSelector('.dia');
  await p.click('#novo'); await p.selectOption('#f-paciente_id', pid); await p.fill('#f-inicio', '2026-11-02T09:00'); await p.fill('#f-repetir_semanas', '4'); await salvar();
  await p.click('#novo'); await p.selectOption('#f-paciente_id', pid); await p.fill('#f-inicio', '2026-11-02T09:20'); await salvar(); // conflito -> confirm aceito
  await p.goto(url + '#/financeiro'); await p.waitForSelector('#novo');
  await p.click('#novo'); await p.fill('#f-valor', '180'); await salvar();
  await p.screenshot({ path: path.join(TMP, 'cel-financeiro.png'), fullPage: true });
  // recarregar: dados persistem?
  await p.reload(); await p.goto(url + '#/pacientes'); await p.waitForSelector('#lista table');
  console.log('após recarregar:', (await p.textContent('#lista')).includes('Ana Celular'));
  await p.goto(url + '#/agenda'); await p.waitForSelector('.dia'); await p.screenshot({ path: path.join(TMP, 'cel-agenda.png'), fullPage: true });
  // Excel
  await p.goto(url + '#/excel'); await p.waitForSelector('#exportar');
  const [dlX] = await Promise.all([p.waitForEvent('download'), p.click('#exportar')]); await dlX.saveAs(path.join(TMP, 'export.xlsx')); console.log('excel ok');
  await p.setInputFiles('#arquivo', path.join(TMP, 'export.xlsx')); await p.waitForSelector('#confirmar'); await p.click('#confirmar'); await p.waitForTimeout(1500);
  console.log('import:', (await p.textContent('#previa')).trim().slice(0, 80));
  // backup
  const [dlB] = await Promise.all([p.waitForEvent('download'), p.click('#backup')]); await dlB.saveAs(path.join(TMP, 'backup.json'));
  const bk = JSON.parse(require('fs').readFileSync(path.join(TMP, 'backup.json')));
  console.log('backup:', Object.fromEntries(Object.entries(bk.dados).map(([k, v]) => [k, v.length])), 'anexo b64:', !!bk.dados.anexos[0].conteudo_base64);
  await p.screenshot({ path: path.join(TMP, 'cel-excel.png'), fullPage: true });
  // apagar tudo e restaurar
  const ctx2 = await b.newContext({ ...devices['iPhone 14'], acceptDownloads: true });
  await ctx2.route(/^https?:/, r => { pedidosRede++; r.abort(); });
  const p2 = await ctx2.newPage(); p2.on('dialog', d => d.accept()); p2.on('pageerror', e => erros.push('p2: ' + e.message));
  await p2.goto(url + '#/excel'); await p2.waitForSelector('#restaurar', { state: 'attached' });
  await p2.setInputFiles('#restaurar', path.join(TMP, 'backup.json')); await p2.waitForTimeout(1500); await p2.screenshot({ path: path.join(TMP, 'cel-iphone.png') });
  await p2.goto(url + '#/paciente/' + pid); await p2.click('[data-aba=prontuario]'); await p2.waitForSelector('[data-anexo]');
  const [dlR] = await Promise.all([p2.waitForEvent('download'), p2.click('[data-anexo]')]);
  console.log('após restaurar, anexo:', require('fs').readFileSync(await dlR.path(), 'utf8'));
  console.log('pedidos de rede:', pedidosRede, '| erros:', erros.length ? erros : 'nenhum');
  if (pedidosRede || erros.length) process.exitCode = 1;
  await b.close();
})();
