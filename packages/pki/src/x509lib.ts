/**
 * Re-export of `@peculiar/x509` with the `reflect-metadata` polyfill its
 * transitive `tsyringe` dependency requires.  Every module in this package must
 * import the library from here so the polyfill is loaded exactly once and
 * before any X.509 class is instantiated.
 */
import 'reflect-metadata'

export * from '@peculiar/x509'
