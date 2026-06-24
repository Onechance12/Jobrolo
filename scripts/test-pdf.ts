import { extractText, getDocumentProxy } from 'unpdf'
import { promises as fs } from 'node:fs'

async function main() {
  const buffer = await fs.readFile('/tmp/scope-of-loss.pdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  console.log('Pages:', pdf.numPages)

  const result = await extractText(pdf, { mergePages: true })
  console.log('---TEXT---')
  console.log(result.text.slice(0, 2000))
  console.log('---END---')
  console.log('Total chars:', result.text.length)
}

main().catch(console.error)
