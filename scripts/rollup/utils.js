import path from 'path';
import fs from 'fs';
import ts from 'rollup-plugin-typescript2';
import cjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';

const pkgPath = path.resolve(__dirname, '../../packages');
const pkgDistPath = path.resolve(__dirname, '../../dist/node_modules');

export const resolvePkgPath = (pkgName, dist = false) => {
	if (dist) {
		return `${pkgDistPath}/${pkgName}`;
	}

	return `${pkgPath}/${pkgName}`;
};

export const getPackageJson = (pkgName) => {
	const path = `${resolvePkgPath(pkgName)}/package.json`;
	const str = fs.readFileSync(path, { encoding: 'utf-8' });
	return JSON.parse(str);
};

export const getBaseRollPlugins = ({
	alias = {
		__DEV__: true,
		preventAssignment: true
	},
	typescript = {}
} = {}) => {
	return [replace(alias), cjs(), ts(typescript)];
};
