import { FiberNode } from './fiber';

// 保存整个应用中所有Suspense组件对应的fiber
let suspenseHandlerStack: FiberNode[] = [];

export function getSuspenseHandler() {
	return suspenseHandlerStack[suspenseHandlerStack.length - 1];
}

export function pushSuspenseHandler(handler: FiberNode) {
	suspenseHandlerStack.push(handler);
}

export function popSuspenseHandler() {
	suspenseHandlerStack.pop();
}
