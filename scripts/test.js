import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
const require = createRequire(import.meta.url)

// Use require for airlines.json import issues
const {
    listAirlines,
    getAirline,
    getAssets,
    getAssetContent,
} = require('../dist/index.cjs')
const assert = require('assert')
const { JSDOM } = require('jsdom')

// Run from outside the repo, like a consumer would, so cwd-relative paths fail
process.chdir(tmpdir())

async function run() {
    // Basic sanity checks
    const airlines = listAirlines()
    assert(Array.isArray(airlines), 'listAirlines should return an array')
    assert(airlines.length > 0, 'airlines should not be empty')

    // Asset paths must resolve regardless of the cwd
    const vna = getAssets('VN')
    assert(vna?.logo?.color, 'getAssets should find Vietnam Airlines logo')
    assert(
        getAssetContent('VN')?.logo?.color?.includes('<svg'),
        'getAssetContent should read Vietnam Airlines logo',
    )

    // Pick the first airline and verify lookups
    const sample = airlines[0]
    assert(
        sample && (sample.name || sample.slug),
        'sample airline has a name or slug',
    )

    const bySlug = getAirline(sample.slug)
    assert(
        bySlug && bySlug.name === sample.name,
        'getAirline should find by slug',
    )

    const byName = getAirline(sample.name)
    assert(
        byName && byName.name === sample.name,
        'getAirline should find by name',
    )

    // getAssets may return null (if no assets) or an object
    const assets = getAssets(sample.slug)
    assert(
        assets === null || typeof assets === 'object',
        'getAssets returns null or an object',
    )

    // Test getAssetContent if assets are available
    if (assets) {
        const content = getAssetContent(sample.slug)
        assert(
            content !== null,
            'getAssetContent should return content when assets exist',
        )

        // Verify that SVG content is returned for at least one variant
        const hasContent = Object.values(content).some(
            (variant) =>
                variant.color?.includes('<svg') ||
                variant.monochrome?.includes('<svg'),
        )
        assert(hasContent, 'at least one variant should have SVG content')
    }

    // The bundled validator must be self-contained in both module formats
    const {
        runSvgValidations: validateCJS,
    } = require('../dist/svg-validator.cjs')
    const { runSvgValidations: validateESM } =
        await import('../dist/svg-validator.js')
    const svg = new JSDOM(
        readFileSync(
            require.resolve('../dist/assets/vietnam-airlines/logo.svg'),
        ),
        { contentType: 'image/svg+xml' },
    ).window.document.querySelector('svg')
    for (const validate of [validateCJS, validateESM]) {
        assert(
            validate(svg, 'logo').some((check) => check.pass),
            'runSvgValidations should validate a logo',
        )
    }

    console.log('All tests passed')
}

run().catch((err) => {
    console.error('Test failed:')
    console.error(err && err.stack ? err.stack : err)
    process.exit(1)
})
