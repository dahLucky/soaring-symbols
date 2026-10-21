// Release to npm: test, bump the version in package.json, publish, then commit the bump.
// No git tag or GitHub release is created.
//
// Usage: npm run release -- [bump] [--preid <id>] [--tag <dist-tag>] [--dry-run]
//   bump: prerelease (default), patch, minor, major, prepatch, preminor, premajor or an exact version
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { parseArgs } from 'util'

const BRANCH = 'main'
const REMOTE = 'origin'
const RELEASE_FILES = ['package.json', 'package-lock.json']

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        preid: { type: 'string' },
        tag: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
    },
})

const bump = positionals[0] || 'prerelease'
const dryRun = values['dry-run']

const fail = (message) => {
    console.error(`\n❌ ${message}`)
    process.exit(1)
}

const step = (message) => console.log(`\n▶ ${message}`)

// Run a command with inherited stdio (so npm can prompt for an OTP); exit on failure
const run = (cmd, args, { allowFail = false } = {}) => {
    console.log(`$ ${cmd} ${args.join(' ')}`)
    const result = spawnSync(cmd, args, { stdio: 'inherit' })
    if (result.status !== 0 && !allowFail) {
        fail(`Command failed: ${cmd} ${args.join(' ')}`)
    }

    return result.status === 0
}

// Run a command and return its trimmed stdout
const read = (cmd, args) => {
    const result = spawnSync(cmd, args, { encoding: 'utf8' })
    if (result.status !== 0) {
        fail(`Command failed: ${cmd} ${args.join(' ')}\n${result.stderr}`)
    }

    return result.stdout.trim()
}

const readVersion = () =>
    JSON.parse(readFileSync('package.json', 'utf8')).version

const prereleaseId = (version) => version.split('-')[1]?.split('.')[0]

const restoreReleaseFiles = () =>
    run('git', ['checkout', '--', ...RELEASE_FILES])

const ensureCleanTree = (hint) => {
    if (read('git', ['status', '--porcelain'])) {
        run('git', ['status', '--short'])
        fail(`Working tree is not clean. ${hint}`)
    }
}

// --- Preflight ---
step('Checking repository state')

const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== BRANCH)
    fail(`Releases are cut from "${BRANCH}", not "${branch}".`)

ensureCleanTree('Commit or stash your changes first.')

run('git', ['fetch', REMOTE, BRANCH])
const behind = read('git', ['rev-list', '--count', `HEAD..${REMOTE}/${BRANCH}`])
if (behind !== '0') fail(`"${BRANCH}" is ${behind} commit(s) behind ${REMOTE}.`)

if (!dryRun) {
    const user = read('npm', ['whoami'])
    console.log(`Logged in to npm as ${user}`)
}

// --- Test (also lints SVGs and regenerates airlines.json / AIRLINES.md) ---
step('Running tests')
run('npm', ['test'])
ensureCleanTree(
    'The build regenerated tracked files; review and commit them before releasing.',
)

// --- Version bump ---
const currentVersion = readVersion()
const preid = values.preid || prereleaseId(currentVersion) || 'alpha'

step(`Bumping version from ${currentVersion} (${bump})`)
run('npm', ['version', bump, '--preid', preid, '--no-git-tag-version'])

const version = readVersion()
const isPrerelease = version.includes('-')
const distTag = values.tag || (isPrerelease ? prereleaseId(version) : 'latest')

// While there is no stable release, keep `latest` on the newest prerelease
// so a plain `npm install soaring-symbols` gets it.
let moveLatest = false
if (isPrerelease && distTag !== 'latest') {
    const result = spawnSync(
        'npm',
        ['view', 'soaring-symbols', 'dist-tags.latest'],
        { encoding: 'utf8' },
    )
    const latest = result.status === 0 ? result.stdout.trim() : ''
    moveLatest = !latest || latest.includes('-')
}

console.log(`
  version:   ${version}
  dist-tag:  ${distTag}${moveLatest ? ' (+ latest)' : ''}`)

if (dryRun) {
    step('Dry run: showing the package contents')
    run('npm', ['pack', '--dry-run'])
    restoreReleaseFiles()
    console.log('\n✅ Dry run finished; no changes were kept.')
    process.exit(0)
}

// --- Publish (prepublishOnly rebuilds dist/) ---
step(`Publishing ${version} to npm under "${distTag}"`)
if (!run('npm', ['publish', '--tag', distTag], { allowFail: true })) {
    restoreReleaseFiles()
    fail('npm publish failed; the version bump was reverted.')
}

if (moveLatest) {
    run('npm', ['dist-tag', 'add', `soaring-symbols@${version}`, 'latest'])
}

// --- Commit the bump (not pushed) ---
step('Committing the version bump')
run('git', ['add', ...RELEASE_FILES])
run('git', ['commit', '-m', `chore(release): v${version}`])

console.log(
    `\n✅ Published soaring-symbols@${version}. Push the release commit with "git push ${REMOTE} ${BRANCH}".`,
)
