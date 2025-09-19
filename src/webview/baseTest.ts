import { type RollwrightFixtures, test as testBase } from "rollwright";

// centralized test base with default coverage configs
export const test = testBase.extend<RollwrightFixtures>({
  coverage: async ({ coverage }, use) => {
    const updatedCoverage =
      coverage === false
        ? false
        : {
            extensions: coverage?.extensions ?? [],
            include: coverage?.include ?? ["**/*.ts"],
            exclude: [
              ...(coverage?.exclude ?? []),
              "src/clients/**/*",
              "**/*.spec.ts",
              "**/*.test.ts",
            ],
          };

    await use(updatedCoverage);
  },
});
