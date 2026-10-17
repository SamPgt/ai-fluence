import { describe, expect, it } from 'vitest'
import { formatUsd } from './format'

// Espace insécable de toLocaleString : comparaison sur le texte normalisé.
const f = (...args: Parameters<typeof formatUsd>) => formatUsd(...args).replace(/\s/g, ' ')

describe('formatUsd', () => {
  it('toujours 2 décimales', () => {
    expect(f(0)).toBe('0,00 $')
    expect(f(12.5)).toBe('12,50 $')
    expect(f('1')).toBe('1,00 $')
  })

  it('coût : centime supérieur, un coût non nul n’affiche jamais 0,00', () => {
    expect(f(0.009)).toBe('0,01 $')
    expect(f(0.004)).toBe('0,01 $')
    expect(f('0.0256')).toBe('0,03 $')
    expect(f('0.1540')).toBe('0,16 $')
    expect(f('1.4779')).toBe('1,48 $')
    // Pas d'arrondi parasite sur un montant déjà au centime.
    expect(f(0.07)).toBe('0,07 $')
    expect(f('0.010')).toBe('0,01 $')
  })

  it('solde : centime inférieur', () => {
    expect(f(9.999, 'balance')).toBe('9,99 $')
    expect(f('10', 'balance')).toBe('10,00 $')
    expect(f(0.29, 'balance')).toBe('0,29 $')
  })

  it('valeur invalide', () => {
    expect(f('abc')).toBe('—')
  })
})
