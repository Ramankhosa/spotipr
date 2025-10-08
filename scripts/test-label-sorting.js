#!/usr/bin/env node

/**
 * Test label sorting comparison
 */

const requiredLabels = ['broad', 'baseline', 'narrow'];
const actualLabels = ['baseline', 'broad', 'narrow'];

console.log('Original required:', requiredLabels);
console.log('Original actual:', actualLabels);

const sortedRequired = [...requiredLabels].sort();
const sortedActual = actualLabels.sort();

console.log('Sorted required:', sortedRequired);
console.log('Sorted actual:', sortedActual);

console.log('JSON comparison:', JSON.stringify(sortedActual) === JSON.stringify(sortedRequired));
console.log('Direct comparison:', sortedActual.join(',') === sortedRequired.join(','));
