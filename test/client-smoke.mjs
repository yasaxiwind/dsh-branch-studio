/**
 * Client smoke test: load the browser bundle with a fake module loader and run
 * apply() against a fake client context. This catches top-level errors, bad
 * slot registrations and bundle-shape mistakes without a browser. Rendering is
 * covered by the browser check in the delivery notes.
 *
 *   node test/client-smoke.mjs
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

let registration
globalThis.window = {
  __ModuleLoader__: {
    load: definition => {
      registration = definition
    },
  },
}

await import(pathToFileURL(join(import.meta.dirname, '..', 'client.js')).href)
if (!registration || registration.id !== 'dsh-branch-studio') throw new Error('bundle did not register')

// The browser provides React from its module table; the stub only needs the
// surface the factory destructures before rendering happens.
const React = {
  createElement: () => null,
  Fragment: 'fragment',
  useCallback: fn => fn,
  useEffect: () => {},
  useMemo: fn => fn(),
  useRef: () => ({ current: null }),
  useState: () => [null, () => {}],
  useSyncExternalStore: () => null,
}

const module = registration.factory(spec => {
  if (spec === 'react') return React
  throw new Error(`unexpected module: ${spec}`)
})
if (typeof module.apply !== 'function') throw new Error('factory returned no apply')

const slots = []
const fakeCtx = {
  effect: fn => {
    const dispose = fn()
    if (typeof dispose === 'function') slots.push({ dispose })
  },
  locale: {
    register: () => {},
    bind: () => key => key,
  },
  slots: {
    inject: (_name, factory) => {
      factory()
    },
    register: (options, component) => {
      slots.push({ options, component })
      return () => {}
    },
  },
}

module.apply(fakeCtx)
const names = slots.filter(entry => entry.options).map(entry => entry.options.name)
if (!names.includes('conversation.input.left')) throw new Error('trigger slot missing')
if (!names.includes('shell.overlay')) throw new Error('panel slot missing')
for (const entry of slots.filter(item => item.options)) {
  if (typeof entry.component !== 'function') throw new Error(`slot ${entry.options.name} has no component`)
  if (typeof entry.options.inject !== 'function') throw new Error(`slot ${entry.options.name} has no inject`)
}

console.log('client smoke: OK', names.join(', '))
