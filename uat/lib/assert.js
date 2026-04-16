'use strict';

const { approxEq, fmt, log } = require('./logger');

// Returns a flat array of assertion objects
function verify(row, expectedMap) {
  return Object.entries(expectedMap)
    .filter(([k]) => !k.startsWith('_'))  // skip internal keys
    .map(([field, expVal]) => {
      const actual = row[field] ?? null;
      return { field, expected: expVal, actual, pass: approxEq(actual, expVal) };
    });
}

// Like verify() but only checks the fields listed in `fields` array
function verifyFields(row, expectedMap, fields) {
  const keys = fields || Object.keys(expectedMap).filter(k => !k.startsWith('_'));
  return keys.map(field => {
    const expVal = expectedMap[field] ?? null;
    const actual = row[field] ?? null;
    return { field, expected: expVal, actual, pass: approxEq(actual, expVal) };
  });
}

function printAssertions(assertions) {
  for (const a of assertions) {
    const line =
      `${a.field.padEnd(24)} expected: ${fmt(a.expected).padStart(16)}  actual: ${fmt(a.actual).padStart(16)}`;
    a.pass ? log.pass(line) : log.fail(line);
  }
}

module.exports = { verify, verifyFields, printAssertions };
