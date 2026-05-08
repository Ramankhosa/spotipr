import { describe, expect, test, vi } from 'vitest'
import {
  containsForbiddenPlantUmlKeywords,
  processGeneratedPlantUml,
  type PlantUmlRepairFn,
} from '../plantuml-diagram-processing'

const validBlock = `@startuml
rectangle "Sensor (100)" as S
rectangle "Closed-Loop Controller (200)" as C
rectangle "Output Module (300)" as O
S --> C
C --> O
@enduml`

const validActivity = `@startuml
start
:Receive signal (100);
:Adjust output (200);
:Emit result (300);
stop
@enduml`

describe('processGeneratedPlantUml', () => {
  test('repairs a loop block into a linear diagram', async () => {
    const repair = vi.fn<PlantUmlRepairFn>(async () => ({
      ok: true,
      repaired: true,
      code: validActivity,
    }))

    const result = await processGeneratedPlantUml({
      rawCode: `@startuml
start
:Receive signal (100);
loop while active
:Adjust output (200);
end loop
:Emit result (300);
stop
@enduml`,
      diagramType: 'ACTIVITY',
      repair,
    })

    expect(result.ok).toBe(true)
    expect(result.repaired).toBe(true)
    expect(result.code).not.toMatch(/\bloop\b/i)
    expect(result.repairSummary).toEqual({ attempted: 1, repaired: 1, failed: 0 })
    expect(repair).toHaveBeenCalledTimes(1)
  })

  test('rejects repaired output that still contains forbidden constructs', async () => {
    const repair = vi.fn<PlantUmlRepairFn>(async () => ({
      ok: true,
      repaired: true,
      code: `@startuml
start
:Receive signal (100);
loop retry
:Adjust output (200);
end loop
:Emit result (300);
stop
@enduml`,
    }))

    const result = await processGeneratedPlantUml({
      rawCode: `@startuml
start
:Receive signal (100);
loop retry
:Adjust output (200);
end loop
:Emit result (300);
stop
@enduml`,
      diagramType: 'ACTIVITY',
      repair,
    })

    expect(result.ok).toBe(false)
    expect(result.errors?.some(error => error.type === 'forbidden_construct')).toBe(true)
    expect(result.repairSummary).toEqual({ attempted: 1, repaired: 1, failed: 1 })
  })

  test('repairs missing @enduml', async () => {
    const repair = vi.fn<PlantUmlRepairFn>(async () => ({
      ok: true,
      repaired: true,
      code: validBlock,
    }))

    const result = await processGeneratedPlantUml({
      rawCode: validBlock.replace(/\n@enduml$/, ''),
      diagramType: 'BLOCK',
      repair,
    })

    expect(result.ok).toBe(true)
    expect(result.repaired).toBe(true)
    expect(result.code).toContain('@enduml')
    expect(repair).toHaveBeenCalledTimes(1)
  })

  test('does not flag forbidden words inside quoted labels', async () => {
    const forbidden = containsForbiddenPlantUmlKeywords(validBlock)
    expect(forbidden.hasForbidden).toBe(false)

    const repair = vi.fn<PlantUmlRepairFn>()
    const result = await processGeneratedPlantUml({
      rawCode: validBlock,
      diagramType: 'BLOCK',
      repair,
    })

    expect(result.ok).toBe(true)
    expect(result.repaired).toBe(false)
    expect(repair).not.toHaveBeenCalled()
  })

  test('preserves valid diagrams without calling repair', async () => {
    const repair = vi.fn<PlantUmlRepairFn>()

    const result = await processGeneratedPlantUml({
      rawCode: validActivity,
      diagramType: 'ACTIVITY',
      repair,
    })

    expect(result.ok).toBe(true)
    expect(result.code).toContain(':Receive signal (100);')
    expect(result.repairSummary).toEqual({ attempted: 0, repaired: 0, failed: 0 })
    expect(repair).not.toHaveBeenCalled()
  })
})
