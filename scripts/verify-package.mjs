/**
 * Package verification: checks the published file whitelist, required bundle
 * files, JSON encoding and the real `npm pack --dry-run` manifest.
 *
 *   node scripts/verify-package.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageFile = join(root, 'package.json')
const raw = readFileSync(packageFile, 'utf8')
if (raw.charCodeAt(0) === 0xfeff) throw new Error('package.json starts with a UTF-8 BOM')
const pkg = JSON.parse(raw)
const fail = message => { throw new Error(`verify-package: ${message}`) }
const requireFile = path => { if (!existsSync(join(root, path))) fail(`missing file: ${path}`) }

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail(`version is not semver: ${pkg.version}`)
if (pkg.name !== 'dsh-branch-studio') fail(`unexpected package name: ${pkg.name}`)
if (!pkg.dsh?.bundle?.patch) fail('missing dsh.bundle.patch')
if (!pkg.dsh?.client) fail('missing dsh.client')
if (!pkg.repository?.url?.includes('github.com/yasaxiwind/dsh-branch-studio')) fail('repository.url is not the project repository')

const required = [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
  'docs/SECURITY.md',
]
for (const file of required) requireFile(file)

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
if (!/insert:/m.test(patch) || !patch.includes('dsh-branch-studio')) fail('cordis.patch.yml does not insert dsh-branch-studio')
const client = readFileSync(join(root, 'client.js'), 'utf8')
if (!client.includes('__ModuleLoader__')) fail('client.js does not export a ModuleLoader bundle')

for (const file of ['locale/en.json', 'locale/zh.json']) {
  const bytes = readFileSync(join(root, file))
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(`${file} starts with a UTF-8 BOM`)
  JSON.parse(bytes.toString('utf8'))
}
for (const file of ['index.js', 'client.js']) {
  if (!readFileSync(join(root, file), 'utf8').includes('branch')) fail(`${file} looks wrong`)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
let packed
try {
  // npm.cmd cannot be spawned directly by execFile on Windows.
  const command = process.platform === 'win32' ? 'cmd.exe' : npm
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm pack --dry-run --json'] : ['pack', '--dry-run', '--json']
  packed = execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120000 })
} catch (error) {
  fail(`npm pack --dry-run failed: ${(error.stderr || error.message).slice(-600)}`)
}
const manifest = JSON.parse(packed)
const entry = Array.isArray(manifest) ? manifest[0] : manifest
if (entry.version !== pkg.version) fail(`npm pack version ${entry.version} != package.json ${pkg.version}`)
const files = (entry.files ?? []).map(file => file.path)
const has = path => files.some(file => file === path || file.startsWith(`${path}/`))
for (const path of ['index.js', 'client.js', 'cordis.patch.yml', 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md', 'locale', 'docs']) {
  if (!has(path)) fail(`npm pack is missing ${path}`)
}
for (const path of ['test/', 'scripts/', '.github/', 'scratch/', 'browser-screenshots/']) {
  if (files.some(file => file.startsWith(path))) fail(`npm pack must not include ${path}`)
}
for (const path of ['docs/COMPETITORS.md', 'docs/VERIFICATION.md', 'docs/GUI-TEST.md', 'docs/GUI-RECHECK.md']) {
  if (files.includes(path)) fail(`npm pack must not include internal doc ${path}`)
}
if (files.some(file => file.endsWith('.tgz'))) fail('npm pack must not include a tarball')

console.log(`verify-package: OK ${pkg.name}@${pkg.version}, ${files.length} files, ${entry.size} bytes`)
