import { Dispatcher, resolveDispatcher } from './src/currentDispatcher';
import { jsxDEV, jsx, isValidElement as isValidElementFn } from './src/jsx';
import currentDispatcher from './src/currentDispatcher';
import { EffectDeps } from '../react-reconciler/src/fiberHooks';

// react暴露的hook，其本质是当前使用的hooks集合中的hook
// 通过数据共享层就将，react和reconciler建立起了联系
// 并且为了使react和reconciler解耦，将数据共享层又多做了一层封装
export const useState: Dispatcher['useState'] = (initialState) => {
	const dispatcher = resolveDispatcher();
	return dispatcher.useState(initialState);
};

export const useEffect: Dispatcher['useEffect'] = (create, deps) => {
	const dispatcher = resolveDispatcher();
	return dispatcher.useEffect(create, deps);
};

// 内部数据层
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
	currentDispatcher
};

export const version = '1.0.0';

export const createElement = jsx;

export const isValidElement = isValidElementFn;

// export default {
// 	version: '1.0.0',
// 	createElement: jsxDEV
// };
