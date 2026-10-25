// Points the built index.html at the versioned SAPUI5 CDN (ADR 0018). In development
// cds-plugin-ui5 serves resources/ locally; production images do not ship SAPUI5.
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'

const version = parse(readFileSync('ui5.yaml', 'utf8')).framework.version
const file = 'dist/index.html'
const html = readFileSync(file, 'utf8')
const local = 'src="resources/sap-ui-core.js"'
if (!html.includes(local)) throw new Error(`${file} does not bootstrap from ${local}`)
writeFileSync(file, html.replace(local, `src="https://ui5.sap.com/${version}/resources/sap-ui-core.js"`))
console.log(`${file}: SAPUI5 ${version} from https://ui5.sap.com`)
