import { getBaseRollPlugins, getPackageJson, resolvePkgPath } from './utils';
import generatePackageJson from 'rollup-plugin-generate-package-json';
import alias from '@rollup/plugin-alias';

const { module, name, peerDependencies } = getPackageJson('react-dom');
// react-dom包路径
const pkgPath = resolvePkgPath(name);
// react-dom产物路径
const pkgDistPath = resolvePkgPath(name, true);

export default [
	// react-dom
	{
		input: `${pkgPath}/${module}`,
		// 兼容React18之前和React18引入ReactDOM
		output: [
			// react-dom
			{
				file: `${pkgDistPath}/index.js`,
				name: `ReactDOM`,
				format: 'umd'
			},

			// react-dom/client
			{
				file: `${pkgDistPath}/client.js`,
				name: `client`,
				format: 'umd'
			}
		],
		// externals废弃
		external: [...Object.keys(peerDependencies), 'scheduler'],
		// optimizeDeps: {
		// 	exclude: [...Object.keys(peerDependencies)]
		// },
		plugins: [
			...getBaseRollPlugins(),
			alias({
				entries: {
					hostConfig: `${pkgPath}/src/hostConfig.ts`
				}
			}),
			generatePackageJson({
				inputFolder: pkgPath,
				outputFolder: pkgDistPath,
				baseContents: ({ name, version, description }) => ({
					name,
					version,
					description,
					peerDependencies: {
						react: version
					},
					main: 'index.js'
				})
			})
		]
	},
	// test-util
	{
		input: `${pkgPath}/test-utils.ts`,
		output: [
			{
				file: `${pkgDistPath}/test-utils.js`,
				name: `testUtils`,
				format: 'umd'
			}
		],
		// externals废弃
		external: ['react-dom', 'react'],
		// optimizeDeps: {
		// 	exclude: [...Object.keys(peerDependencies)]
		// },
		plugins: getBaseRollPlugins()
	}
];
