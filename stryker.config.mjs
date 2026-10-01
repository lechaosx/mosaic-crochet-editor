export default {
    // Stryker 10's Vitest adapter skips tests on repeated runs with Vitest 5.
    testRunner: "command",
    commandRunner: { command: "npm run test --workspace logic -- --maxWorkers 1" },
    coverageAnalysis: "off",
    ignorePatterns: [".direnv/**", "target/**"],
    mutate: [
        "logic/src/selection.ts",
        "logic/src/clipboard.ts",
        "logic/src/paint.ts",
        "logic/src/store.ts",
        "logic/src/symmetry.ts",
        "logic/src/storage.ts",
        "logic/src/pattern.ts",
        "logic/src/types.ts",
    ],
    tempDirName: "stryker-tmp",
};
