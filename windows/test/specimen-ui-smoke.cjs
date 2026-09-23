// Isolated headless component test; does not touch the user's Electron session.
const { chromium } = require(process.env.NEUROFLY_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const output = process.env.NEUROFLY_TEST_OUTPUT || path.join(root, 'test-artifacts');
(async () => {
  const { createSpecimenStore } = await import(pathToFileURL(path.join(root, 'src/specimen-data.js')));
  const { createSpecimenService } = await import(pathToFileURL(path.join(root, 'src/specimen-service.js')));
  const store = createSpecimenStore();
  const service = createSpecimenService();
  const wanted = process.env.NEUROFLY_TEST_PROFILES?.split(',') || ['banc-v888', 'malecns-v1', 'fafb-v783'];
  assert.ok(wanted.every(id => store.catalog().profiles.some(p => p.id === id && p.status === 'anatomy-ready')), 'requested anatomy packages must be imported');
  const server = http.createServer(async (req, res) => {
    let file;
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/__test/')) {
        let value;
        if (url.pathname === '/__test/catalog') value = await service.catalog();
        else if (url.pathname === '/__test/bundle') value = await service.load(url.searchParams.get('id'));
        else if (url.pathname === '/__test/morphology') value = await service.morphology(url.searchParams.get('id'), url.searchParams.get('profileId'));
        else if (url.pathname === '/__test/cell') value = await service.cell(url.searchParams.get('id'), url.searchParams.get('neuron'), url.searchParams.get('sha'));
        else if (url.pathname === '/__test/path') value = await service.path(url.searchParams.get('id'), JSON.parse(url.searchParams.get('query')), url.searchParams.get('sha'));
        else throw new Error('Unknown test endpoint');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(value));
        return;
      }
      file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) || !/\.(?:js|css|html)$/.test(file)) throw new Error('Not a test resource');
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, page;
  try {
    browser = await chromium.launch({ channel: process.env.NEUROFLY_BROWSER_CHANNEL || 'msedge', headless: true });
    page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error('PAGE ERROR:', e.message); });
    // Multi-megabyte graphs use the local HTTP test transport, not a giant
    // DevTools binding reply competing with the driver's click acknowledgement.
    await page.addInitScript(() => {
      localStorage.setItem('neurofly.lang', 'de');
      const read = async (kind, id = '', args = {}) => {
        const response = await fetch(`/__test/${kind}?${new URLSearchParams({ id, ...args })}`);
        if (!response.ok) throw new Error(`Test transport: ${response.status}`);
        return response.json();
      };
      window.testCatalog = () => read('catalog');
      window.testBundle = id => read('bundle', id);
      window.testMorphology = (id, profileId) => read('morphology', id, { profileId });
      window.testCell = (id, neuron, sha) => read('cell', id, { neuron, sha });
      window.testPath = (id, query, sha) => read('path', id, { query: JSON.stringify(query), sha });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/test/specimen-ui.html`);
    await page.waitForFunction(() => document.querySelector('[data-testid="specimen-status"]')?.textContent.includes('Anatomie geladen'), null, { timeout: 60000 });
    fs.mkdirSync(output, { recursive: true });
    for (const id of wanted) {
      const data = store.load(id);
      await page.getByTestId('choose-' + id).click();
      await page.waitForFunction(name => document.querySelector('[data-testid="specimen-summary"]')?.textContent.includes(name), data.profile.name);
      const target = data.neurons.find(n => n.type === 'DNp01') || data.neurons[0];
      await page.getByTestId('specimen-search').fill(target.id);
      await page.waitForFunction(id => document.querySelector('[data-testid="specimen-neuron"]')?.textContent.includes(id), target.id);
      assert.ok((await page.getByTestId('specimen-neuron').textContent()).includes(data.profile.name));
      await page.getByRole('button', { name: 'Zellbefund exportieren' }).click();
      const report = await page.evaluate(() => JSON.parse(window.lastExport));
      assert.equal(report.neuron.id, target.id);
      assert.equal(report.profile.id, id);
      assert.equal(report.bundleSHA256, data.sha256);
      const edge = data.edges.find(e => e[0] !== e[1]);
      await page.getByTestId('path-from').fill(data.neurons[edge[0]].id);
      await page.getByTestId('path-to').fill(data.neurons[edge[1]].id);
      await page.getByTestId('path-find').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="path-result"]')?.textContent.includes('1 gerichtete Schritte'));
      await page.getByRole('button', { name: 'Pfadbefund exportieren' }).click();
      const pathReport = await page.evaluate(() => JSON.parse(window.lastExport));
      assert.equal(pathReport.profile.id, id);
      assert.equal(pathReport.bundleSHA256, data.sha256);
      assert.equal(pathReport.edges[0].contacts, edge[2]);
      await page.getByTestId('specimen-search').fill('cell-does-not-exist');
      assert.ok((await page.getByTestId('specimen-results').textContent()).includes('Nicht im Ausschnitt'));
      await page.getByTestId('specimen-search').fill('');
      await page.evaluate(() => document.getElementById('fixture').scrollTop = 0);
      await page.screenshot({ path: path.join(output, `specimen-${id}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 850 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow at narrow panel width');
    await page.getByTestId('choose-banc-v888').click();
    await page.getByTestId('choose-malecns-v1').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="specimen-summary"]')?.textContent.includes('MaleCNS'));
    assert.equal(await page.getByTestId('choose-malecns-v1').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.specimenView.dispose());
    assert.deepEqual(errors, []);
    console.log('PASS specimen UI: all profiles, exact IDs, cell exports, missing-cell honesty, rapid switch, narrow layout, screenshots');
  } catch (error) {
    if (page) console.error('UI STATE:', (await page.locator('body').innerText()).slice(0, 5000));
    throw error;
  } finally {
    await browser?.close();
    await service.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
