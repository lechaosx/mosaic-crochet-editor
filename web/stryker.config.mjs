export default {
    testRunner: "vitest",
    plugins: ["@stryker-mutator/vitest-runner"],
    coverageAnalysis: "perTest",
    mutate: [
        "src/selection.ts",
        "src/clipboard.ts",
        "src/paint.ts",
        "src/store.ts",
        "src/symmetry.ts",
        "src/storage.ts",
        "src/history.ts",
        "src/pattern.ts",
        "src/types.ts",
    ],
    tempDirName: "stryker-tmp",
};
