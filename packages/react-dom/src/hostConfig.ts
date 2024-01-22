import { FiberNode } from 'react-reconciler/src/fiber';
import { HostComponent, HostText } from 'react-reconciler/src/workTags';
import { DOMElement, updateFiberProps } from './syntheticEvent';

export type Container = Element;
export type Instance = Element;
export type TextInstance = Text;

export function createInstance(type: string, props: any): Instance {
	const element = document.createElement(type) as unknown;
	// 1.reactDOM与reconciler对接的第一种时机，创建DOM时
	updateFiberProps(element as DOMElement, props);
	return element as DOMElement;
}

export function createTextInstance(content: string) {
	return document.createTextNode(content);
}

export function appendInitialChild(
	parent: Instance | Container,
	child: Instance
) {
	parent.appendChild(child);
}

export const appendChildToContainer = appendInitialChild;

export const insertChildToContainer = (
	child: Instance,
	parent: Container,
	before: Instance
) => {
	parent.insertBefore(child, before);
};

export const commitUpdate = (fiber: FiberNode) => {
	switch (fiber.tag) {
		case HostText:
			const text = fiber.memoizedProps.content;
			return commitTextUpdate(fiber.stateNode, text);
		case HostComponent:
			return updateFiberProps(fiber.stateNode, fiber.memoizedProps);
		default:
			if (__DEV__) {
				console.warn('未处理的update类型', fiber);
			}
			break;
	}
};

// 更新hostText的内容
export const commitTextUpdate = (
	textInstance: TextInstance,
	content: string
) => {
	textInstance.textContent = content;
};

export const removeChild = (
	child: Instance | TextInstance,
	parent: Container
) => {
	parent.removeChild(child);
};

export const scheduleMicroTask =
	typeof queueMicrotask === 'function'
		? queueMicrotask
		: typeof Promise === 'function'
		? (callback: (...arg: any) => void) => Promise.resolve(null).then(callback)
		: setTimeout;
