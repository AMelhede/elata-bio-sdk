module.exports = {
	testEnvironment: "jsdom",
	testMatch: ["**/__tests__/**/*.test.ts"],
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
	},
	moduleNameMapper: {
		"^/pkg/(.*)$": "<rootDir>/demo/pkg/$1",
		// Its import.meta (how bundlers find the worker file) does not compile to CommonJS.
		"^\\./processorWorkerUrl$": "<rootDir>/src/__tests__/stubs/processorWorkerUrl.ts",
	},
};
