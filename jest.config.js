/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['<rootDir>/test/*.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js'],
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: false,
    },
  },
};
