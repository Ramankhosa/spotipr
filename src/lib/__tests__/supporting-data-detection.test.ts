import { describe, expect, test } from 'vitest'
import { detectTabularData, detectNumericResults } from '@/lib/supporting-data-detection'

const SOLAR_DRYER_EXCERPT = `
The lower chamber is the heat chamber, the upper chamber is the drying chamber of
size 600 mm x 450 mm x 900 mm. A glazed collector tilted at 26 degrees feeds hot
air into the heat chamber. Each warm-keeper block is a sealed aluminium cassette
filled with 350 g of paraffin wax of the grade that melts between 48 and 52 degrees C.
We measured airflow of about 0.9 m/s on a clear March afternoon.
Results: 6 kg of fresh chillies came down from 78 percent moisture to 9 percent
in one 14-hour stretch that ran through the night, against 4 days in open sun.
`

describe('detectTabularData', () => {
  test('detects a run of Markdown pipe rows', () => {
    expect(detectTabularData('| Sample | Moisture |\n|---|---|\n| A | 12.4 |')).toBe(true)
  })

  test('detects TSV rows pasted from a spreadsheet', () => {
    expect(detectTabularData('Sample\tMoisture\tTime\nA\t12.4\t6\nB\t8.1\t9')).toBe(true)
  })

  test('a lone pipe line or plain prose is not a table', () => {
    expect(detectTabularData('| just one decorated line |')).toBe(false)
    expect(detectTabularData('The flap opens wide when the air is dry.')).toBe(false)
  })

  test('a single TSV-looking line is not a table', () => {
    expect(detectTabularData('name\tvalue')).toBe(false)
  })

  test('the solar dryer disclosure has no tabular data', () => {
    expect(detectTabularData(SOLAR_DRYER_EXCERPT)).toBe(false)
  })
})

describe('detectNumericResults', () => {
  test('fires on the solar dryer disclosure (unit-anchored measurements)', () => {
    expect(detectNumericResults(SOLAR_DRYER_EXCERPT)).toBe(true)
  })

  test('fires on pharma-style results', () => {
    expect(detectNumericResults('IC50 was 12 mg per dose; release reached 84 percent at 60 min under 37 °C.')).toBe(true)
  })

  test('fires when the text contains an explicit table even without units', () => {
    expect(detectNumericResults('| a | b |\n|---|---|\n| x | y |')).toBe(true)
  })

  test('does not fire on bare counts without units', () => {
    expect(detectNumericResults('Claim 1 depends on claim 2; see Figure 3 and Figure 4.')).toBe(false)
  })

  test('does not fire on prose with fewer than three measurements', () => {
    expect(detectNumericResults('The cabinet uses 18 mm plywood throughout.')).toBe(false)
  })

  test('empty input is quiet', () => {
    expect(detectNumericResults('')).toBe(false)
    expect(detectTabularData('')).toBe(false)
  })
})
