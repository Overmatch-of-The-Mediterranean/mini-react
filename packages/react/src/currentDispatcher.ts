import { Action } from 'shared/ReactTypes';

export interface Dispatcher {
	useState: <T>(initialState: T | (() => T)) => [T, Dispatch<T>];
	useEffect: (callback: () => void | void, deps: any[] | void) => void;
	useTransition: () => [boolean, (callback: () => void) => void];
}

export type Dispatch<State> = (action: Action<State>) => void;

// 内部数据共享层存储的当前使用的hooks集合
const currentDispatcher: { current: Dispatcher | null } = {
	current: null
};

// 获取hook集合
export function resolveDispatcher() {
	const dispatcher = currentDispatcher.current;

	if (dispatcher === null) {
		throw new Error('hook只能在函数组件中执行');
	}

	return dispatcher;
}

export default currentDispatcher;
