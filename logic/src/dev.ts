// Dev-only assertions. In `vite dev` and Vitest `import.meta.env.DEV` is
// `true`; in `vite build` production it's `false` and the conditional gets
// dead-code-eliminated. Use these for *invariants* (things that should
// never happen if callers honour the contract) — keep regular `if` guards
// for documented runtime drops (off-canvas float cells, hole-cell skips,
// rect-fully-outside, paste outside destination canvas).

export function devAssert(cond: unknown, msg: string): asserts cond {
    if (!cond && import.meta.env.DEV) throw new Error(`devAssert: ${msg}`);
}

// Exhaustive-enum sentinel — pass the discriminator after handling every
// known case so the compiler refuses to build if a new variant is added
// without updating the dispatch. The runtime throw is the dev-time net.
export function assertNever(x: never, ctx: string): never {
    throw new Error(`assertNever: ${ctx} got ${JSON.stringify(x)}`);
}
