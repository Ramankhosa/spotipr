import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Structural checks on the raw SQL in loader.ts.
//
// These exist because a mismatch between the UNNEST array list and its column
// alias list is invisible to TypeScript and to every unit test — it only
// surfaces at runtime as `column s.<name> does not exist`, after a multi-GB
// archive has already been downloaded and parsed. That happened in production:
// an alias list was left at 10 columns while the UNNEST grew to 12.
//
// Parsing source in a test is unusual, but the failure mode is expensive and
// nothing else catches it short of a live database.

const SOURCE = readFileSync(join(__dirname, 'loader.ts'), 'utf8')

/**
 * Bodies of every method with this name, public or private. Both loader classes
 * define `flush`, and both need checking.
 */
function methodBodies(name: string): string[] {
  const bodies: string[] = []
  const re = new RegExp(`(?:private )?async ${name}\\(`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(SOURCE))) {
    const end = SOURCE.indexOf('\n  }\n', match.index)
    bodies.push(SOURCE.slice(match.index, end === -1 ? undefined : end))
  }
  expect(bodies.length, `method ${name} not found`).toBeGreaterThan(0)
  return bodies
}

/** First body only, for checks that target a specific unique method. */
function methodBody(name: string): string {
  return methodBodies(name)[0]
}

/** Every UNNEST(...) / AS t(...) pair inside a method. */
function unnestBlocks(body: string): Array<{ arrays: number; aliases: number }> {
  const blocks: Array<{ arrays: number; aliases: number }> = []
  const re = /UNNEST\(([\s\S]*?)\)\s*AS\s+\w+\(([\s\S]*?)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    const arrays = (match[1].match(/::(text|timestamp|int|boolean|jsonb)(\[\])+/g) || []).length
    const aliases = match[2].split(',').map(s => s.trim()).filter(Boolean).length
    blocks.push({ arrays, aliases })
  }
  return blocks
}

describe('loader SQL shape', () => {
  for (const method of ['createMissing', 'fillExisting', 'createLocalPatents', 'upsertBib', 'flush']) {
    it(`${method}: every UNNEST supplies exactly as many arrays as it declares aliases`, () => {
      for (const [b, body] of Array.from(methodBodies(method).entries())) {
        for (const [i, block] of Array.from(unnestBlocks(body).entries())) {
          expect(
            block.arrays,
            `${method}[${b}] UNNEST #${i + 1}: ${block.arrays} arrays vs ${block.aliases} aliases`
          ).toBe(block.aliases)
        }
      }
    })
  }

  it('createMissing selects only columns its alias list actually declares', () => {
    const body = methodBody('createMissing')
    const aliasList = body.match(/AS\s+t\(([\s\S]*?)\)/)?.[1] ?? ''
    const declared = new Set(aliasList.split(',').map(s => s.trim()).filter(Boolean))

    // Every s.<name> referenced in the SELECT must be declared.
    const referenced = new Set((body.match(/\bs\.([a-z_]+)/g) || []).map(m => m.slice(2)))
    for (const name of Array.from(referenced)) {
      expect(declared.has(name), `SELECT references s.${name}, not in the alias list`).toBe(true)
    }
  })

  it('createMissing inserts as many values as it names columns', () => {
    const body = methodBody('createMissing')
    const columns = (body.match(/INSERT INTO "local_patents" \(([\s\S]*?)\)/)?.[1] ?? '')
      .split(',').map(s => s.trim()).filter(Boolean).length
    // The SELECT list runs from `SELECT s.pub` to the FROM that follows it.
    const selectList = body.slice(body.indexOf('SELECT s.pub'), body.indexOf('\n      FROM ('))
    const values = selectList
      .replace(/^SELECT\s+/, '')
      .split(/,(?![^(]*\))/)      // top-level commas only, so now() and ARRAY[...] stay intact
      .map(s => s.trim()).filter(Boolean).length
    expect(values, `${values} values for ${columns} columns`).toBe(columns)
  })
})
