import { describe, expect, test } from 'vitest'
import { normalizeComponentDisplayName } from '@/lib/component-naming'

describe('component display name normalization', () => {
  test('keeps component names crisp and title-cased', () => {
    expect(normalizeComponentDisplayName('cold-chain transport system', 'OTHER')).toBe('Cold-Chain Transport System')
    expect(normalizeComponentDisplayName('multiple temperature sensors placed at different internal zones', 'SENSOR')).toBe('Temperature Sensor Array')
    expect(normalizeComponentDisplayName('payload identification module using QR/RFID/barcode', 'MODULE')).toBe('Payload Identification Module')
    expect(normalizeComponentDisplayName('phase-change material status estimation module', 'MODULE')).toBe('PCM Status Estimation Module')
    expect(normalizeComponentDisplayName('GPS or route-location module', 'MODULE')).toBe('GPS or Route-Location Module')
    expect(normalizeComponentDisplayName('accelerometer/gyroscope', 'SENSOR')).toBe('Accelerometer / Gyroscope')
  })

  test('adds sensor suffix only when a sensor label lacks a sensor noun', () => {
    expect(normalizeComponentDisplayName('ambient temperature', 'SENSOR')).toBe('Ambient Temperature Sensor')
    expect(normalizeComponentDisplayName('humidity sensor', 'SENSOR')).toBe('Humidity Sensor')
  })
})
