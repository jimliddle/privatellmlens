const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const fixtures = require('./pdf-baseline.json');
const directory = path.join(__dirname, '..', '.test-assets');
const hash = data => createHash('sha256').update(data).digest('hex');
(async () => {
  fs.mkdirSync(directory, { recursive: true });
  for (const fixture of fixtures) {
    const filename = path.join(directory, fixture.name);
    if (fs.existsSync(filename) && hash(fs.readFileSync(filename)) === fixture.fileSha256) continue;
    const response = await fetch(fixture.url);
    if (!response.ok) throw new Error(`PDF fixture download failed: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (hash(data) !== fixture.fileSha256) throw new Error(`PDF fixture checksum changed: ${fixture.name}`);
    fs.writeFileSync(filename, data);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
